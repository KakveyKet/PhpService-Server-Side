import assert from 'node:assert/strict';
import test from 'node:test';
import { generateLoanSchedule } from '../src/services/loanScheduleService.js';

test('generates a flat monthly schedule in PHP', () => {
  const result = generateLoanSchedule({
    principal: '10000',
    term: 5,
    ratePercent: '0.7',
    ratePeriod: 'MONTHLY',
    calculationMethod: 'FLAT',
    repaymentFrequency: 'MONTHLY',
    processingFeePercent: '1',
    startDate: new Date('2026-01-01T00:00:00.000Z')
  });

  assert.equal(result.installments.length, 5);
  assert.equal(result.totalInterest.toString(), '350.00');
  assert.equal(result.processingFee.toString(), '100.00');
  assert.equal(result.totalPayable.toString(), '10450.00');
  assert.equal(result.installments[0].totalDue.toString(), '2170.00');
});

test('generates reducing-balance interest', () => {
  const result = generateLoanSchedule({
    principal: '10000',
    term: 2,
    ratePercent: '1',
    ratePeriod: 'MONTHLY',
    calculationMethod: 'REDUCING_BALANCE',
    repaymentFrequency: 'MONTHLY'
  });

  assert.equal(result.installments[0].interestDue.toString(), '100.00');
  assert.equal(result.installments[1].interestDue.toString(), '50.00');
  assert.equal(result.totalInterest.toString(), '150.00');
});
