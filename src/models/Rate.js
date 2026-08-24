import mongoose from 'mongoose';

const rateSchema = new mongoose.Schema(
  {
    rateCode: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    ratePercent: { type: mongoose.Schema.Types.Decimal128, required: true },
    period: {
      type: String,
      enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'],
      default: 'MONTHLY'
    },
    calculationMethod: {
      type: String,
      enum: ['FLAT', 'REDUCING_BALANCE'],
      default: 'FLAT'
    },
    effectiveFrom: { type: Date, default: Date.now },
    effectiveTo: { type: Date, default: null },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export default mongoose.model('Rate', rateSchema);
