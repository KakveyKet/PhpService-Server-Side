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

const securedImageSchema = new mongoose.Schema(
  {
    assetId: { type: String, default: '' },
    publicId: { type: String, required: true },
    version: { type: Number, default: null },
    format: { type: String, required: true },
    resourceType: { type: String, default: 'image' },
    deliveryType: { type: String, default: 'authenticated' },
    bytes: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    originalFilename: { type: String, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const applicantSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    idCardNumber: { type: String, trim: true, default: '' },
    bankName: { type: String, trim: true, default: '' },
    bankAccountNumber: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const loanApplicationSchema = new mongoose.Schema(
  {
    applicationNumber: { type: String, required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    requestedAmount: { type: mongoose.Schema.Types.Decimal128, required: true },
    requestedTerm: { type: Number, required: true, min: 1 },
    purpose: { type: String, required: true, trim: true },
    applicantSnapshot: {
      type: applicantSnapshotSchema,
      default: () => ({})
    },
    termsAcceptedAt: { type: Date, default: null },
    termsVersion: { type: String, trim: true, default: '' },
    signature: { type: securedImageSchema, default: null },
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
