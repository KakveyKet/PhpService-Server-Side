import Customer from '../models/Customer.js';
import Installment from '../models/Installment.js';
import Loan from '../models/Loan.js';
import LoanApplication from '../models/LoanApplication.js';
import LoanTransaction from '../models/LoanTransaction.js';
import Notification from '../models/Notification.js';
import Repayment from '../models/Repayment.js';
import User from '../models/User.js';
import { getCloudinary } from '../config/cloudinary.js';
import { ROLES } from '../constants/index.js';
import { writeAudit } from '../services/auditService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextNumber } from '../utils/counter.js';
import { runDatabaseWork, sessionOptions } from '../utils/databaseWork.js';
import { toMoney } from '../utils/decimal.js';
import { isValidPhone, normalizePhone } from '../utils/phone.js';

const customerPopulate = {
  path: 'userId',
  select: 'username phone status roleId',
  populate: {
    path: 'roleId',
    select: 'name displayName'
  }
};

function uploadImageBuffer(buffer, options) {
  const cloudinary = getCloudinary();

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
}

function selfieMetadata(result, file, userId) {
  return {
    assetId: result.asset_id || '',
    publicId: result.public_id,
    version: result.version || null,
    format: result.format,
    resourceType: result.resource_type || 'image',
    deliveryType: result.type || 'authenticated',
    bytes: result.bytes || file.size || 0,
    width: result.width || 0,
    height: result.height || 0,
    originalFilename: file.originalname || '',
    uploadedBy: userId,
    uploadedAt: new Date()
  };
}

function privateImageUrl(image) {
  const cloudinary = getCloudinary();
  const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;

  return {
    url: cloudinary.utils.private_download_url(
      image.publicId,
      image.format,
      {
        resource_type: 'image',
        type: image.deliveryType || 'authenticated',
        expires_at: expiresAt,
        attachment: false
      }
    ),
    expiresAt
  };
}

export const listCustomers = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const filter = {};

  if (req.query.status) filter.status = req.query.status;

  if (req.query.q) {
    filter.$or = [
      { customerCode: { $regex: req.query.q, $options: 'i' } },
      { name: { $regex: req.query.q, $options: 'i' } },
      { firstName: { $regex: req.query.q, $options: 'i' } },
      { lastName: { $regex: req.query.q, $options: 'i' } },
      { phone: { $regex: req.query.q, $options: 'i' } }
    ];
  }

  const [items, total] = await Promise.all([
    Customer.find(filter)
      .populate(customerPopulate)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Customer.countDocuments(filter)
  ]);

  res.json({
    success: true,
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

export const getMyCustomer = asyncHandler(async (req, res) => {
  if (req.role !== ROLES.CUSTOMER) {
    throw new AppError('Customer account required', 403);
  }

  // Bank details are intentionally excluded from the normal profile response.
  // The customer must verify their password through getMyBankDetails first.
  const customer = await Customer.findOne({ userId: req.user._id }).select(
    '-bankName -bankNumber'
  );
  if (!customer) throw new AppError('Customer profile not found', 404);

  res.json({ success: true, item: customer });
});

export const getMyBankDetails = asyncHandler(async (req, res) => {
  if (req.role !== ROLES.CUSTOMER) {
    throw new AppError('Customer account required', 403);
  }

  const password = String(req.body.password || '');
  if (!password) throw new AppError('Your password is required', 422);

  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Incorrect password', 422);
  }

  const customer = await Customer.findOne({ userId: req.user._id }).select(
    'name firstName middleName lastName bankName bankNumber'
  );
  if (!customer) throw new AppError('Customer profile not found', 404);

  const accountHolderName = customer.name ||
    [customer.firstName, customer.middleName, customer.lastName]
      .filter(Boolean)
      .join(' ') ||
    '—';

  res.set('Cache-Control', 'no-store');
  res.json({
    success: true,
    item: {
      accountHolderName,
      bankName: customer.bankName || '—',
      bankAccountNumber: customer.bankNumber || '—'
    }
  });
});

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id).populate(customerPopulate);
  if (!customer) throw new AppError('Customer not found', 404);

  res.json({ success: true, item: customer });
});

