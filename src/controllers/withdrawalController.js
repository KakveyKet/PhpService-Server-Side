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
  expireWithdrawalCodes,
  walletSummaryForLoan
} from '../services/withdrawalService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextNumber } from '../utils/counter.js';
import { runDatabaseWork, sessionOptions } from '../utils/databaseWork.js';
import { toDecimal, toMoney } from '../utils/decimal.js';

const WITHDRAW_CODE_LIFETIME_MS = 10 * 60 * 1000;
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
const COMPLETED_WITHDRAWAL_REJECTION_REASONS = [
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

function withdrawCodeSecret() {
  const secret = process.env.WITHDRAW_CODE_PEPPER ||
    process.env.OTP_PEPPER ||
    process.env.JWT_SECRET;
  if (!secret) throw new AppError('Withdraw code service is not configured', 503);
  return secret;
}

function hashWithdrawCode(withdrawalId, code) {
  return crypto
    .createHmac('sha256', withdrawCodeSecret())
    .update(`${withdrawalId}:${code}`)
    .digest('hex');
}

function withdrawCodeMatches(expectedHash, actualHash) {
  if (!expectedHash || !actualHash) return false;
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(actualHash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function customerResponse(item) {
  const data = item.toObject ? item.toObject() : { ...item };
  delete data.withdrawCodeHash;
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
  await expireWithdrawalCodes();

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
      .populate('withdrawCodeSetBy', 'displayName')
      .populate('otpGeneratedBy', 'displayName')
      .populate('approvedBy', 'displayName')
      .populate('refundedBy', 'displayName')
      .populate('rejectedAfterCompletionBy', 'displayName')
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
      await expireWithdrawalCodes(session);
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

export const setWithdrawalCode = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '')
    .normalize('NFKC')
    .replace(/\D/g, '');
  if (!/^\d{6}$|^\d{8}$/.test(code)) {
    throw new AppError('Withdraw code must contain exactly 6 or 8 digits', 422);
  }

  let savedWithdrawalId;
  let customerUserId = null;

  await runDatabaseWork(async (session) => {
    await expireWithdrawalCodes(session);
    const withdrawal = await Withdrawal.findById(req.params.id)
      .select('+withdrawCodeHash +otpHash')
      .session(session);
    if (!withdrawal) throw new AppError('Withdrawal request not found', 404);
    if (![
      'PENDING_REVIEW',
      'WAITING_FOR_CODE',
      'WAITING_FOR_OTP',
      'OTP_REQUIRED',
      'OTP_VERIFIED'
    ].includes(withdrawal.status)) {
      throw new AppError('This withdrawal cannot receive a new withdraw code', 409);
    }

    const now = new Date();
    withdrawal.status = 'WAITING_FOR_CODE';
    withdrawal.isOpen = true;
    withdrawal.reviewNote = String(req.body.note || '').trim();
    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = now;
    withdrawal.withdrawCodeLength = code.length;
    withdrawal.withdrawCodeHash = hashWithdrawCode(withdrawal._id, code);
    withdrawal.withdrawCodeExpiresAt = new Date(
      now.getTime() + WITHDRAW_CODE_LIFETIME_MS
    );
    withdrawal.withdrawCodeAttempts = 0;
    withdrawal.withdrawCodeMaxAttempts = 5;
    withdrawal.withdrawCodeSetBy = req.user._id;
    withdrawal.withdrawCodeSetAt = now;
    withdrawal.withdrawCodeVerifiedAt = null;
    withdrawal.otpHash = undefined;
    withdrawal.otpExpiresAt = null;
    await withdrawal.save(sessionOptions(session));

    const customer = await Customer.findById(withdrawal.customerId).session(session);
    customerUserId = customer?.userId || null;
    await notifyCustomer({
      customer,
      title: 'Withdraw code ready',
      message: `${withdrawal.withdrawalNumber} is ready. Enter the ${code.length}-digit withdraw code provided by the administrator.`,
      referenceId: withdrawal._id,
      session
    });

    await writeAudit({
      req,
      action: 'WITHDRAWAL_CODE_SET',
      entityType: 'WITHDRAWAL',
      entityId: withdrawal._id,
      newValues: {
        withdrawCodeLength: code.length,
        withdrawCodeExpiresAt: withdrawal.withdrawCodeExpiresAt,
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
    .populate('reviewedBy', 'displayName')
    .populate('withdrawCodeSetBy', 'displayName');

  publishChange({
    topics: ['withdrawals', 'loans', 'notifications'],
    action: 'WITHDRAWAL_CODE_SET',
    entityId: savedWithdrawal._id,
    roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    userIds: [customerUserId]
  });

  res.json({ success: true, item: savedWithdrawal });
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
      .select('+withdrawCodeHash +otpHash')
      .session(session);
    if (!withdrawal) throw new AppError('Withdrawal request not found', 404);
    if (![
      'PENDING_REVIEW',
      'WAITING_FOR_CODE',
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
    withdrawal.withdrawCodeHash = undefined;
    withdrawal.withdrawCodeExpiresAt = null;
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

export const verifyWithdrawalCode = asyncHandler(async (req, res) => {
  const code = String(req.body.code || '')
    .normalize('NFKC')
    .replace(/\D/g, '');
  if (!/^\d{6}$|^\d{8}$/.test(code)) {
    throw new AppError('Enter the complete 6- or 8-digit withdraw code', 422);
  }

  let savedWithdrawalId;
  let customerUserId = null;
  let failure = null;
  let action = 'WITHDRAWAL_COMPLETED';

  await runDatabaseWork(async (session) => {
    const customer = await customerForUser(req.user._id, session);
    customerUserId = customer.userId;
    const withdrawal = await Withdrawal.findOne({
      _id: req.params.id,
      customerId: customer._id
    })
      .select('+withdrawCodeHash +otpHash')
      .session(session);
    if (!withdrawal) throw new AppError('Withdrawal request not found', 404);
    if (![
      'PENDING_REVIEW',
      'WAITING_FOR_CODE',
      'WAITING_FOR_OTP',
      'OTP_REQUIRED',
      'OTP_VERIFIED'
    ].includes(withdrawal.status)) {
      throw new AppError('This withdrawal is not waiting for a withdraw code', 409);
    }

    const expectedHash = withdrawal.withdrawCodeHash || withdrawal.otpHash;
    const expectedLength = withdrawal.withdrawCodeLength || withdrawal.otpLength;
    const expiresAt = withdrawal.withdrawCodeExpiresAt || withdrawal.otpExpiresAt;

    if (!expectedHash || !expectedLength || !expiresAt) {
      throw new AppError('The administrator has not set the withdraw code yet', 409);
    }

    if (expiresAt <= new Date()) {
      withdrawal.status = 'PENDING_REVIEW';
      withdrawal.isOpen = true;
      withdrawal.withdrawCodeHash = undefined;
      withdrawal.withdrawCodeExpiresAt = null;
      withdrawal.otpHash = undefined;
      withdrawal.otpExpiresAt = null;
      await withdrawal.save(sessionOptions(session));
      savedWithdrawalId = withdrawal._id;
      action = 'WITHDRAWAL_CODE_EXPIRED';
      failure = {
        message: 'The withdraw code expired. Ask the administrator to set a new code.',
        status: 410
      };
      return;
    }

    const currentAttempts = withdrawal.withdrawCodeHash
      ? withdrawal.withdrawCodeAttempts
      : withdrawal.otpAttempts;
    const maximumAttempts = withdrawal.withdrawCodeHash
      ? withdrawal.withdrawCodeMaxAttempts
      : withdrawal.otpMaxAttempts;
    const codeIsValid = code.length === expectedLength &&
      withdrawCodeMatches(expectedHash, hashWithdrawCode(withdrawal._id, code));

    if (!codeIsValid) {
      const nextAttempts = currentAttempts + 1;
      const attemptsRemaining = Math.max(maximumAttempts - nextAttempts, 0);

      if (withdrawal.withdrawCodeHash) {
        withdrawal.withdrawCodeAttempts = nextAttempts;
      } else {
        withdrawal.otpAttempts = nextAttempts;
      }

      if (!attemptsRemaining) {
        withdrawal.status = 'REJECTED';
        withdrawal.isOpen = false;
        withdrawal.rejectionReason = 'Withdraw code attempt limit reached';
        withdrawal.withdrawCodeHash = undefined;
        withdrawal.withdrawCodeExpiresAt = null;
        withdrawal.otpHash = undefined;
        withdrawal.otpExpiresAt = null;
        action = 'WITHDRAWAL_CODE_LOCKED';
        failure = {
          message: 'The withdrawal was rejected after too many incorrect code attempts.',
          status: 429
        };
      } else {
        failure = {
          message: `Incorrect withdraw code. ${attemptsRemaining} attempts remaining.`,
          status: 422
        };
      }

      await withdrawal.save(sessionOptions(session));
      savedWithdrawalId = withdrawal._id;
      return;
    }

    const loan = await Loan.findById(withdrawal.loanId).session(session);
    if (!loan) throw new AppError('Related loan not found', 404);
    if (!['APPROVED', 'ACTIVE'].includes(loan.status)) {
      throw new AppError('The related loan is no longer eligible for withdrawal', 409);
    }

    const wallet = await walletSummaryForLoan(loan, session);
    if (toDecimal(withdrawal.amount).gt(toDecimal(wallet.availableBalance))) {
      throw new AppError('Withdrawal amount exceeds the available wallet balance', 409);
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
          description: 'Loan automatically disbursed after withdraw code verification',
          transactionDate: now,
          createdBy: req.user._id
        }],
        sessionOptions(session)
      );
    }

    withdrawal.status = 'COMPLETED';
    withdrawal.isOpen = false;
    withdrawal.withdrawCodeVerifiedAt = now;
    withdrawal.completedAt = now;
    withdrawal.withdrawCodeHash = undefined;
    withdrawal.withdrawCodeExpiresAt = null;
    withdrawal.otpHash = undefined;
    withdrawal.otpExpiresAt = null;
    await withdrawal.save(sessionOptions(session));

    await LoanTransaction.create(
      [{
        transactionNumber: await nextNumber('transaction', 'TRX', session),
        loanId: withdrawal.loanId,
        transactionType: 'WITHDRAWAL',
        amount: withdrawal.amount,
        referenceType: 'WITHDRAWAL',
        referenceId: withdrawal._id,
        description: `Wallet withdrawal ${withdrawal.withdrawalNumber}`,
        transactionDate: now,
        createdBy: req.user._id
      }],
      sessionOptions(session)
    );

    await notifyCustomer({
      customer,
      title: 'Withdrawal successful',
      message: `${withdrawal.withdrawalNumber} was completed successfully.`,
      referenceId: withdrawal._id,
      session
    });

    await writeAudit({
      req,
      action: 'WITHDRAWAL_COMPLETED',
      entityType: 'WITHDRAWAL',
      entityId: withdrawal._id,
      newValues: {
        amount: withdrawal.amount,
        completedAt: now,
        loanAutomaticallyDisbursed: automaticallyDisbursed,
        status: withdrawal.status
      },
      session
    });

    savedWithdrawalId = withdrawal._id;
  });

  const savedWithdrawal = await Withdrawal.findById(savedWithdrawalId)
    .populate('loanId', 'loanNumber status productSnapshot');

  publishChange({
    topics: [
      'withdrawals',
      'applications',
      'loans',
      'dashboard',
      'reports',
      'notifications'
    ],
    action,
    entityId: savedWithdrawal._id,
    roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    userIds: [customerUserId]
  });

  if (failure) throw new AppError(failure.message, failure.status);
  res.json({ success: true, item: customerResponse(savedWithdrawal) });
});

export const rejectCompletedWithdrawal = asyncHandler(async (req, res) => {
  const reason = requiredText(req.body.reason, 'Rejection reason', 500);
  if (!COMPLETED_WITHDRAWAL_REJECTION_REASONS.includes(reason)) {
    throw new AppError('Select a valid withdrawal rejection reason', 422);
  }
  let savedWithdrawalId;
  let customerUserId = null;

  await runDatabaseWork(async (session) => {
    const withdrawal = await Withdrawal.findById(req.params.id).session(session);
    if (!withdrawal) throw new AppError('Withdrawal request not found', 404);
    if (!['COMPLETED', 'APPROVED'].includes(withdrawal.status)) {
      throw new AppError('Only a successful withdrawal can be rejected', 409);
    }

    const now = new Date();
    withdrawal.status = 'REJECTED';
    withdrawal.isOpen = false;
    withdrawal.rejectedAfterCompletionBy = req.user._id;
    withdrawal.rejectedAfterCompletionAt = now;
    withdrawal.rejectionReason = reason;
    await withdrawal.save(sessionOptions(session));

    await LoanTransaction.create(
      [{
        transactionNumber: await nextNumber('transaction', 'TRX', session),
        loanId: withdrawal.loanId,
        transactionType: 'REVERSAL',
        amount: withdrawal.amount,
        referenceType: 'WITHDRAWAL',
        referenceId: withdrawal._id,
        description: `Reversal after rejecting ${withdrawal.withdrawalNumber}: ${reason}`,
        transactionDate: now,
        createdBy: req.user._id
      }],
      sessionOptions(session)
    );

    const customer = await Customer.findById(withdrawal.customerId).session(session);
    customerUserId = customer?.userId || null;
    await notifyCustomer({
      customer,
      title: 'Withdrawal rejected',
      message: `${withdrawal.withdrawalNumber} was rejected and the amount was returned to your wallet.`,
      referenceId: withdrawal._id,
      session
    });

    await writeAudit({
      req,
      action: 'WITHDRAWAL_REJECTED_AFTER_COMPLETION',
      entityType: 'WITHDRAWAL',
      entityId: withdrawal._id,
      newValues: {
        amount: withdrawal.amount,
        rejectedAfterCompletionAt: now,
        reason
      },
      session
    });

    savedWithdrawalId = withdrawal._id;
  });

  const savedWithdrawal = await Withdrawal.findById(savedWithdrawalId)
    .populate('customerId', 'customerCode name firstName middleName lastName phone')
    .populate('loanId', 'loanNumber status productSnapshot')
    .populate('rejectedAfterCompletionBy', 'displayName');

  publishChange({
    topics: ['withdrawals', 'applications', 'loans', 'dashboard', 'reports', 'notifications'],
    action: 'WITHDRAWAL_REJECTED_AFTER_COMPLETION',
    entityId: savedWithdrawal._id,
    roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    userIds: [customerUserId]
  });

  res.json({ success: true, item: savedWithdrawal });
});
