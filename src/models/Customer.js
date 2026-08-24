import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema(
  {
    street: { type: String, trim: true, default: '' },
    barangay: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    province: { type: String, trim: true, default: '' },
    postalCode: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    documentType: {
      type: String,
      enum: ['NATIONAL_ID', 'PHOTO', 'INCOME_PROOF', 'OTHER'],
      required: true
    },
    documentNumber: { type: String, trim: true, default: '' },
    filePath: { type: String, required: true },
    verificationStatus: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'REJECTED'],
      default: 'PENDING'
    },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

const customerSchema = new mongoose.Schema(
  {
    customerCode: { type: String, required: true, unique: true, trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true },
    firstName: { type: String, required: true, trim: true },
    middleName: { type: String, trim: true, default: '' },
    lastName: { type: String, required: true, trim: true },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'], default: null },
    dateOfBirth: { type: Date, default: null },
    nationalId: { type: String, unique: true, sparse: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    occupation: { type: String, trim: true, default: '' },
    monthlyIncome: { type: mongoose.Schema.Types.Decimal128, default: () => '0.00' },
    address: { type: addressSchema, default: () => ({}) },
    documents: [documentSchema],
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'BLACKLISTED'],
      default: 'ACTIVE',
      index: true
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

customerSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.middleName, this.lastName].filter(Boolean).join(' ');
});

customerSchema.set('toJSON', { virtuals: true });
customerSchema.index({ firstName: 'text', middleName: 'text', lastName: 'text', phone: 'text' });

export default mongoose.model('Customer', customerSchema);
