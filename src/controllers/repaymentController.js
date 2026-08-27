import Decimal from 'decimal.js';
import Customer from '../models/Customer.js';
import Installment from '../models/Installment.js';
import Loan from '../models/Loan.js';
import LoanTransaction from '../models/LoanTransaction.js';
import Repayment from '../models/Repayment.js';
import { writeAudit } from '../services/auditService.js';
import { publishChange } from '../services/realtimeService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextNumber } from '../utils/counter.js';
import { runDatabaseWork, sessionOptions } from '../utils/databaseWork.js';
import { toDecimal, toMoney } from '../utils/decimal.js';

const allocationOrder = [
  ['penaltyDue', 'penaltyPaid', 'penaltyAmount'],
  ['feeDue', 'feePaid', 'feeAmount'],
  ['interestDue', 'interestPaid', 'interestAmount'],
  ['principalDue', 'principalPaid', 'principalAmount']
];

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

function allocateToInstallment(installment, availableAmount) {
  let remaining = availableAmount;
  const allocation = {
    installmentId: installment._id,
    principalAmount: new Decimal(0),
    interestAmount: new Decimal(0),
    feeAmount: new Decimal(0),
    penaltyAmount: new Decimal(0)
  };

  for (const [dueField, paidField, allocationField] of allocationOrder) {
    const outstanding = Decimal.max(toDecimal(installment[dueField]).minus(toDecimal(installment[paidField])), 0);
    const applied = Decimal.min(outstanding, remaining);
    allocation[allocationField] = applied;
    installment[paidField] = toMoney(toDecimal(installment[paidField]).plus(applied));
    remaining = remaining.minus(applied);
    if (remaining.lte(0)) break;
  }

  const totalAmount = availableAmount.minus(remaining);
  installment.totalPaid = toMoney(toDecimal(installment.totalPaid).plus(totalAmount));
  installment.remainingDue = toMoney(Decimal.max(toDecimal(installment.totalDue).minus(toDecimal(installment.totalPaid)), 0));

  if (toDecimal(installment.remainingDue).eq(0)) {
    installment.status = 'PAID';
    installment.paidAt = new Date();
  } else if (toDecimal(installment.totalPaid).gt(0)) {
    installment.status = 'PARTIALLY_PAID';
  }

  return {
    allocation: {
      installmentId: installment._id,
      principalAmount: toMoney(allocation.principalAmount),
      interestAmount: toMoney(allocation.interestAmount),
      feeAmount: toMoney(allocation.feeAmount),
      penaltyAmount: toMoney(allocation.penaltyAmount),
      totalAmount: toMoney(totalAmount)
    },
    remaining
  };
}

