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

const identityImageSchema = new mongoose.Schema(
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

const customerSchema = new mongoose.Schema(
  {
    customerCode: { type: String, required: true, unique: true, trim: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      unique: true,
      sparse: true
    },
    name: { type: String, trim: true, default: '' },
    // Legacy name fields remain readable for existing records. New updates use name.
    firstName: { type: String, trim: true, default: '' },
    middleName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'], default: null },
    dateOfBirth: { type: Date, default: null },
    nationalId: { type: String, unique: true, sparse: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    email: { type: String, trim: true, lowercase: true, default: '' },
    bankName: { type: String, trim: true, default: '' },
    bankNumber: { type: String, trim: true, default: '' },
    occupation: { type: String, trim: true, default: '' },
    monthlyIncome: {
      type: mongoose.Schema.Types.Decimal128,
      default: () => '0.00'
    },
    address: { type: addressSchema, default: () => ({}) },
    documents: [documentSchema],
    frontIdCard: { type: identityImageSchema, default: null },
    backIdCard: { type: identityImageSchema, default: null },
    selfieWithId: { type: identityImageSchema, default: null },
    identityVerificationStatus: {
      type: String,
      enum: ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'],
      default: 'NOT_SUBMITTED',
      index: true
    },
    identityVerificationNote: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },
    identityVerifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    identityVerifiedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'BLACKLISTED'],
      default: 'ACTIVE',
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
);

customerSchema.virtual('fullName').get(function fullName() {
  return (
    this.name ||
    [this.firstName, this.middleName, this.lastName].filter(Boolean).join(' ')
  );
});

customerSchema.set('toJSON', { virtuals: true });
customerSchema.index({
  firstName: 'text',
  middleName: 'text',
  lastName: 'text',
  name: 'text',
  phone: 'text'
});

export default mongoose.model('Customer', customerSchema);
