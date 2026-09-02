import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import WithdrawalCode from '../src/models/WithdrawalCode.js';

function codeDocument(codeLength = 6) {
  return new WithdrawalCode({
    customerId: new mongoose.Types.ObjectId(),
    codeHash: 'a'.repeat(64),
    codeLength,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdBy: new mongoose.Types.ObjectId()
  });
}

test('withdrawal code accepts 6-digit and 8-digit configurations', async () => {
  await codeDocument(6).validate();
  await codeDocument(8).validate();
});

test('withdrawal code rejects unsupported lengths', async () => {
  await assert.rejects(
    codeDocument(7).validate(),
    (error) => Boolean(error?.errors?.codeLength)
  );
});

test('withdrawal code hash is hidden from normal queries', () => {
  assert.equal(WithdrawalCode.schema.path('codeHash').options.select, false);
  assert.equal(WithdrawalCode.schema.path('code'), undefined);
});

test('withdrawal code supports its full one-time lifecycle', async () => {
  for (const status of ['ACTIVE', 'USED', 'REVOKED', 'EXPIRED']) {
    const item = codeDocument();
    item.status = status;
    await item.validate();
  }
});