export const listRepayments = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 100);
  const filter = {};

  if (req.query.loanId) filter.loanId = req.query.loanId;
  if (req.query.customerId) filter.customerId = req.query.customerId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.paymentMethod) filter.paymentMethod = req.query.paymentMethod;

  const paymentDate = dateRangeFromQuery(req.query);
  if (Object.keys(paymentDate).length) filter.paymentDate = paymentDate;

  const [items, total] = await Promise.all([
    Repayment.find(filter)
      .populate('customerId', 'customerCode name firstName middleName lastName')
      .populate('loanId', 'loanNumber productSnapshot')
      .populate('receivedBy', 'displayName')
      .sort({ paymentDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Repayment.countDocuments(filter)
  ]);

  res.json({
    success: true,
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

export const createRepayment = asyncHandler(async (req, res) => {
  const { loanId, amount, paymentMethod } = req.body;
  if (!loanId || amount === undefined || !paymentMethod) {
    throw new AppError('Loan, amount and payment method are required', 422);
  }
  const paymentAmount = toDecimal(amount);
  if (paymentAmount.lte(0)) throw new AppError('Payment amount must be greater than zero', 422);

  let savedRepayment;
  let customerUserId = null;

  await runDatabaseWork(async (session) => {
      const loan = await Loan.findById(loanId).session(session);
      if (!loan) throw new AppError('Loan not found', 404);
      if (!['APPROVED', 'ACTIVE', 'OVERDUE'].includes(loan.status)) {
        throw new AppError('Loan is not eligible for repayment', 409);
      }
      if (paymentAmount.gt(toDecimal(loan.balances.total))) {
        throw new AppError('Payment exceeds the outstanding loan balance', 422);
      }

      const installments = await Installment.find({
        loanId: loan._id,
        status: { $in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] }
      }).sort({ installmentNumber: 1 }).session(session);

      let remaining = paymentAmount;
      const allocations = [];
      const totals = { principal: new Decimal(0), interest: new Decimal(0), fee: new Decimal(0), penalty: new Decimal(0) };

      for (const installment of installments) {
        if (remaining.lte(0)) break;
        const result = allocateToInstallment(installment, remaining);
        if (toDecimal(result.allocation.totalAmount).gt(0)) {
          allocations.push(result.allocation);
          totals.principal = totals.principal.plus(result.allocation.principalAmount.toString());
          totals.interest = totals.interest.plus(result.allocation.interestAmount.toString());
          totals.fee = totals.fee.plus(result.allocation.feeAmount.toString());
          totals.penalty = totals.penalty.plus(result.allocation.penaltyAmount.toString());
          await installment.save(sessionOptions(session));
        }
        remaining = result.remaining;
      }

      if (remaining.gt(0)) throw new AppError('Payment could not be fully allocated', 422);

      loan.balances.principal = toMoney(toDecimal(loan.balances.principal).minus(totals.principal));
      loan.balances.interest = toMoney(toDecimal(loan.balances.interest).minus(totals.interest));
      loan.balances.fees = toMoney(toDecimal(loan.balances.fees).minus(totals.fee));
      loan.balances.penalties = toMoney(toDecimal(loan.balances.penalties).minus(totals.penalty));
      loan.balances.total = toMoney(toDecimal(loan.balances.total).minus(paymentAmount));
      loan.balances.totalPaid = toMoney(toDecimal(loan.balances.totalPaid).plus(paymentAmount));
      if (toDecimal(loan.balances.total).eq(0)) loan.status = 'COMPLETED';
      await loan.save(sessionOptions(session));

      const [repayment] = await Repayment.create(
        [{
          receiptNumber: await nextNumber('receipt', 'RCP', session),
          loanId: loan._id,
          customerId: loan.customerId,
          amount: toMoney(paymentAmount),
          paymentMethod,
          transactionReference: req.body.transactionReference || '',
          paymentDate: req.body.paymentDate ? new Date(req.body.paymentDate) : new Date(),
          allocations,
          note: req.body.note || '',
          status: 'CONFIRMED',
          receivedBy: req.user._id,
          confirmedBy: req.user._id
        }],
        sessionOptions(session)
      );

      await LoanTransaction.create(
        [{
          transactionNumber: await nextNumber('transaction', 'TRX', session),
          loanId: loan._id,
          transactionType: 'REPAYMENT',
          amount: toMoney(paymentAmount),
          breakdown: {
            principal: toMoney(totals.principal),
            interest: toMoney(totals.interest),
            fee: toMoney(totals.fee),
            penalty: toMoney(totals.penalty)
          },
          referenceType: 'REPAYMENT',
          referenceId: repayment._id,
          description: `Payment received through ${paymentMethod}`,
          transactionDate: repayment.paymentDate,
          createdBy: req.user._id
        }],
        sessionOptions(session)
      );

      await writeAudit({ req, action: 'REPAYMENT_CONFIRMED', entityType: 'REPAYMENT', entityId: repayment._id, newValues: req.body, session });
      const customer = await Customer.findById(loan.customerId).select('userId').session(session);
      customerUserId = customer?.userId || null;
      savedRepayment = repayment;
  });

  publishChange({
    topics: ['repayments', 'loans', 'dashboard', 'reports'],
    action: 'REPAYMENT_CONFIRMED',
    entityId: savedRepayment._id,
    staff: true,
    userIds: [customerUserId]
  });

  res.status(201).json({ success: true, item: savedRepayment });
});

export const reverseRepayment = asyncHandler(async (req, res) => {
  if (!req.body.reason) throw new AppError('Reversal reason is required', 422);
  let savedRepayment;
  let customerUserId = null;

  await runDatabaseWork(async (session) => {
      const repayment = await Repayment.findById(req.params.id).session(session);
      if (!repayment) throw new AppError('Repayment not found', 404);
      if (repayment.status !== 'CONFIRMED') throw new AppError('Only confirmed repayments can be reversed', 409);
      const loan = await Loan.findById(repayment.loanId).session(session);

      const totals = { principal: new Decimal(0), interest: new Decimal(0), fee: new Decimal(0), penalty: new Decimal(0) };
      for (const allocation of repayment.allocations) {
        const installment = await Installment.findById(allocation.installmentId).session(session);
        if (!installment) throw new AppError('Related installment was not found', 409);

        installment.principalPaid = toMoney(toDecimal(installment.principalPaid).minus(allocation.principalAmount.toString()));
        installment.interestPaid = toMoney(toDecimal(installment.interestPaid).minus(allocation.interestAmount.toString()));
        installment.feePaid = toMoney(toDecimal(installment.feePaid).minus(allocation.feeAmount.toString()));
        installment.penaltyPaid = toMoney(toDecimal(installment.penaltyPaid).minus(allocation.penaltyAmount.toString()));
        installment.totalPaid = toMoney(toDecimal(installment.totalPaid).minus(allocation.totalAmount.toString()));
        installment.remainingDue = toMoney(toDecimal(installment.totalDue).minus(installment.totalPaid.toString()));
        installment.paidAt = null;
        installment.status = toDecimal(installment.totalPaid).gt(0)
          ? 'PARTIALLY_PAID'
          : (installment.dueDate < new Date() ? 'OVERDUE' : 'PENDING');
        await installment.save(sessionOptions(session));

        totals.principal = totals.principal.plus(allocation.principalAmount.toString());
        totals.interest = totals.interest.plus(allocation.interestAmount.toString());
        totals.fee = totals.fee.plus(allocation.feeAmount.toString());
        totals.penalty = totals.penalty.plus(allocation.penaltyAmount.toString());
      }

      loan.balances.principal = toMoney(toDecimal(loan.balances.principal).plus(totals.principal));
      loan.balances.interest = toMoney(toDecimal(loan.balances.interest).plus(totals.interest));
      loan.balances.fees = toMoney(toDecimal(loan.balances.fees).plus(totals.fee));
      loan.balances.penalties = toMoney(toDecimal(loan.balances.penalties).plus(totals.penalty));
      loan.balances.total = toMoney(toDecimal(loan.balances.total).plus(repayment.amount.toString()));
      loan.balances.totalPaid = toMoney(toDecimal(loan.balances.totalPaid).minus(repayment.amount.toString()));
      loan.status = 'ACTIVE';
      await loan.save(sessionOptions(session));

      repayment.status = 'REVERSED';
      repayment.reversal = { reason: req.body.reason, reversedBy: req.user._id, reversedAt: new Date() };
      await repayment.save(sessionOptions(session));

      await LoanTransaction.create(
        [{
          transactionNumber: await nextNumber('transaction', 'TRX', session),
          loanId: loan._id,
          transactionType: 'REVERSAL',
          amount: repayment.amount,
          breakdown: {
            principal: toMoney(totals.principal),
            interest: toMoney(totals.interest),
            fee: toMoney(totals.fee),
            penalty: toMoney(totals.penalty)
          },
          referenceType: 'REPAYMENT',
          referenceId: repayment._id,
          description: req.body.reason,
          createdBy: req.user._id
        }],
        sessionOptions(session)
      );

      await writeAudit({ req, action: 'REPAYMENT_REVERSED', entityType: 'REPAYMENT', entityId: repayment._id, newValues: { reason: req.body.reason }, session });
      const customer = await Customer.findById(loan.customerId).select('userId').session(session);
      customerUserId = customer?.userId || null;
      savedRepayment = repayment;
  });

  publishChange({
    topics: ['repayments', 'loans', 'dashboard', 'reports'],
    action: 'REPAYMENT_REVERSED',
    entityId: savedRepayment._id,
    staff: true,
    userIds: [customerUserId]
  });

  res.json({ success: true, item: savedRepayment });
});
