import mongoose from 'mongoose';

const approvalSchema = new mongoose.Schema(
  {
    decision: { type: String, enum: ['APPROVED', 'REJECTED', 'RETURNED'], required: true },
    approvedAmount: { type: mongoose.Schema.Types.Decimal128, default: null },
    approvedTerm: { type: Number, default: null },
    comment: { type: String, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const loanApplicationSchema = new mongoose.Schema(
  {
    applicationNumber: { type: String, required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    requestedAmount: { type: mongoose.Schema.Types.Decimal128, required: true },
    requestedTerm: { type: Number, required: true, min: 1 },
    purpose: { type: String, required: true, trim: true },
    monthlyIncome: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    monthlyExpense: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    collateralDescription: { type: String, default: '' },
    attachments: [
      {
        documentType: { type: String, required: true },
        filePath: { type: String, required: true },
        description: { type: String, default: '' }
      }
    ],
    status: {
      type: String,
      enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'DISBURSED'],
      default: 'SUBMITTED',
      index: true
    },
    approvalHistory: [approvalSchema],
    submittedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

loanApplicationSchema.index({ customerId: 1, status: 1, createdAt: -1 });

export default mongoose.model('LoanApplication', loanApplicationSchema);
