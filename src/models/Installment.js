import mongoose from 'mongoose';

const installmentSchema = new mongoose.Schema(
  {
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    installmentNumber: { type: Number, required: true, min: 1 },
    dueDate: { type: Date, required: true, index: true },
    openingBalance: { type: mongoose.Schema.Types.Decimal128, required: true },
    principalDue: { type: mongoose.Schema.Types.Decimal128, required: true },
    interestDue: { type: mongoose.Schema.Types.Decimal128, required: true },
    feeDue: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    penaltyDue: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    totalDue: { type: mongoose.Schema.Types.Decimal128, required: true },
    principalPaid: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    interestPaid: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    feePaid: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    penaltyPaid: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    totalPaid: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    remainingDue: { type: mongoose.Schema.Types.Decimal128, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED'],
      default: 'PENDING',
      index: true
    },
    paidAt: { type: Date, default: null }
  },
  { timestamps: true }
);

installmentSchema.index({ loanId: 1, installmentNumber: 1 }, { unique: true });
installmentSchema.index({ dueDate: 1, status: 1 });

export default mongoose.model('Installment', installmentSchema);
