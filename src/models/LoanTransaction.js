import mongoose from 'mongoose';

const loanTransactionSchema = new mongoose.Schema(
  {
    transactionNumber: { type: String, required: true, unique: true },
    loanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    transactionType: {
      type: String,
      enum: [
        'DISBURSEMENT',
        'WITHDRAWAL',
        'REPAYMENT',
        'INTEREST_CHARGE',
        'FEE_CHARGE',
        'PENALTY_CHARGE',
        'WAIVER',
        'ADJUSTMENT',
        'REVERSAL'
      ],
      required: true
    },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    breakdown: {
      principal: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
      interest: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
      fee: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
      penalty: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' }
    },
    referenceType: { type: String, default: '' },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    description: { type: String, default: '' },
    transactionDate: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

loanTransactionSchema.index({ loanId: 1, transactionDate: -1 });

export default mongoose.model('LoanTransaction', loanTransactionSchema);
