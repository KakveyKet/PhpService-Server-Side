import Customer from '../models/Customer.js';
import Installment from '../models/Installment.js';
import Loan from '../models/Loan.js';
import LoanApplication from '../models/LoanApplication.js';
import Notification from '../models/Notification.js';
import Product from '../models/Product.js';
import { ROLES } from '../constants/index.js';
import { writeAudit } from '../services/auditService.js';
import { generateLoanSchedule } from '../services/loanScheduleService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextNumber } from '../utils/counter.js';
import { runDatabaseWork, sessionOptions } from '../utils/databaseWork.js';
import { toDecimal, toMoney } from '../utils/decimal.js';

async function customerForUser(userId) {
  const customer = await Customer.findOne({ userId });
  if (!customer) throw new AppError('Customer profile not found', 404);
  return customer;
}

function dateRangeFromQuery(query) {
  const range = {};

  if (query.dateFrom) {
    const dateFrom = new Date(query.dateFrom);
    if (Number.isNaN(dateFrom.getTime())) throw new AppError('Invalid dateFrom value', 422);
    range.$gte = dateFrom;
  }

  if (query.dateTo) {
    const dateTo = new Date(query.dateTo);
    if (Number.isNaN(dateTo.getTime())) throw new AppError('Invalid dateTo value', 422);
    range.$lte = dateTo;
  }

  if (range.$gte && range.$lte && range.$gte > range.$lte) {
    throw new AppError('dateFrom must be before dateTo', 422);
  }

  return range;
}

