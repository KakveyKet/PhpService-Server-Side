import mongoose from 'mongoose';

const loanSchema = new mongoose.Schema(
  {
    loanNumber: { type: String, required: true, unique: true },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoanApplication',
      required: true,
      unique: true
    },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productSnapshot: {
      productCode: String,
      name: String,
      repaymentFrequency: String,
      termUnit: String
    },
    principalAmount: { type: mongoose.Schema.Types.Decimal128, required: true },
    rateSnapshot: {
      rateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Rate' },
      ratePercent: { type: mongoose.Schema.Types.Decimal128, required: true },
      period: { type: String, required: true },
      calculationMethod: { type: String, required: true }
    },
    term: { type: Number, required: true, min: 1 },
    termUnit: { type: String, enum: ['DAY', 'WEEK', 'MONTH', 'YEAR'], required: true },
    repaymentFrequency: { type: String, enum: ['DAILY', 'WEEKLY', 'MONTHLY'], required: true },
    processingFee: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    totalInterest: { type: mongoose.Schema.Types.Decimal128, required: true },
    totalPayable: { type: mongoose.Schema.Types.Decimal128, required: true },
    balances: {
      principal: { type: mongoose.Schema.Types.Decimal128, required: true },
      interest: { type: mongoose.Schema.Types.Decimal128, required: true },
      fees: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
      penalties: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
      total: { type: mongoose.Schema.Types.Decimal128, required: true },
      totalPaid: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' }
    },
    currency: { type: String, enum: ['PHP'], default: 'PHP' },
    startDate: { type: Date, required: true },
    maturityDate: { type: Date, required: true },
    disbursedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['APPROVED', 'ACTIVE', 'OVERDUE', 'COMPLETED', 'CANCELLED', 'WRITTEN_OFF'],
      default: 'APPROVED',
      index: true
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

loanSchema.index({ customerId: 1, status: 1, createdAt: -1 });

export default mongoose.model('Loan', loanSchema);
