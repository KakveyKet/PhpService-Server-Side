import Customer from '../models/Customer.js';
import Installment from '../models/Installment.js';
import Loan from '../models/Loan.js';
import LoanApplication from '../models/LoanApplication.js';
import LoanTransaction from '../models/LoanTransaction.js';
import Notification from '../models/Notification.js';
import Product from '../models/Product.js';
import Repayment from '../models/Repayment.js';
import { ROLES } from '../constants/index.js';
import { writeAudit } from '../services/auditService.js';
import { generateLoanSchedule } from '../services/loanScheduleService.js';
import { publishChange } from '../services/realtimeService.js';
import {
  walletSummaryForLoan,
  withdrawalTotalsForLoan
} from '../services/withdrawalService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextNumber } from '../utils/counter.js';
import { runDatabaseWork, sessionOptions } from '../utils/databaseWork.js';
import { toDecimal, toMoney } from '../utils/decimal.js';

async function customerIdForRequest(req) {
  if (req.role !== ROLES.CUSTOMER) return null;
  const customer = await Customer.findOne({ userId: req.user._id });
  if (!customer) throw new AppError('Customer profile not found', 404);
  return customer._id;
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

export const listLoans = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const filter = {};
  const ownCustomerId = await customerIdForRequest(req);
  if (ownCustomerId) filter.customerId = ownCustomerId;
  if (req.query.customerId && !ownCustomerId) filter.customerId = req.query.customerId;
  if (req.query.status) filter.status = req.query.status;

  const createdAt = dateRangeFromQuery(req.query);
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;

  const [items, total] = await Promise.all([
    Loan.find(filter)
      .populate('customerId', 'customerCode name firstName middleName lastName phone')
      .populate('productId', 'productCode name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Loan.countDocuments(filter)
  ]);
  res.json({ success: true, items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const getLoan = asyncHandler(async (req, res) => {
  const loan = await Loan.findById(req.params.id)
    .populate('customerId', 'customerCode name firstName middleName lastName phone userId')
    .populate('productId', 'productCode name');
  if (!loan) throw new AppError('Loan not found', 404);

  if (req.role === ROLES.CUSTOMER && loan.customerId.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('You cannot view this loan', 403);
  }

  const [installments, transactions, wallet] = await Promise.all([
    Installment.find({ loanId: loan._id }).sort({ installmentNumber: 1 }),
    LoanTransaction.find({ loanId: loan._id }).sort({ transactionDate: -1 }),
    walletSummaryForLoan(loan)
  ]);
  res.json({ success: true, item: loan, installments, transactions, wallet });
});

export const updateLoanPlan = asyncHandler(async (req, res) => {
  const { principalAmount, term, comment = '' } = req.body;

  if (principalAmount === undefined || term === undefined) {
    throw new AppError('Principal amount and term are required', 422);
  }

  let savedLoanId;
  let customerUserId = null;
  let changeAction = 'LOAN_PLAN_UPDATED';

  await runDatabaseWork(async (session) => {
    const loan = await Loan.findById(req.params.id).session(session);
    if (!loan) throw new AppError('Loan not found', 404);

    if (!['APPROVED', 'ACTIVE', 'OVERDUE'].includes(loan.status)) {
      throw new AppError(
        'Only approved, active or overdue loans can be restructured',
        409
      );
    }

    const [transactionExists, repaymentExists, paidTotalsResult] = await Promise.all([
      LoanTransaction.exists({ loanId: loan._id }).session(session),
      Repayment.exists({ loanId: loan._id }).session(session),
      Installment.aggregate([
        { $match: { loanId: loan._id } },
        {
          $group: {
            _id: null,
            principalPaid: { $sum: '$principalPaid' },
            interestPaid: { $sum: '$interestPaid' },
            feePaid: { $sum: '$feePaid' },
            penaltyPaid: { $sum: '$penaltyPaid' },
            totalPaid: { $sum: '$totalPaid' }
          }
        }
      ]).session(session)
    ]);

    const paidTotals = paidTotalsResult[0] || {};
    const recordedPrincipalPaid = toDecimal(paidTotals.principalPaid || 0);
    const balancePrincipalPaid = toDecimal(loan.principalAmount)
      .minus(toDecimal(loan.balances.principal));
    const principalPaid = recordedPrincipalPaid.greaterThan(balancePrincipalPaid)
      ? recordedPrincipalPaid
      : balancePrincipalPaid;
    const hasFinancialActivity = Boolean(
      loan.disbursedAt ||
      transactionExists ||
      repaymentExists ||
      toDecimal(loan.balances.totalPaid).greaterThan(0)
    );
    changeAction = hasFinancialActivity ? 'LOAN_RESTRUCTURED' : 'LOAN_PLAN_UPDATED';

    const [product, application] = await Promise.all([
      Product.findById(loan.productId).session(session),
      LoanApplication.findById(loan.applicationId).session(session)
    ]);

    if (!product) throw new AppError('Loan product not found', 404);
    if (!application) throw new AppError('Related loan application not found', 404);

    const amount = toDecimal(principalAmount);
    const withdrawalTotals = await withdrawalTotalsForLoan(loan._id, session);
    if (
      amount.lessThan(product.minimumAmount.toString()) ||
      amount.greaterThan(product.maximumAmount.toString())
    ) {
      throw new AppError('Principal amount is outside the product limit', 422);
    }

    if (amount.lessThanOrEqualTo(principalPaid)) {
      throw new AppError(
        `Principal amount must be greater than the principal already paid (${principalPaid.toFixed(2)})`,
        422
      );
    }

    if (amount.lessThan(withdrawalTotals.committed)) {
      throw new AppError(
        `Principal amount cannot be lower than reserved or completed withdrawals (${withdrawalTotals.committed.toFixed(2)})`,
        422
      );
    }

    const remainingTerm = Number(term);
    if (!Number.isInteger(remainingTerm) || remainingTerm < 1) {
      throw new AppError('Loan term must be a whole number', 422);
    }

    const minimumAllowedTerm = hasFinancialActivity ? 1 : product.minimumTerm;
    if (
      remainingTerm < minimumAllowedTerm ||
      remainingTerm > product.maximumTerm
    ) {
      throw new AppError('Loan term is outside the product limit', 422);
    }

    const futurePrincipal = hasFinancialActivity
      ? amount.minus(principalPaid)
      : amount;
    const restructureDate = req.body.startDate
      ? new Date(req.body.startDate)
      : hasFinancialActivity
        ? new Date()
        : new Date(loan.startDate);

    if (Number.isNaN(restructureDate.getTime())) {
      throw new AppError('Invalid restructuring start date', 422);
    }

    const schedule = generateLoanSchedule({
      principal: futurePrincipal,
      term: remainingTerm,
      ratePercent: loan.rateSnapshot.ratePercent,
      ratePeriod: loan.rateSnapshot.period,
      calculationMethod: loan.rateSnapshot.calculationMethod,
      repaymentFrequency: loan.repaymentFrequency,
      processingFeePercent: hasFinancialActivity ? 0 : product.processingFeePercent,
      startDate: restructureDate
    });

    const oldValues = {
      status: loan.status,
      principalAmount: loan.principalAmount,
      term: loan.term,
      outstandingPrincipal: loan.balances.principal,
      processingFee: loan.processingFee,
      totalInterest: loan.totalInterest,
      totalPayable: loan.totalPayable,
      maturityDate: loan.maturityDate
    };

    let installmentNumberOffset = 0;

    if (hasFinancialActivity) {
      const lastInstallment = await Installment.findOne({ loanId: loan._id })
        .sort({ installmentNumber: -1 })
        .select('installmentNumber')
        .session(session);
      installmentNumberOffset = lastInstallment?.installmentNumber || 0;

      await Installment.updateMany(
        {
          loanId: loan._id,
          status: { $in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] }
        },
        {
          $set: {
            status: 'WAIVED',
            remainingDue: toMoney(0)
          }
        },
        sessionOptions(session)
      );
    } else {
      await Installment.deleteMany({ loanId: loan._id }, sessionOptions(session));
    }

    await Installment.insertMany(
      schedule.installments.map((installment) => ({
        ...installment,
        installmentNumber: installmentNumberOffset + installment.installmentNumber,
        loanId: loan._id
      })),
      sessionOptions(session)
    );

    const paidInterest = toDecimal(paidTotals.interestPaid || 0);
    const paidFees = toDecimal(paidTotals.feePaid || 0);
    const paidPenalties = toDecimal(paidTotals.penaltyPaid || 0);
    const totalPaid = hasFinancialActivity
      ? toDecimal(loan.balances.totalPaid)
      : toDecimal(0);
    const oldOutstandingPrincipal = toDecimal(loan.balances.principal);

    loan.principalAmount = toMoney(amount);
    loan.term = remainingTerm;
    loan.processingFee = toMoney(paidFees.plus(toDecimal(schedule.processingFee)));
    loan.totalInterest = toMoney(paidInterest.plus(toDecimal(schedule.totalInterest)));
    loan.totalPayable = toMoney(totalPaid.plus(toDecimal(schedule.totalPayable)));
    loan.maturityDate = schedule.maturityDate;
    loan.balances.principal = toMoney(futurePrincipal);
    loan.balances.interest = schedule.totalInterest;
    loan.balances.fees = schedule.processingFee;
    loan.balances.penalties = toMoney(0);
    loan.balances.total = schedule.totalPayable;
    loan.balances.totalPaid = toMoney(totalPaid);
    if (loan.status === 'OVERDUE') loan.status = 'ACTIVE';
    await loan.save(sessionOptions(session));

    const principalAdjustment = futurePrincipal.minus(oldOutstandingPrincipal);
    if (hasFinancialActivity && !principalAdjustment.isZero()) {
      await LoanTransaction.create(
        [{
          transactionNumber: await nextNumber('transaction', 'TRX', session),
          loanId: loan._id,
          transactionType: 'ADJUSTMENT',
          amount: toMoney(principalAdjustment.abs()),
          breakdown: { principal: toMoney(principalAdjustment) },
          referenceType: 'LOAN_RESTRUCTURE',
          referenceId: loan._id,
          description: String(comment || '').trim() || 'Outstanding principal restructured',
          transactionDate: restructureDate,
          createdBy: req.user._id
        }],
        sessionOptions(session)
      );
    }

    application.requestedAmount = toMoney(amount);
    application.requestedTerm = remainingTerm;
    application.approvalHistory.push({
      decision: 'APPROVED',
      approvedAmount: toMoney(amount),
      approvedTerm: remainingTerm,
      comment: String(comment || '').trim() || (
        hasFinancialActivity
          ? 'Active loan restructured'
          : 'Approved loan plan updated'
      ),
      reviewedBy: req.user._id
    });
    await application.save(sessionOptions(session));

    const customer = await Customer.findById(loan.customerId).session(session);
    customerUserId = customer?.userId || null;

    if (customerUserId) {
      await Notification.create(
        [{
          userId: customerUserId,
          title: hasFinancialActivity ? 'Loan restructured' : 'Approved loan plan updated',
          message: `${loan.loanNumber} now has ${remainingTerm} future installments.`,
          type: 'LOAN',
          referenceId: loan._id
        }],
        sessionOptions(session)
      );
    }

    await writeAudit({
      req,
      action: changeAction,
      entityType: 'LOAN',
      entityId: loan._id,
      oldValues,
      newValues: {
        status: loan.status,
        principalAmount: loan.principalAmount,
        term: loan.term,
        outstandingPrincipal: loan.balances.principal,
        processingFee: loan.processingFee,
        totalInterest: loan.totalInterest,
        totalPayable: loan.totalPayable,
        maturityDate: loan.maturityDate,
        principalPaid: toMoney(principalPaid),
        interestPaid: toMoney(paidInterest),
        feesPaid: toMoney(paidFees),
        penaltiesPaid: toMoney(paidPenalties),
        historicalFinancialActivity: hasFinancialActivity,
        committedWithdrawals: toMoney(withdrawalTotals.committed),
        comment: String(comment || '').trim()
      },
      session
    });

    savedLoanId = loan._id;
  });

  const savedLoan = await Loan.findById(savedLoanId)
    .populate('customerId', 'customerCode name firstName middleName lastName phone')
    .populate('productId', 'productCode name minimumAmount maximumAmount minimumTerm maximumTerm');

  publishChange({
    topics: ['applications', 'loans', 'repayments', 'dashboard', 'reports', 'notifications'],
    action: changeAction,
    entityId: savedLoan._id,
    staff: true,
    userIds: [customerUserId]
  });

  res.json({ success: true, item: savedLoan });
});

export const disburseLoan = asyncHandler(async (req, res) => {
  let savedLoan;
  let customerUserId = null;

  await runDatabaseWork(async (session) => {
      const loan = await Loan.findById(req.params.id).session(session);
      if (!loan) throw new AppError('Loan not found', 404);
      if (loan.status !== 'APPROVED') throw new AppError('Only approved loans can be disbursed', 409);

      loan.status = 'ACTIVE';
      loan.disbursedAt = req.body.disbursedAt ? new Date(req.body.disbursedAt) : new Date();
      await loan.save(sessionOptions(session));

      await LoanApplication.findByIdAndUpdate(loan.applicationId, { status: 'DISBURSED' }, sessionOptions(session));
      await LoanTransaction.create(
        [{
          transactionNumber: await nextNumber('transaction', 'TRX', session),
          loanId: loan._id,
          transactionType: 'DISBURSEMENT',
          amount: loan.principalAmount,
          breakdown: { principal: loan.principalAmount },
          referenceType: 'LOAN',
          referenceId: loan._id,
          description: 'Loan principal disbursed',
          transactionDate: loan.disbursedAt,
          createdBy: req.user._id
        }],
        sessionOptions(session)
      );

      const customer = await Customer.findById(loan.customerId).session(session);
      if (customer?.userId) {
        customerUserId = customer.userId;
        await Notification.create(
          [{
            userId: customer.userId,
            title: 'Loan disbursed',
            message: `${loan.loanNumber} is now active.`,
            type: 'LOAN',
            referenceId: loan._id
          }],
          sessionOptions(session)
        );
      }

      await writeAudit({ req, action: 'LOAN_DISBURSED', entityType: 'LOAN', entityId: loan._id, newValues: { disbursedAt: loan.disbursedAt }, session });
      savedLoan = loan;
  });

  publishChange({
    topics: ['applications', 'loans', 'dashboard', 'notifications'],
    action: 'LOAN_DISBURSED',
    entityId: savedLoan._id,
    staff: true,
    userIds: [customerUserId]
  });

  res.json({ success: true, item: savedLoan });
});