export const listApplications = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const filter = {};

  if (req.role === ROLES.CUSTOMER) filter.customerId = (await customerForUser(req.user._id))._id;
  if (req.query.customerId && req.role !== ROLES.CUSTOMER) filter.customerId = req.query.customerId;
  if (req.query.status) filter.status = req.query.status;

  const submittedAt = dateRangeFromQuery(req.query);
  if (Object.keys(submittedAt).length) filter.submittedAt = submittedAt;

  const [items, total] = await Promise.all([
    LoanApplication.find(filter)
      .populate('customerId', 'customerCode firstName middleName lastName phone')
      .populate({ path: 'productId', populate: { path: 'rateId' } })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    LoanApplication.countDocuments(filter)
  ]);

  res.json({ success: true, items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const createApplication = asyncHandler(async (req, res) => {
  const { productId, requestedAmount, requestedTerm, purpose } = req.body;
  if (!productId || requestedAmount === undefined || !requestedTerm || !purpose) {
    throw new AppError('Product, amount, term and purpose are required', 422);
  }

  const customer = req.role === ROLES.CUSTOMER
    ? await customerForUser(req.user._id)
    : await Customer.findById(req.body.customerId);
  if (!customer) throw new AppError('Customer not found', 404);
  if (customer.status !== 'ACTIVE') throw new AppError('Customer is not active', 422);

  const product = await Product.findOne({ _id: productId, status: 'ACTIVE' }).populate('rateId');
  if (!product || product.rateId?.status !== 'ACTIVE') throw new AppError('Active loan product not found', 404);

  const amount = toDecimal(requestedAmount);
  if (amount.lessThan(product.minimumAmount.toString()) || amount.greaterThan(product.maximumAmount.toString())) {
    throw new AppError('Requested amount is outside the product limit', 422);
  }
  if (Number(requestedTerm) < product.minimumTerm || Number(requestedTerm) > product.maximumTerm) {
    throw new AppError('Requested term is outside the product limit', 422);
  }

  const application = await LoanApplication.create({
    applicationNumber: await nextNumber('application', 'APP'),
    customerId: customer._id,
    productId: product._id,
    requestedAmount: toMoney(amount),
    requestedTerm: Number(requestedTerm),
    purpose,
    monthlyIncome: toMoney(req.body.monthlyIncome ?? customer.monthlyIncome ?? 0),
    monthlyExpense: toMoney(req.body.monthlyExpense || 0),
    collateralDescription: req.body.collateralDescription || '',
    status: 'SUBMITTED',
    createdBy: req.user._id
  });

  await writeAudit({ req, action: 'LOAN_APPLICATION_CREATED', entityType: 'LOAN_APPLICATION', entityId: application._id, newValues: req.body });
  res.status(201).json({ success: true, item: application });
});

export const reviewApplication = asyncHandler(async (req, res) => {
  const { decision, comment = '' } = req.body;
  if (!['APPROVED', 'REJECTED', 'RETURNED'].includes(decision)) {
    throw new AppError('Invalid review decision', 422);
  }

  let responseItem;

  await runDatabaseWork(async (session) => {
      const application = await LoanApplication.findById(req.params.id).session(session);
      if (!application) throw new AppError('Loan application not found', 404);
      if (!['SUBMITTED', 'UNDER_REVIEW'].includes(application.status)) {
        throw new AppError('This application has already been reviewed', 409);
      }

      const approvedAmount = req.body.approvedAmount ?? application.requestedAmount;
      const approvedTerm = Number(req.body.approvedTerm ?? application.requestedTerm);
      application.approvalHistory.push({
        decision,
        approvedAmount: decision === 'APPROVED' ? toMoney(approvedAmount) : null,
        approvedTerm: decision === 'APPROVED' ? approvedTerm : null,
        comment,
        reviewedBy: req.user._id
      });

      if (decision !== 'APPROVED') {
        application.status = decision === 'REJECTED' ? 'REJECTED' : 'UNDER_REVIEW';
        await application.save(sessionOptions(session));
        await writeAudit({ req, action: `LOAN_APPLICATION_${decision}`, entityType: 'LOAN_APPLICATION', entityId: application._id, newValues: req.body, session });
        responseItem = application;
        return;
      }

      const product = await Product.findById(application.productId).populate('rateId').session(session);
      if (!product || !product.rateId) throw new AppError('Product or rate is unavailable', 422);
      if (product.rateId.period !== product.repaymentFrequency) {
        throw new AppError('The starter requires the rate period to match the repayment frequency', 422);
      }
      const amount = toDecimal(approvedAmount);
      if (amount.lessThan(product.minimumAmount.toString()) || amount.greaterThan(product.maximumAmount.toString())) {
        throw new AppError('Approved amount is outside the product limit', 422);
      }
      if (approvedTerm < product.minimumTerm || approvedTerm > product.maximumTerm) {
        throw new AppError('Approved term is outside the product limit', 422);
      }

      const startDate = req.body.startDate ? new Date(req.body.startDate) : new Date();
      const schedule = generateLoanSchedule({
        principal: amount,
        term: approvedTerm,
        ratePercent: product.rateId.ratePercent,
        ratePeriod: product.rateId.period,
        calculationMethod: product.rateId.calculationMethod,
        repaymentFrequency: product.repaymentFrequency,
        processingFeePercent: product.processingFeePercent,
        startDate
      });

      const [loan] = await Loan.create(
        [{
          loanNumber: await nextNumber('loan', 'LN', session),
          applicationId: application._id,
          customerId: application.customerId,
          productId: product._id,
          productSnapshot: {
            productCode: product.productCode,
            name: product.name,
            repaymentFrequency: product.repaymentFrequency,
            termUnit: product.termUnit
          },
          principalAmount: toMoney(amount),
          rateSnapshot: {
            rateId: product.rateId._id,
            ratePercent: product.rateId.ratePercent,
            period: product.rateId.period,
            calculationMethod: product.rateId.calculationMethod
          },
          term: approvedTerm,
          termUnit: product.termUnit,
          repaymentFrequency: product.repaymentFrequency,
          processingFee: schedule.processingFee,
          totalInterest: schedule.totalInterest,
          totalPayable: schedule.totalPayable,
          balances: {
            principal: toMoney(amount),
            interest: schedule.totalInterest,
            fees: schedule.processingFee,
            penalties: toMoney(0),
            total: schedule.totalPayable,
            totalPaid: toMoney(0)
          },
          startDate,
          maturityDate: schedule.maturityDate,
          status: 'APPROVED',
          approvedBy: req.user._id
        }],
        sessionOptions(session)
      );

      await Installment.insertMany(
        schedule.installments.map((installment) => ({ ...installment, loanId: loan._id })),
        sessionOptions(session)
      );

      application.status = 'APPROVED';
      await application.save(sessionOptions(session));

      const customer = await Customer.findById(application.customerId).session(session);
      if (customer?.userId) {
        await Notification.create(
          [{
            userId: customer.userId,
            title: 'Loan application approved',
            message: `${application.applicationNumber} was approved.`,
            type: 'LOAN',
            referenceId: loan._id
          }],
          sessionOptions(session)
        );
      }

      await writeAudit({ req, action: 'LOAN_APPLICATION_APPROVED', entityType: 'LOAN', entityId: loan._id, newValues: req.body, session });
      responseItem = loan;
  });

  res.json({ success: true, item: responseItem });
});
