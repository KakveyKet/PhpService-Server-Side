import Customer from '../models/Customer.js';
import Installment from '../models/Installment.js';
import Loan from '../models/Loan.js';
import LoanApplication from '../models/LoanApplication.js';
import LoanTransaction from '../models/LoanTransaction.js';
import Notification from '../models/Notification.js';
import { ROLES } from '../constants/index.js';
import { writeAudit } from '../services/auditService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextNumber } from '../utils/counter.js';
import { runDatabaseWork, sessionOptions } from '../utils/databaseWork.js';

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
      .populate('customerId', 'customerCode firstName middleName lastName phone')
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
    .populate('customerId', 'customerCode firstName middleName lastName phone userId')
    .populate('productId', 'productCode name');
  if (!loan) throw new AppError('Loan not found', 404);

  if (req.role === ROLES.CUSTOMER && loan.customerId.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('You cannot view this loan', 403);
  }

  const [installments, transactions] = await Promise.all([
    Installment.find({ loanId: loan._id }).sort({ installmentNumber: 1 }),
    LoanTransaction.find({ loanId: loan._id }).sort({ transactionDate: -1 })
  ]);
  res.json({ success: true, item: loan, installments, transactions });
});

export const disburseLoan = asyncHandler(async (req, res) => {
  let savedLoan;

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

  res.json({ success: true, item: savedLoan });
});
