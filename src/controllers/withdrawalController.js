import crypto from 'node:crypto';
import Customer from '../models/Customer.js';
import Loan from '../models/Loan.js';
import LoanApplication from '../models/LoanApplication.js';
import LoanTransaction from '../models/LoanTransaction.js';
import Notification from '../models/Notification.js';
import Withdrawal from '../models/Withdrawal.js';
import { ROLES } from '../constants/index.js';
import { writeAudit } from '../services/auditService.js';
import { publishChange } from '../services/realtimeService.js';
import {
  expireWithdrawalOtps,
  walletSummaryForLoan
} from '../services/withdrawalService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextNumber } from '../utils/counter.js';
import { runDatabaseWork, sessionOptions } from '../utils/databaseWork.js';
import { toDecimal, toMoney } from '../utils/decimal.js';

const OTP_LIFETIME_MS = 10 * 60 * 1000;
const WITHDRAWAL_REJECTION_REASONS = [
  'WITHDRAWAL WRONG AMOUNT',
  'WRONG BANK ACCOUNT',
  'LOW CREDIT',
  'WRONG INFORMATION',
  'INSURANCE',
  'PLATEFORM FEE',
  'VIP CHANNEL',
  'NEW DOCUMENT AND NEW OTP CODE',
  'FREEZE LOAN ACCOUNT',
  'INLAND REVENUE TAX',
  'NEED NEW OTP CODE'
];

function requiredText(value, label, maximumLength = 120) {
  const text = String(value || '').trim();
  if (!text) throw new AppError(`${label} is required`, 422);
  if (text.length > maximumLength) {
    throw new AppError(`${label} is too long`, 422);
  }
  return text;
}

function positiveAmount(value) {
  try {
    const amount = toDecimal(value);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new Error('invalid');
    }
    return amount;
  } catch {
    throw new AppError('Withdrawal amount must be greater than zero', 422);
  }
}

function otpSecret() {
  const secret = process.env.OTP_PEPPER || process.env.JWT_SECRET;
  if (!secret) throw new AppError('OTP service is not configured', 503);
  return secret;
}

function hashOtp(withdrawalId, otp) {
  return crypto
    .createHmac('sha256', otpSecret())
    .update(`${withdrawalId}:${otp}`)
    .digest('hex');
}

function generateNumericOtp(length) {
  const maximum = 10 ** length;
  return String(crypto.randomInt(0, maximum)).padStart(length, '0');
}

