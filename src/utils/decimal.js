import Decimal from 'decimal.js';
import mongoose from 'mongoose';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export function toDecimal(value = 0) {
  if (value?._bsontype === 'Decimal128') return new Decimal(value.toString());
  return new Decimal(value ?? 0);
}

export function toMoney(value = 0) {
  return mongoose.Types.Decimal128.fromString(toDecimal(value).toDecimalPlaces(2).toFixed(2));
}

export function toRate(value = 0) {
  return mongoose.Types.Decimal128.fromString(toDecimal(value).toDecimalPlaces(6).toFixed(6));
}

export function decimalString(value = 0, places = 2) {
  return toDecimal(value).toDecimalPlaces(places).toFixed(places);
}