export const createCustomer = asyncHandler(async (req, res) => {
  const { name, phone } = req.body;
  const normalizedPhone = normalizePhone(phone);

  if (!name || !normalizedPhone) {
    throw new AppError('Name and phone are required', 422);
  }

  if (!isValidPhone(normalizedPhone)) {
    throw new AppError('Enter a valid phone number', 422);
  }

  const customer = await Customer.create({
    customerCode: await nextNumber('customer', 'CUS'),
    name: String(name).trim(),
    gender: req.body.gender || null,
    dateOfBirth: req.body.dateOfBirth || null,
    nationalId: req.body.nationalId || undefined,
    phone: normalizedPhone,
    email: req.body.email || '',
    bankName: req.body.bankName || '',
    bankNumber: req.body.bankNumber || '',
    occupation: req.body.occupation || '',
    monthlyIncome: toMoney(req.body.monthlyIncome || 0),
    address: req.body.address || {},
    status: req.body.status || 'ACTIVE',
    createdBy: req.user._id
  });

  await writeAudit({
    req,
    action: 'CUSTOMER_CREATED',
    entityType: 'CUSTOMER',
    entityId: customer._id,
    newValues: {
      customerCode: customer.customerCode,
      name: customer.name,
      phone: customer.phone
    }
  });

  res.status(201).json({ success: true, item: customer });
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const updatedCustomerId = await runDatabaseWork(async (session) => {
    const customer = await Customer.findById(req.params.id).session(session);
    if (!customer) throw new AppError('Customer not found', 404);

    const oldValues = customer.toObject();
    const editableFields = [
      'name',
      'gender',
      'dateOfBirth',
      'email',
      'bankName',
      'bankNumber',
      'occupation',
      'address',
      'status',
      'identityVerificationNote'
    ];

    for (const field of editableFields) {
      if (req.body[field] !== undefined) customer[field] = req.body[field];
    }

    let linkedUser = null;

    if (
      customer.userId &&
      (req.body.name !== undefined || req.body.phone !== undefined)
    ) {
      linkedUser = await User.findById(customer.userId).session(session);
    }

    if (linkedUser && req.body.name !== undefined) {
      linkedUser.displayName = String(req.body.name || '').trim() || 'Customer';
    }

    if (req.body.nationalId !== undefined) {
      customer.nationalId = req.body.nationalId || undefined;
    }

    if (req.body.monthlyIncome !== undefined) {
      customer.monthlyIncome = toMoney(req.body.monthlyIncome);
    }

    if (req.body.phone !== undefined) {
      const normalizedPhone = normalizePhone(req.body.phone);

      if (!isValidPhone(normalizedPhone)) {
        throw new AppError('Enter a valid phone number', 422);
      }

      customer.phone = normalizedPhone;

      if (linkedUser) {
        linkedUser.phone = normalizedPhone;
        linkedUser.username = normalizedPhone;
      }
    }

    if (linkedUser) {
      await linkedUser.save(sessionOptions(session));
    }

    if (req.body.identityVerificationStatus !== undefined) {
      const verificationStatus = req.body.identityVerificationStatus;
      const allowedStatuses = [
        'NOT_SUBMITTED',
        'PENDING',
        'VERIFIED',
        'REJECTED'
      ];

      if (!allowedStatuses.includes(verificationStatus)) {
        throw new AppError('Invalid identity verification status', 422);
      }

      if (
        verificationStatus === 'VERIFIED' &&
        (
          !customer.frontIdCard?.publicId ||
          !customer.backIdCard?.publicId ||
          !customer.selfieWithId?.publicId
        )
      ) {
        throw new AppError(
          'Upload the front ID, back ID and selfie with ID before verification',
          422
        );
      }

      customer.identityVerificationStatus = verificationStatus;

      if (verificationStatus === 'VERIFIED') {
        customer.identityVerifiedBy = req.user._id;
        customer.identityVerifiedAt = new Date();
      } else {
        customer.identityVerifiedBy = null;
        customer.identityVerifiedAt = null;
      }
    }

    await customer.save(sessionOptions(session));

    await writeAudit({
      req,
      action: 'CUSTOMER_UPDATED',
      entityType: 'CUSTOMER',
      entityId: customer._id,
      oldValues,
      newValues: customer.toObject(),
      session
    });

    return customer._id;
  });

  const updatedCustomer = await Customer.findById(updatedCustomerId).populate(
    customerPopulate
  );

  res.json({ success: true, item: updatedCustomer });
});

