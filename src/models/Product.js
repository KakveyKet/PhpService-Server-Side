import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    productCode: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    rateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rate', required: true },
    minimumAmount: { type: mongoose.Schema.Types.Decimal128, required: true },
    maximumAmount: { type: mongoose.Schema.Types.Decimal128, required: true },
    minimumTerm: { type: Number, required: true, min: 1 },
    maximumTerm: { type: Number, required: true, min: 1 },
    termUnit: { type: String, enum: ['DAY', 'WEEK', 'MONTH', 'YEAR'], default: 'MONTH' },
    repaymentFrequency: {
      type: String,
      enum: ['DAILY', 'WEEKLY', 'MONTHLY'],
      default: 'MONTHLY'
    },
    processingFeePercent: { type: mongoose.Schema.Types.Decimal128, default: () => '0.000000' },
    lateFeeType: { type: String, enum: ['NONE', 'FIXED', 'PERCENTAGE'], default: 'NONE' },
    lateFeeValue: { type: mongoose.Schema.Types.Decimal128, default: () => '0.000000' },
    gracePeriodDays: { type: Number, default: 0, min: 0 },
    currency: { type: String, enum: ['PHP'], default: 'PHP' },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

export default mongoose.model('Product', productSchema);
