import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import Customer from '../src/models/Customer.js';

function customer(overrides = {}) {
  return new Customer({
    customerCode: 'CUS-CREDIT-TEST',
    phone: '+639000000000',
    createdBy: new mongoose.Types.ObjectId(),
    ...overrides
  });
}

test('new customer starts with zero credit', () => {
  const item = customer();

  assert.equal(item.creditScore, 0);
  assert.equal(item.firstApplicationCreditGranted, false);
});

test('customer credit accepts whole scores from 0 to 10000', async () => {
  await customer({ creditScore: 0 }).validate();
  await customer({ creditScore: 250 }).validate();
  await customer({ creditScore: 10000 }).validate();
});

test('customer credit rejects scores outside its range', async () => {
  await assert.rejects(
    customer({ creditScore: -1 }).validate(),
    (error) => Boolean(error?.errors?.creditScore)
  );

  await assert.rejects(
    customer({ creditScore: 10001 }).validate(),
    (error) => Boolean(error?.errors?.creditScore)
  );
});
