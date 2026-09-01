import mongoose from 'mongoose';

const bankSnapshotSchema = new mongoose.Schema(
  {
    bankName: { type: String, trim: true, default: '' },
    bankAccountNumber: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const bankMatchSchema = new mongoose.Schema(
  {
    bankName: { type: Boolean, default: false },
    bankAccountNumber: { type: Boolean, default: false }
  },
  { _id: false }
);

const withdrawalSchema = new mongoose.Schema(
  {
    withdrawalNumber: { type: String, required: true, unique: true, index: true },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true
    },
    loanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Loan',
      required: true,
      index: true
    },
    amount: { type: mongoose.Schema.Types.Decimal128, required: true },
    requestedBank: { type: bankSnapshotSchema, required: true },
    customerBankSnapshot: { type: bankSnapshotSchema, required: true },
    bankMatch: { type: bankMatchSchema, default: () => ({}) },
    status: {
      type: String,
      enum: [
        'PENDING_REVIEW',
        'WAITING_FOR_CODE',
        'WAITING_FOR_OTP',
        'OTP_VERIFIED',
        'APPROVED',
        // Kept for compatibility with requests created by v15/v16.
        'OTP_REQUIRED',
        'COMPLETED',
        'REFUNDED',
        'REJECTED',
        'EXPIRED',
        'CANCELLED'
      ],
      default: 'PENDING_REVIEW',
      index: true
    },
    isOpen: { type: Boolean, default: true, index: true },
    reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 500, default: '' },
    withdrawCodeHash: { type: String, select: false, default: null },
    withdrawCodeLength: { type: Number, enum: [6, 8], default: null },
    withdrawCodeExpiresAt: { type: Date, default: null, index: true },
    withdrawCodeAttempts: { type: Number, default: 0 },
    withdrawCodeMaxAttempts: { type: Number, default: 5 },
    withdrawCodeSetBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    withdrawCodeSetAt: { type: Date, default: null },
    withdrawCodeVerifiedAt: { type: Date, default: null },
    // Legacy OTP fields remain so existing requests can still be read safely.
    otpHash: { type: String, select: false, default: null },
    otpLength: { type: Number, enum: [6, 8], default: null },
    otpExpiresAt: { type: Date, default: null, index: true },
    otpAttempts: { type: Number, default: 0 },
    otpMaxAttempts: { type: Number, default: 5 },
    otpGeneratedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    otpGeneratedAt: { type: Date, default: null },
    otpVerifiedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    refundedAt: { type: Date, default: null },
    refundReason: { type: String, trim: true, maxlength: 500, default: '' },
    rejectedAfterCompletionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    rejectedAfterCompletionAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

// Only one request may reserve money from the same loan at a time.
withdrawalSchema.index(
  { loanId: 1, isOpen: 1 },
  { unique: true, partialFilterExpression: { isOpen: true } }
);
withdrawalSchema.index({ customerId: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('Withdrawal', withdrawalSchema);
