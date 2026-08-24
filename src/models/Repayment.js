import mongoose from 'mongoose';

const allocationSchema = new mongoose.Schema(
  {
    installmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Installment', required: true },
    principalAmount: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    interestAmount: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    feeAmount: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    penaltyAmount: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    totalAmount: { type: mongoose.Schema.Types.Decimal128, required: true }
  },
  { _id: true }
);

const repaymentSchema = new mongoose.Schema(
  {
    receiptNumber: { type: String, required: true, unique: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    currency: { type: String, enum: ['PHP'], default: 'PHP' },
    paymentMethod: {
      type: String,
      enum: ['CASH', 'BANK_TRANSFER', 'GCASH', 'MAYA', 'OTHER'],
      required: true
    },
    transactionReference: { type: String, default: '' },
    paymentDate: { type: Date, default: Date.now },
    allocations: [allocationSchema],
    note: { type: String, default: '' },
    status: { type: String, enum: ['PENDING', 'CONFIRMED', 'REVERSED'], default: 'CONFIRMED' },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedAt: { type: Date, default: Date.now },
    reversal: {
      reason: { type: String, default: '' },
      reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reversedAt: { type: Date, default: null }
    }
  },
  { timestamps: true }
);

repaymentSchema.index({ loanId: 1, paymentDate: -1 });

export default mongoose.model('Repayment', repaymentSchema);