export const uploadCustomerSelfieWithId = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('Select a selfie with ID card image', 422);
  }

  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new AppError('Customer not found', 404);

  let uploadResult;

  try {
    uploadResult = await uploadImageBuffer(req.file.buffer, {
      folder: `microfinance/customers/${customer._id}`,
      public_id: 'selfie-with-id',
      resource_type: 'image',
      type: 'authenticated',
      overwrite: true,
      invalidate: true,
      transformation: [
        { width: 2200, height: 2200, crop: 'limit', quality: 'auto' }
      ]
    });
  } catch (error) {
    throw new AppError(
      error?.message || 'Cloudinary could not upload the selfie image',
      502
    );
  }

  customer.selfieWithId = selfieMetadata(uploadResult, req.file, req.user._id);
  customer.identityVerificationStatus = 'PENDING';
  customer.identityVerifiedBy = null;
  customer.identityVerifiedAt = null;
  await customer.save();

  await writeAudit({
    req,
    action: 'CUSTOMER_SELFIE_WITH_ID_UPLOADED',
    entityType: 'CUSTOMER',
    entityId: customer._id,
    newValues: {
      publicId: customer.selfieWithId.publicId,
      bytes: customer.selfieWithId.bytes,
      identityVerificationStatus: customer.identityVerificationStatus
    }
  });

  res.json({
    success: true,
    message: 'Selfie with ID card uploaded successfully',
    item: customer
  });
});

export const uploadCustomerIdentityImages = asyncHandler(async (req, res) => {
  const files = req.files || {};
  const suppliedFields = ['frontIdCard', 'backIdCard', 'selfieWithId'].filter(
    (field) => files[field]?.[0]
  );

  if (!suppliedFields.length) {
    throw new AppError(
      'Select at least one ID card or selfie image to upload',
      422
    );
  }

  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new AppError('Customer not found', 404);

  const publicIds = {
    frontIdCard: 'front-id-card',
    backIdCard: 'back-id-card',
    selfieWithId: 'selfie-with-id'
  };

  const uploaded = [];

  try {
    for (const field of suppliedFields) {
      const file = files[field][0];
      const result = await uploadImageBuffer(file.buffer, {
        folder: `microfinance/customers/${customer._id}`,
        public_id: publicIds[field],
        resource_type: 'image',
        type: 'authenticated',
        overwrite: true,
        invalidate: true,
        transformation: [
          { width: 2200, height: 2200, crop: 'limit', quality: 'auto' }
        ]
      });

      uploaded.push({ field, result, file });
    }
  } catch (error) {
    throw new AppError(
      error?.message || 'Cloudinary could not upload the identity images',
      502
    );
  }

  for (const { field, result, file } of uploaded) {
    customer[field] = selfieMetadata(result, file, req.user._id);
  }

  customer.identityVerificationStatus = 'PENDING';
  customer.identityVerifiedBy = null;
  customer.identityVerifiedAt = null;
  await customer.save();

  await writeAudit({
    req,
    action: 'CUSTOMER_IDENTITY_IMAGES_UPLOADED',
    entityType: 'CUSTOMER',
    entityId: customer._id,
    newValues: {
      uploadedFields: suppliedFields,
      identityVerificationStatus: customer.identityVerificationStatus
    }
  });

  res.json({
    success: true,
    message: 'Customer identity images uploaded successfully',
    item: customer
  });
});

export const getCustomerIdentityImageUrls = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id).select(
    'frontIdCard backIdCard selfieWithId identityVerificationStatus'
  );

  if (!customer) throw new AppError('Customer not found', 404);

  const images = {};
  let expiresAt = null;

  for (const field of ['frontIdCard', 'backIdCard', 'selfieWithId']) {
    const image = customer[field];

    if (image?.publicId) {
      const signed = privateImageUrl(image);
      images[field] = signed.url;
      expiresAt = signed.expiresAt;
    } else {
      images[field] = null;
    }
  }

  res.json({
    success: true,
    images,
    expiresAt: expiresAt
      ? new Date(expiresAt * 1000).toISOString()
      : null,
    verificationStatus: customer.identityVerificationStatus
  });
});

