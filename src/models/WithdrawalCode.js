import mongoose from 'mongoose';

const withdrawalCodeSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true
    },
    codeHash: { type: String, required: true, select: false },
    codeLength: { type: Number, enum: [6, 8], required: true },
    status: {
      type: String,
      enum: ['ACTIVE', 'USED', 'REVOKED', 'EXPIRED'],
      default: 'ACTIVE',
      index: true
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
    withdrawalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Withdrawal',
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
);

withdrawalCodeSchema.index({ customerId: 1, status: 1, createdAt: -1 });
withdrawalCodeSchema.index(
  { customerId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'ACTIVE' }
  }
);

export default mongoose.model('WithdrawalCode', withdrawalCodeSchema);
