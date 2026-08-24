import mongoose from 'mongoose';

const contractTemplateSchema = new mongoose.Schema(
  {
    templateCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      default: 'LOAN_CONTRACT'
    },
    title: {
      type: String,
      required: true,
      trim: true,
      default: 'Loan Contract'
    },
    beneficiaryBankName: {
      type: String,
      trim: true,
      default: ''
    },
    body: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE'
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  { timestamps: true }
);

export default mongoose.model('ContractTemplate', contractTemplateSchema);