export const getCustomerSelfieWithIdUrl = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id).select(
    'selfieWithId identityVerificationStatus'
  );

  if (!customer) throw new AppError('Customer not found', 404);

  if (!customer.selfieWithId?.publicId) {
    throw new AppError('Selfie with ID card has not been uploaded', 404);
  }

  const signed = privateImageUrl(customer.selfieWithId);

  res.json({
    success: true,
    url: signed.url,
    expiresAt: new Date(signed.expiresAt * 1000).toISOString(),
    verificationStatus: customer.identityVerificationStatus
  });
});

export const deleteCustomer = asyncHandler(async (req, res) => {
  const deletionResult = await runDatabaseWork(async (session) => {
    const customer = await Customer.findById(req.params.id).session(session);
    if (!customer) throw new AppError('Customer not found', 404);

    const [applications, loans] = await Promise.all([
      LoanApplication.find({ customerId: customer._id })
        .select('_id signature')
        .session(session)
        .lean(),
      Loan.find({ customerId: customer._id })
        .select('_id')
        .session(session)
        .lean()
    ]);

    const loanIds = loans.map((loan) => loan._id);
    const applicationIds = applications.map((application) => application._id);

    const oldValues = customer.toObject();
    const images = [
      customer.frontIdCard,
      customer.backIdCard,
      customer.selfieWithId,
      ...applications.map((application) => application.signature)
    ]
      .filter((image) => image?.publicId)
      .map((image) => ({
        publicId: image.publicId,
        deliveryType: image.deliveryType || 'authenticated'
      }));

    const uniqueImages = Array.from(
      new Map(images.map((image) => [image.publicId, image])).values()
    );

    const [installments, transactions, repayments, notifications] =
      await Promise.all([
        Installment.deleteMany(
          { loanId: { $in: loanIds } },
          sessionOptions(session)
        ),
        LoanTransaction.deleteMany(
          { loanId: { $in: loanIds } },
          sessionOptions(session)
        ),
        Repayment.deleteMany(
          {
            $or: [
              { customerId: customer._id },
              { loanId: { $in: loanIds } }
            ]
          },
          sessionOptions(session)
        ),
        Notification.deleteMany(
          {
            $or: [
              ...(customer.userId ? [{ userId: customer.userId }] : []),
              { referenceId: { $in: [...loanIds, ...applicationIds] } }
            ]
          },
          sessionOptions(session)
        )
      ]);

    const deletedLoans = await Loan.deleteMany(
      { customerId: customer._id },
      sessionOptions(session)
    );
    const deletedApplications = await LoanApplication.deleteMany(
      { customerId: customer._id },
      sessionOptions(session)
    );

    let deletedUsers = 0;
    if (customer.userId) {
      const result = await User.deleteOne(
        { _id: customer.userId },
        sessionOptions(session)
      );
      deletedUsers = result.deletedCount;
    }

    await Customer.deleteOne({ _id: customer._id }, sessionOptions(session));

    const deletedRecords = {
      customers: 1,
      users: deletedUsers,
      applications: deletedApplications.deletedCount,
      loans: deletedLoans.deletedCount,
      installments: installments.deletedCount,
      repayments: repayments.deletedCount,
      loanTransactions: transactions.deletedCount,
      notifications: notifications.deletedCount
    };

    await writeAudit({
      req,
      action: 'CUSTOMER_FORCE_DELETED',
      entityType: 'CUSTOMER',
      entityId: customer._id,
      oldValues,
      newValues: { deletedRecords },
      session
    });

    return {
      images: uniqueImages,
      deletedRecords
    };
  });

  for (const image of deletionResult.images) {
    try {
      await getCloudinary().uploader.destroy(image.publicId, {
        resource_type: 'image',
        type: image.deliveryType,
        invalidate: true
      });
    } catch (error) {
      console.error(
        'Could not remove customer identity image from Cloudinary:',
        error.message
      );
    }
  }

  res.json({
    success: true,
    message: 'Customer and all related records deleted successfully',
    deletedRecords: deletionResult.deletedRecords
  });
});
