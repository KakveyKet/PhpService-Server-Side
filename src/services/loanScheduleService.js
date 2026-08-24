import Decimal from 'decimal.js';
import { toDecimal, toMoney } from '../utils/decimal.js';

function addPaymentPeriod(date, frequency, amount = 1) {
  const result = new Date(date);
  if (frequency === 'DAILY') result.setUTCDate(result.getUTCDate() + amount);
  if (frequency === 'WEEKLY') result.setUTCDate(result.getUTCDate() + amount * 7);
  if (frequency === 'MONTHLY') result.setUTCMonth(result.getUTCMonth() + amount);
  return result;
}

export function generateLoanSchedule({
  principal,
  term,
  ratePercent,
  ratePeriod,
  calculationMethod,
  repaymentFrequency,
  processingFeePercent = 0,
  startDate = new Date()
}) {
  const expectedPeriod = `${repaymentFrequency.slice(0, -2)}LY`;
  if (ratePeriod !== expectedPeriod) {
    throw new Error(`Rate period ${ratePeriod} must match repayment frequency ${repaymentFrequency}`);
  }

  const principalValue = toDecimal(principal);
  const rate = toDecimal(ratePercent).div(100);
  const fee = principalValue.mul(toDecimal(processingFeePercent).div(100)).toDecimalPlaces(2);
  const regularPrincipal = principalValue.div(term).toDecimalPlaces(2);

  let principalAllocated = new Decimal(0);
  let totalInterest = new Decimal(0);
  let openingBalance = principalValue;
  const installments = [];

  for (let index = 1; index <= term; index += 1) {
    const principalDue = index === term
      ? principalValue.minus(principalAllocated)
      : regularPrincipal;
    const interestDue = calculationMethod === 'FLAT'
      ? principalValue.mul(rate).toDecimalPlaces(2)
      : openingBalance.mul(rate).toDecimalPlaces(2);
    const feeDue = index === 1 ? fee : new Decimal(0);
    const totalDue = principalDue.plus(interestDue).plus(feeDue);

    installments.push({
      installmentNumber: index,
      dueDate: addPaymentPeriod(startDate, repaymentFrequency, index),
      openingBalance: toMoney(openingBalance),
      principalDue: toMoney(principalDue),
      interestDue: toMoney(interestDue),
      feeDue: toMoney(feeDue),
      penaltyDue: toMoney(0),
      totalDue: toMoney(totalDue),
      principalPaid: toMoney(0),
      interestPaid: toMoney(0),
      feePaid: toMoney(0),
      penaltyPaid: toMoney(0),
      totalPaid: toMoney(0),
      remainingDue: toMoney(totalDue),
      status: 'PENDING'
    });

    principalAllocated = principalAllocated.plus(principalDue);
    totalInterest = totalInterest.plus(interestDue);
    openingBalance = openingBalance.minus(principalDue);
  }

  const totalPayable = principalValue.plus(totalInterest).plus(fee);

  return {
    installments,
    processingFee: toMoney(fee),
    totalInterest: toMoney(totalInterest),
    totalPayable: toMoney(totalPayable),
    maturityDate: installments.at(-1).dueDate
  };
}
