import Withdrawal from '../models/Withdrawal.js';
import { toDecimal, toMoney } from '../utils/decimal.js';

export const RESERVED_WITHDRAWAL_STATUSES = [
  'PENDING_REVIEW',
  'WAITING_FOR_CODE',
  'WAITING_FOR_OTP',
  'OTP_VERIFIED',
  'OTP_REQUIRED'
];
export const COMMITTED_WITHDRAWAL_STATUSES = [
  ...RESERVED_WITHDRAWAL_STATUSES,
  'APPROVED',
  'COMPLETED'
];

export async function expireWithdrawalCodes(session = null) {
  const options = session ? { session } : {};
  await Withdrawal.updateMany(
    {
      status: { $in: ['WAITING_FOR_CODE', 'WAITING_FOR_OTP', 'OTP_REQUIRED'] },
      isOpen: true,
      $or: [
        { withdrawCodeExpiresAt: { $lte: new Date() } },
        { otpExpiresAt: { $lte: new Date() } }
      ]
    },
    {
      $set: { status: 'PENDING_REVIEW', isOpen: true },
      $unset: {
        withdrawCodeHash: 1,
        withdrawCodeExpiresAt: 1,
        otpHash: 1,
        otpExpiresAt: 1
      }
    },
    options
  );
}

export async function withdrawalTotalsForLoan(loanId, session = null) {
  const aggregate = Withdrawal.aggregate([
    {
      $match: {
        loanId,
        status: { $in: COMMITTED_WITHDRAWAL_STATUSES }
      }
    },
    {
      $group: {
        _id: '$status',
        amount: { $sum: '$amount' }
      }
    }
  ]);
  if (session) aggregate.session(session);
  const rows = await aggregate;

  let reserved = toDecimal(0);
  let withdrawn = toDecimal(0);

  for (const row of rows) {
    if (RESERVED_WITHDRAWAL_STATUSES.includes(row._id)) {
      reserved = reserved.plus(toDecimal(row.amount));
    }
    if (['APPROVED', 'COMPLETED'].includes(row._id)) {
      withdrawn = withdrawn.plus(toDecimal(row.amount));
    }
  }

  return {
    reserved,
    withdrawn,
    committed: reserved.plus(withdrawn)
  };
}

export function walletSummaryFromTotals(principalAmount, totals) {
  const principal = toDecimal(principalAmount);

  // Legacy pending requests do not change the visible balance. Money leaves
  // the wallet only when a withdraw code completes the withdrawal.
  const available = principal.minus(totals.withdrawn);

  return {
    availableBalance: toMoney(available.lessThan(0) ? 0 : available),
    reservedBalance: toMoney(totals.reserved),
    withdrawnAmount: toMoney(totals.withdrawn),
    originalBalance: toMoney(principal)
  };
}

export async function walletSummaryForLoan(loan, session = null) {
  await expireWithdrawalCodes(session);
  const totals = await withdrawalTotalsForLoan(loan._id, session);
  return walletSummaryFromTotals(loan.principalAmount, totals);
}