function otpMatches(expectedHash, actualHash) {
  if (!expectedHash || !actualHash) return false;
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(actualHash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function customerResponse(item) {
  const data = item.toObject ? item.toObject() : { ...item };
  delete data.otpHash;
  delete data.customerBankSnapshot;
  delete data.bankMatch;
  delete data.customerId;
  return data;
}

async function customerForUser(userId, session = null) {
  const customer = await Customer.findOne({ userId }).session(session);
  if (!customer) throw new AppError('Customer profile not found', 404);
  return customer;
}

async function notifyCustomer({ customer, title, message, referenceId, session }) {
  if (!customer?.userId) return;
  await Notification.create(
    [{
      userId: customer.userId,
      title,
      message,
      type: 'SYSTEM',
      referenceId
    }],
    sessionOptions(session)
  );
}

export const listWithdrawals = asyncHandler(async (req, res) => {
  await expireWithdrawalOtps();

  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 100);
  const filter = {};

  if (req.role === ROLES.CUSTOMER) {
    const customer = await customerForUser(req.user._id);
    filter.customerId = customer._id;
  } else if (req.query.customerId) {
    filter.customerId = req.query.customerId;
  }

  if (req.query.loanId) filter.loanId = req.query.loanId;
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    Withdrawal.find(filter)
      .populate('customerId', 'customerCode name firstName middleName lastName phone bankName bankNumber')
      .populate('loanId', 'loanNumber principalAmount status productSnapshot')
      .populate('reviewedBy', 'displayName')
      .populate('otpGeneratedBy', 'displayName')
      .populate('approvedBy', 'displayName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Withdrawal.countDocuments(filter)
  ]);

  res.json({
    success: true,
    items: req.role === ROLES.CUSTOMER ? items.map(customerResponse) : items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

export const createWithdrawal = asyncHandler(async (req, res) => {
  const amount = positiveAmount(req.body.amount);
  const loanId = requiredText(req.body.loanId, 'Loan');

  let savedWithdrawalId;
  let customerUserId = null;

  try {
    await runDatabaseWork(async (session) => {
      await expireWithdrawalOtps(session);
      const customer = await customerForUser(req.user._id, session);
      customerUserId = customer.userId;

      const loan = await Loan.findOne({
        _id: loanId,
        customerId: customer._id
      }).session(session);
      if (!loan) throw new AppError('Loan not found', 404);
      if (!['APPROVED', 'ACTIVE'].includes(loan.status)) {
        throw new AppError('Only an approved or active loan can be withdrawn', 409);
      }

      const application = await LoanApplication.findById(loan.applicationId)
        .select('applicantSnapshot')
        .session(session);
      if (!application) {
        throw new AppError('The related loan application was not found', 409);
      }

      // New applications keep bank details in applicantSnapshot. The customer
      // fields are a compatibility fallback for loans created before that update.
      const bankName = String(
        application.applicantSnapshot?.bankName || customer.bankName || ''
      ).trim();
      const bankAccountNumber = String(
        application.applicantSnapshot?.bankAccountNumber || customer.bankNumber || ''
      ).trim();
      if (!bankName || !bankAccountNumber) {
        throw new AppError(
          'No bank information is saved with this loan application',
          409
        );
      }

      const openRequest = await Withdrawal.exists({
        loanId: loan._id,
        isOpen: true
      }).session(session);
      if (openRequest) {
        throw new AppError('Finish the existing withdrawal request first', 409);
      }

      const wallet = await walletSummaryForLoan(loan, session);
      if (amount.gt(toDecimal(wallet.availableBalance))) {
        throw new AppError('Withdrawal amount exceeds the available wallet balance', 422);
      }

      const [withdrawal] = await Withdrawal.create(
        [{
          withdrawalNumber: await nextNumber('withdrawal', 'WDR', session),
          customerId: customer._id,
          loanId: loan._id,
          amount: toMoney(amount),
          requestedBank: { bankName, bankAccountNumber },
          customerBankSnapshot: {
            bankName,
            bankAccountNumber
          },
          bankMatch: {
            bankName: true,
            bankAccountNumber: true
          },
          createdBy: req.user._id
        }],
        sessionOptions(session)
      );

      await writeAudit({
        req,
        action: 'WITHDRAWAL_REQUESTED',
        entityType: 'WITHDRAWAL',
        entityId: withdrawal._id,
        newValues: {
          loanId: loan._id,
          amount: withdrawal.amount,
          bankSource: 'LOAN_APPLICATION',
          applicationId: application._id
        },
        session
      });

      savedWithdrawalId = withdrawal._id;
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError('Finish the existing withdrawal request first', 409);
    }
    throw error;
  }

  const savedWithdrawal = await Withdrawal.findById(savedWithdrawalId)
    .populate('loanId', 'loanNumber principalAmount status productSnapshot');

  publishChange({
    topics: ['withdrawals', 'loans', 'dashboard', 'notifications'],
    action: 'WITHDRAWAL_REQUESTED',
    entityId: savedWithdrawal._id,
    roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    userIds: [customerUserId]
  });

  res.status(201).json({ success: true, item: customerResponse(savedWithdrawal) });
});

export const generateWithdrawalOtp = asyncHandler(async (req, res) => {
  const length = Number(req.body.length);
  if (![6, 8].includes(length)) {
    throw new AppError('OTP length must be 6 or 8 digits', 422);
  }

  let savedWithdrawalId;
  let rawOtp;
  let customerUserId = null;

  await runDatabaseWork(async (session) => {
    await expireWithdrawalOtps(session);
    const withdrawal = await Withdrawal.findById(req.params.id).session(session);
    if (!withdrawal) throw new AppError('Withdrawal request not found', 404);
    if (!['PENDING_REVIEW', 'WAITING_FOR_OTP', 'OTP_REQUIRED'].includes(withdrawal.status)) {
      throw new AppError('This withdrawal cannot receive a new OTP', 409);
    }

    rawOtp = generateNumericOtp(length);
    const now = new Date();
    withdrawal.status = 'WAITING_FOR_OTP';
    withdrawal.isOpen = true;
    withdrawal.reviewNote = String(req.body.note || '').trim();
    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = now;
    withdrawal.otpLength = length;
    withdrawal.otpHash = hashOtp(withdrawal._id, rawOtp);
    withdrawal.otpExpiresAt = new Date(now.getTime() + OTP_LIFETIME_MS);
    withdrawal.otpAttempts = 0;
    withdrawal.otpMaxAttempts = 5;
    withdrawal.otpGeneratedBy = req.user._id;
    withdrawal.otpGeneratedAt = now;
    await withdrawal.save(sessionOptions(session));

    const customer = await Customer.findById(withdrawal.customerId).session(session);
    customerUserId = customer?.userId || null;
    await notifyCustomer({
      customer,
      title: 'Withdrawal OTP ready',
      message: `${withdrawal.withdrawalNumber} is waiting for OTP verification. Ask the administrator for your ${length}-digit code.`,
      referenceId: withdrawal._id,
      session
    });

    await writeAudit({
      req,
      action: 'WITHDRAWAL_OTP_GENERATED',
      entityType: 'WITHDRAWAL',
      entityId: withdrawal._id,
      newValues: {
        otpLength: length,
        otpExpiresAt: withdrawal.otpExpiresAt,
        bankMatch: withdrawal.bankMatch,
        reviewNote: withdrawal.reviewNote
      },
      session
    });

    savedWithdrawalId = withdrawal._id;
  });

  const savedWithdrawal = await Withdrawal.findById(savedWithdrawalId)
    .populate('customerId', 'customerCode name firstName middleName lastName phone')
    .populate('loanId', 'loanNumber status productSnapshot')
    .populate('reviewedBy', 'displayName');

  publishChange({
    topics: ['withdrawals', 'loans', 'notifications'],
    action: 'WITHDRAWAL_OTP_GENERATED',
    entityId: savedWithdrawal._id,
    roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    userIds: [customerUserId]
  });

  res.json({
    success: true,
    item: savedWithdrawal,
    otp: rawOtp,
    expiresAt: savedWithdrawal.otpExpiresAt
  });
});

export const rejectWithdrawal = asyncHandler(async (req, res) => {
  const reason = requiredText(req.body.reason, 'Rejection reason', 500);
  if (!WITHDRAWAL_REJECTION_REASONS.includes(reason)) {
    throw new AppError('Select a valid withdrawal rejection reason', 422);
  }
  let savedWithdrawalId;
  let customerUserId = null;

  await runDatabaseWork(async (session) => {
    const withdrawal = await Withdrawal.findById(req.params.id)
      .select('+otpHash')
      .session(session);
    if (!withdrawal) throw new AppError('Withdrawal request not found', 404);
    if (![
      'PENDING_REVIEW',
      'WAITING_FOR_OTP',
      'OTP_REQUIRED',
      'OTP_VERIFIED'
    ].includes(withdrawal.status)) {
      throw new AppError('Only an open withdrawal can be rejected', 409);
    }

    withdrawal.status = 'REJECTED';
    withdrawal.isOpen = false;
    withdrawal.rejectionReason = reason;
    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = new Date();
    withdrawal.otpHash = undefined;
    withdrawal.otpExpiresAt = null;
    await withdrawal.save(sessionOptions(session));

    const customer = await Customer.findById(withdrawal.customerId).session(session);
    customerUserId = customer?.userId || null;
    await notifyCustomer({
      customer,
      title: 'Withdrawal rejected',
      message: `${withdrawal.withdrawalNumber} was rejected: ${reason}`,
      referenceId: withdrawal._id,
      session
    });

    await writeAudit({
      req,
      action: 'WITHDRAWAL_REJECTED',
      entityType: 'WITHDRAWAL',
      entityId: withdrawal._id,
      newValues: { reason },
      session
    });

    savedWithdrawalId = withdrawal._id;
  });

  const savedWithdrawal = await Withdrawal.findById(savedWithdrawalId)
    .populate('customerId', 'customerCode name firstName middleName lastName phone')
    .populate('loanId', 'loanNumber status productSnapshot')
    .populate('reviewedBy', 'displayName');

  publishChange({
    topics: ['withdrawals', 'loans', 'notifications'],
    action: 'WITHDRAWAL_REJECTED',
    entityId: savedWithdrawal._id,
    roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    userIds: [customerUserId]
  });

  res.json({ success: true, item: savedWithdrawal });
});

export const verifyWithdrawalOtp = asyncHandler(async (req, res) => {
  const otp = String(req.body.otp || '').trim();
  if (!/^\d{6}$|^\d{8}$/.test(otp)) {
    throw new AppError('Enter the complete 6- or 8-digit OTP', 422);
  }

  let savedWithdrawalId;
  let customerUserId = null;
  let failure = null;
  let action = 'WITHDRAWAL_OTP_VERIFIED';

  await runDatabaseWork(async (session) => {
    const customer = await customerForUser(req.user._id, session);
    customerUserId = customer.userId;
    const withdrawal = await Withdrawal.findOne({
      _id: req.params.id,
      customerId: customer._id
    })
      .select('+otpHash')
      .session(session);
    if (!withdrawal) throw new AppError('Withdrawal request not found', 404);
    if (!['WAITING_FOR_OTP', 'OTP_REQUIRED'].includes(withdrawal.status)) {
      throw new AppError('This withdrawal is not waiting for an OTP', 409);
    }

    if (!withdrawal.otpExpiresAt || withdrawal.otpExpiresAt <= new Date()) {
      withdrawal.status = 'EXPIRED';
      withdrawal.isOpen = false;
      withdrawal.otpHash = undefined;
      await withdrawal.save(sessionOptions(session));
      savedWithdrawalId = withdrawal._id;
      action = 'WITHDRAWAL_OTP_EXPIRED';
      failure = { message: 'The OTP expired. Submit a new withdrawal request.', status: 410 };
      return;
    }

    if (otp.length !== withdrawal.otpLength ||
      !otpMatches(withdrawal.otpHash, hashOtp(withdrawal._id, otp))) {
      withdrawal.otpAttempts += 1;
      const attemptsRemaining = Math.max(
        withdrawal.otpMaxAttempts - withdrawal.otpAttempts,
        0
      );

      if (!attemptsRemaining) {
        withdrawal.status = 'REJECTED';
        withdrawal.isOpen = false;
        withdrawal.rejectionReason = 'OTP attempt limit reached';
        withdrawal.otpHash = undefined;
        withdrawal.otpExpiresAt = null;
        action = 'WITHDRAWAL_OTP_LOCKED';
        failure = {
          message: 'The withdrawal was rejected after too many incorrect OTP attempts.',
          status: 429
        };
      } else {
        failure = {
          message: `Incorrect OTP. ${attemptsRemaining} attempts remaining.`,
          status: 422
        };
      }

      await withdrawal.save(sessionOptions(session));
      savedWithdrawalId = withdrawal._id;
      return;
    }

    const now = new Date();
    withdrawal.status = 'OTP_VERIFIED';
    withdrawal.isOpen = true;
    withdrawal.otpVerifiedAt = now;
    withdrawal.otpHash = undefined;
    withdrawal.otpExpiresAt = null;
    await withdrawal.save(sessionOptions(session));

    await notifyCustomer({
      customer,
      title: 'Withdrawal OTP verified',
      message: `${withdrawal.withdrawalNumber} is waiting for final administrator approval.`,
      referenceId: withdrawal._id,
      session
    });

    await writeAudit({
      req,
      action: 'WITHDRAWAL_OTP_VERIFIED',
      entityType: 'WITHDRAWAL',
      entityId: withdrawal._id,
      newValues: {
        amount: withdrawal.amount,
        otpVerifiedAt: now,
        status: withdrawal.status
      },
      session
    });

    savedWithdrawalId = withdrawal._id;
  });

  const savedWithdrawal = await Withdrawal.findById(savedWithdrawalId)
    .populate('loanId', 'loanNumber status productSnapshot');

  publishChange({
    topics: ['withdrawals', 'loans', 'notifications'],
    action,
    entityId: savedWithdrawal._id,
    roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    userIds: [customerUserId]
  });

  if (failure) throw new AppError(failure.message, failure.status);
  res.json({ success: true, item: customerResponse(savedWithdrawal) });
});

export const approveWithdrawal = asyncHandler(async (req, res) => {
  let savedWithdrawalId;
  let customerUserId = null;

  await runDatabaseWork(async (session) => {
    const withdrawal = await Withdrawal.findById(req.params.id).session(session);
    if (!withdrawal) throw new AppError('Withdrawal request not found', 404);
    if (withdrawal.status !== 'OTP_VERIFIED') {
      throw new AppError('The customer must verify the OTP before final approval', 409);
    }

    const loan = await Loan.findById(withdrawal.loanId).session(session);
    if (!loan) throw new AppError('Related loan not found', 404);
    if (!['APPROVED', 'ACTIVE'].includes(loan.status)) {
      throw new AppError('The related loan is no longer eligible for withdrawal', 409);
    }

    const now = new Date();
    const automaticallyDisbursed = loan.status === 'APPROVED';

    if (automaticallyDisbursed) {
      loan.status = 'ACTIVE';
      loan.disbursedAt = now;
      await loan.save(sessionOptions(session));

      await LoanApplication.findByIdAndUpdate(
        loan.applicationId,
        { status: 'DISBURSED' },
        sessionOptions(session)
      );

      await LoanTransaction.create(
        [{
          transactionNumber: await nextNumber('transaction', 'TRX', session),
          loanId: loan._id,
          transactionType: 'DISBURSEMENT',
          amount: loan.principalAmount,
          breakdown: { principal: loan.principalAmount },
          referenceType: 'LOAN',
          referenceId: loan._id,
          description: 'Loan automatically disbursed after final withdrawal approval',
          transactionDate: now,
          createdBy: req.user._id
        }],
        sessionOptions(session)
      );
    }

    withdrawal.status = 'APPROVED';
    withdrawal.isOpen = false;
    withdrawal.approvedBy = req.user._id;
    withdrawal.approvedAt = now;
    withdrawal.completedAt = now;
    if (req.body.note !== undefined) {
      withdrawal.reviewNote = String(req.body.note || '').trim();
    }
    await withdrawal.save(sessionOptions(session));

    await LoanTransaction.create(
      [{
        transactionNumber: await nextNumber('transaction', 'TRX', session),
        loanId: withdrawal.loanId,
        transactionType: 'WITHDRAWAL',
        amount: withdrawal.amount,
        referenceType: 'WITHDRAWAL',
        referenceId: withdrawal._id,
        description: `Approved wallet withdrawal ${withdrawal.withdrawalNumber}`,
        transactionDate: now,
        createdBy: req.user._id
      }],
      sessionOptions(session)
    );

    const customer = await Customer.findById(withdrawal.customerId).session(session);
    customerUserId = customer?.userId || null;
    await notifyCustomer({
      customer,
      title: 'Withdrawal approved',
      message: `${withdrawal.withdrawalNumber} was approved by the administrator.`,
      referenceId: withdrawal._id,
      session
    });

    await writeAudit({
      req,
      action: 'WITHDRAWAL_APPROVED',
      entityType: 'WITHDRAWAL',
      entityId: withdrawal._id,
      newValues: {
        amount: withdrawal.amount,
        approvedAt: now,
        loanAutomaticallyDisbursed: automaticallyDisbursed,
        note: withdrawal.reviewNote
      },
      session
    });

    savedWithdrawalId = withdrawal._id;
  });

  const savedWithdrawal = await Withdrawal.findById(savedWithdrawalId)
    .populate('customerId', 'customerCode name firstName middleName lastName phone')
    .populate('loanId', 'loanNumber status productSnapshot')
    .populate('approvedBy', 'displayName');

  publishChange({
    topics: ['withdrawals', 'applications', 'loans', 'dashboard', 'reports', 'notifications'],
    action: 'WITHDRAWAL_APPROVED',
    entityId: savedWithdrawal._id,
    roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    userIds: [customerUserId]
  });

  res.json({ success: true, item: savedWithdrawal });
});
