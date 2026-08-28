import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import Withdrawal from '../src/models/Withdrawal.js';

function withdrawalWithOtpLength(otpLength) {
  return new Withdrawal({
    withdrawalNumber: `WDR-TEST-${otpLength}`,
    customerId: new mongoose.Types.ObjectId(),
    loanId: new mongoose.Types.ObjectId(),
    amount: '1000.00',
    requestedBank: {
      bankName: 'Test Bank',
      bankAccountNumber: '1234567890'
    },
    customerBankSnapshot: {
      bankName: 'Test Bank',
      bankAccountNumber: '1234567890'
    },
    otpLength,
    createdBy: new mongoose.Types.ObjectId()
  });
}

test('withdrawal accepts 6-digit and 8-digit OTP configurations', async () => {
  await withdrawalWithOtpLength(6).validate();
  await withdrawalWithOtpLength(8).validate();
});

test('withdrawal rejects unsupported OTP lengths', async () => {
  await assert.rejects(
    withdrawalWithOtpLength(7).validate(),
    (error) => Boolean(error?.errors?.otpLength)
  );
});

test('withdrawal stores only a hidden OTP hash field', () => {
  assert.equal(Withdrawal.schema.path('otpHash').options.select, false);
  assert.equal(Withdrawal.schema.path('otp'), undefined);
});

test('withdrawal supports the staged OTP and final approval statuses', async () => {
  for (const status of ['PENDING_REVIEW', 'WAITING_FOR_OTP', 'OTP_VERIFIED', 'APPROVED']) {
    const withdrawal = withdrawalWithOtpLength(6);
    withdrawal.status = status;
    await withdrawal.validate();
  }
});
