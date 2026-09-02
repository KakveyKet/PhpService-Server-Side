import Customer from '../models/Customer.js';
import Installment from '../models/Installment.js';
import Loan from '../models/Loan.js';
import LoanApplication from '../models/LoanApplication.js';
import Notification from '../models/Notification.js';
import Product from '../models/Product.js';
import { getCloudinary } from '../config/cloudinary.js';
import { ROLES } from '../constants/index.js';
import { writeAudit } from '../services/auditService.js';
import { generateLoanSchedule } from '../services/loanScheduleService.js';
import { publishChange } from '../services/realtimeService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextNumber } from '../utils/counter.js';
import { runDatabaseWork, sessionOptions } from '../utils/databaseWork.js';
import { toDecimal, toMoney } from '../utils/decimal.js';

const CUSTOMER_TERM_OPTIONS = [6, 12, 24, 36, 48];

function uploadPrivateImage(buffer, options) {
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

function imageMetadata(result, file, userId) {
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
  const expiresAt = Math.floor(Date.now() / 1000) + 5 * 60;
  const url = getCloudinary().utils.private_download_url(
    image.publicId,
    image.format,
    {
      resource_type: 'image',
      type: image.deliveryType || 'authenticated',
      expires_at: expiresAt,
      attachment: false
    }
  );

  return { url, expiresAt };
}

function requiredText(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new AppError(`${label} is required`, 422);
  return normalized;
}

async function customerForUser(userId) {
  const customer = await Customer.findOne({ userId });
  if (!customer) throw new AppError('Customer profile not found', 404);
  return customer;
}

function dateRangeFromQuery(query) {
  const range = {};

  if (query.dateFrom) {
    const dateFrom = new Date(query.dateFrom);
    if (Number.isNaN(dateFrom.getTime())) throw new AppError('Invalid dateFrom value', 422);
    range.$gte = dateFrom;
  }

  if (query.dateTo) {
    const dateTo = new Date(query.dateTo);
    if (Number.isNaN(dateTo.getTime())) throw new AppError('Invalid dateTo value', 422);
    range.$lte = dateTo;
  }

  if (range.$gte && range.$lte && range.$gte > range.$lte) {
    throw new AppError('dateFrom must be before dateTo', 422);
  }

  return range;
}

export const listApplications = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 1000);
  const filter = {};

  if (req.role === ROLES.CUSTOMER) filter.customerId = (await customerForUser(req.user._id))._id;
  if (req.query.customerId && req.role !== ROLES.CUSTOMER) filter.customerId = req.query.customerId;
  if (req.query.status) filter.status = req.query.status;

  const submittedAt = dateRangeFromQuery(req.query);
  if (Object.keys(submittedAt).length) filter.submittedAt = submittedAt;

  const [items, total] = await Promise.all([
    LoanApplication.find(filter)
      .populate({
        path: 'customerId',
        select: 'customerCode name firstName middleName lastName phone userId',
        populate: { path: 'userId', select: 'username' }
      })
      .populate({ path: 'productId', populate: { path: 'rateId' } })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    LoanApplication.countDocuments(filter)
  ]);

  res.json({ success: true, items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const createApplication = asyncHandler(async (req, res) => {
  const { productId, requestedAmount, requestedTerm, purpose } = req.body;
  if (!productId || requestedAmount === undefined || !requestedTerm || !purpose) {
    throw new AppError('Product, amount, term and purpose are required', 422);
  }

  const customer = req.role === ROLES.CUSTOMER
    ? await customerForUser(req.user._id)
    : await Customer.findById(req.body.customerId);
  if (!customer) throw new AppError('Customer not found', 404);
  if (customer.status !== 'ACTIVE') throw new AppError('Customer is not active', 422);

  const product = await Product.findOne({ _id: productId, status: 'ACTIVE' }).populate('rateId');
  if (!product || product.rateId?.status !== 'ACTIVE') throw new AppError('Active loan product not found', 404);

  const amount = toDecimal(requestedAmount);
  if (amount.lessThan(product.minimumAmount.toString()) || amount.greaterThan(product.maximumAmount.toString())) {
    throw new AppError('Requested amount is outside the product limit', 422);
  }

  const term = Number(requestedTerm);
  const isCustomerPortalApplication = req.role === ROLES.CUSTOMER;

  if (
    isCustomerPortalApplication &&
    !CUSTOMER_TERM_OPTIONS.includes(term)
  ) {
    throw new AppError('Select a 6, 12, 24, 36 or 48 month term', 422);
  }

  if (
    !isCustomerPortalApplication &&
    (term < product.minimumTerm || term > product.maximumTerm)
  ) {
    throw new AppError('Requested term is outside the product limit', 422);
  }

  let applicantSnapshot = {};
  let termsAcceptedAt = null;
  let termsVersion = '';
  let signature = null;

  if (isCustomerPortalApplication) {
    if (req.body.termsAccepted !== 'true' && req.body.termsAccepted !== true) {
      throw new AppError('Accept the Loan Service Terms & Agreement', 422);
    }

    const applicantName = requiredText(req.body.applicantName, 'Name');
    const applicantAddress = requiredText(req.body.applicantAddress, 'Address');
    const idCardNumber = requiredText(req.body.idCardNumber, 'ID card number');
    const bankName = requiredText(req.body.bankName, 'Bank name');
    const bankAccountNumber = requiredText(
      req.body.bankAccountNumber,
      'Bank account number'
    );
    const signatureFile = req.files?.signature?.[0];

    if (!signatureFile) {
      throw new AppError('Upload or draw your signature', 422);
    }

    const applicationNumber = await nextNumber('application', 'APP');
    const identityFields = ['frontIdCard', 'backIdCard', 'selfieWithId'];
    const identityPublicIds = {
      frontIdCard: 'front-id-card',
      backIdCard: 'back-id-card',
      selfieWithId: 'selfie-with-id'
    };

    try {
      for (const field of identityFields) {
        const file = req.files?.[field]?.[0];
        if (!file) continue;

        const result = await uploadPrivateImage(file.buffer, {
          folder: `microfinance/customers/${customer._id}`,
          public_id: identityPublicIds[field],
          resource_type: 'image',
          type: 'authenticated',
          overwrite: true,
          invalidate: true,
          transformation: [
            { width: 2200, height: 2200, crop: 'limit', quality: 'auto' }
          ]
        });

        customer[field] = imageMetadata(result, file, req.user._id);
      }

      const missingIdentityImage = identityFields.find(
        (field) => !customer[field]?.publicId
      );

      if (missingIdentityImage) {
        const labels = {
          frontIdCard: 'front ID card image',
          backIdCard: 'back ID card image',
          selfieWithId: 'selfie with ID card'
        };
        throw new AppError(`Upload the ${labels[missingIdentityImage]}`, 422);
      }

      const signatureResult = await uploadPrivateImage(signatureFile.buffer, {
        folder: `microfinance/applications/${applicationNumber}`,
        public_id: 'signature',
        resource_type: 'image',
        type: 'authenticated',
        overwrite: true,
        invalidate: true,
        transformation: [
          { width: 1600, height: 600, crop: 'limit', quality: 'auto' }
        ]
      });

      signature = imageMetadata(signatureResult, signatureFile, req.user._id);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        error?.message || 'Cloudinary could not upload the application images',
        502
      );
    }

    customer.name = applicantName;
    customer.nationalId = idCardNumber;
    customer.bankName = bankName;
    customer.bankNumber = bankAccountNumber;
    customer.identityVerificationStatus = 'PENDING';
    customer.identityVerifiedBy = null;
    customer.identityVerifiedAt = null;
    await customer.save();

    applicantSnapshot = {
      name: applicantName,
      address: applicantAddress,
      idCardNumber,
      bankName,
      bankAccountNumber
    };
    termsAcceptedAt = new Date();
    termsVersion = 'LOAN_SERVICE_TERMS_V1';

    const application = await LoanApplication.create({
      applicationNumber,
      customerId: customer._id,
      productId: product._id,
      requestedAmount: toMoney(amount),
      requestedTerm: term,
      purpose,
      applicantSnapshot,
      termsAcceptedAt,
      termsVersion,
      signature,
      monthlyIncome: toMoney(req.body.monthlyIncome ?? customer.monthlyIncome ?? 0),
      monthlyExpense: toMoney(req.body.monthlyExpense || 0),
      collateralDescription: req.body.collateralDescription || '',
      status: 'SUBMITTED',
      createdBy: req.user._id
    });

    await writeAudit({
      req,
      action: 'LOAN_APPLICATION_CREATED',
      entityType: 'LOAN_APPLICATION',
      entityId: application._id,
      newValues: {
        applicationNumber,
        requestedAmount,
        requestedTerm: term,
        termsAcceptedAt,
        identityImagesSubmitted: true,
        signatureSubmitted: true
      }
    });

    publishChange({
      topics: ['applications', 'dashboard', 'customers'],
      action: 'LOAN_APPLICATION_CREATED',
      entityId: application._id,
      staff: true,
      userIds: [customer.userId]
    });

    res.status(201).json({ success: true, item: application });
    return;
  }

  const application = await LoanApplication.create({
    applicationNumber: await nextNumber('application', 'APP'),
    customerId: customer._id,
    productId: product._id,
    requestedAmount: toMoney(amount),
    requestedTerm: term,
    purpose,
    monthlyIncome: toMoney(req.body.monthlyIncome ?? customer.monthlyIncome ?? 0),
    monthlyExpense: toMoney(req.body.monthlyExpense || 0),
    collateralDescription: req.body.collateralDescription || '',
    status: 'SUBMITTED',
    createdBy: req.user._id
  });

  await writeAudit({ req, action: 'LOAN_APPLICATION_CREATED', entityType: 'LOAN_APPLICATION', entityId: application._id, newValues: req.body });

  publishChange({
    topics: ['applications', 'dashboard'],
    action: 'LOAN_APPLICATION_CREATED',
    entityId: application._id,
    staff: true,
    userIds: [customer.userId]
  });

  res.status(201).json({ success: true, item: application });
});

export const updateApplicationPlan = asyncHandler(async (req, res) => {
  const { requestedAmount, requestedTerm, comment = '' } = req.body;

  if (requestedAmount === undefined || requestedTerm === undefined) {
    throw new AppError('Requested amount and term are required', 422);
  }

  let savedApplicationId;
  let customerUserId = null;

  await runDatabaseWork(async (session) => {
    const application = await LoanApplication.findById(req.params.id).session(session);
    if (!application) throw new AppError('Loan application not found', 404);

    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(application.status)) {
      throw new AppError(
        'Only submitted or under-review applications can change their plan',
        409
      );
    }

    const product = await Product.findById(application.productId).session(session);
    if (!product) throw new AppError('Loan product not found', 404);

    const amount = toDecimal(requestedAmount);
    if (
      amount.lessThan(product.minimumAmount.toString()) ||
      amount.greaterThan(product.maximumAmount.toString())
    ) {
      throw new AppError('Requested amount is outside the product limit', 422);
    }

    const term = Number(requestedTerm);
    if (!Number.isInteger(term) || term < 1) {
      throw new AppError('Requested term must be a whole number', 422);
    }

    if (application.termsAcceptedAt) {
      if (!CUSTOMER_TERM_OPTIONS.includes(term)) {
        throw new AppError('Select a 6, 12, 24, 36 or 48 month term', 422);
      }
    } else if (term < product.minimumTerm || term > product.maximumTerm) {
      throw new AppError('Requested term is outside the product limit', 422);
    }

    const oldValues = {
      requestedAmount: application.requestedAmount,
      requestedTerm: application.requestedTerm
    };

    application.requestedAmount = toMoney(amount);
    application.requestedTerm = term;
    await application.save(sessionOptions(session));

    const customer = await Customer.findById(application.customerId).session(session);
    customerUserId = customer?.userId || null;

    if (customerUserId) {
      await Notification.create(
        [{
          userId: customerUserId,
          title: 'Loan application plan updated',
          message: `${application.applicationNumber} now requests ${term} periods.`,
          type: 'LOAN',
          referenceId: application._id
        }],
        sessionOptions(session)
      );
    }

    await writeAudit({
      req,
      action: 'LOAN_APPLICATION_PLAN_UPDATED',
      entityType: 'LOAN_APPLICATION',
      entityId: application._id,
      oldValues,
      newValues: {
        requestedAmount: application.requestedAmount,
        requestedTerm: application.requestedTerm,
        comment: String(comment || '').trim()
      },
      session
    });

    savedApplicationId = application._id;
  });

  const savedApplication = await LoanApplication.findById(savedApplicationId)
    .populate('customerId', 'customerCode name firstName middleName lastName phone')
    .populate({ path: 'productId', populate: { path: 'rateId' } });

  publishChange({
    topics: ['applications', 'dashboard', 'notifications'],
    action: 'LOAN_APPLICATION_PLAN_UPDATED',
    entityId: savedApplication._id,
    staff: true,
    userIds: [customerUserId]
  });

  res.json({ success: true, item: savedApplication });
});

export const getApplicationSignatureUrl = asyncHandler(async (req, res) => {
  const application = await LoanApplication.findById(req.params.id).select(
    'customerId signature'
  );

  if (!application) throw new AppError('Loan application not found', 404);

  if (req.role === ROLES.CUSTOMER) {
    const ownsApplication = await Customer.exists({
      _id: application.customerId,
      userId: req.user._id
    });

    if (!ownsApplication) {
      throw new AppError('You cannot view this application signature', 403);
    }
  }

  if (!application.signature?.publicId) {
    throw new AppError('This application does not have a signature', 404);
  }

  const signed = privateImageUrl(application.signature);

  res.json({
    success: true,
    url: signed.url,
    expiresAt: new Date(signed.expiresAt * 1000).toISOString()
  });
});

export const reviewApplication = asyncHandler(async (req, res) => {
  const { decision, comment = '' } = req.body;
  if (!['APPROVED', 'REJECTED', 'RETURNED'].includes(decision)) {
    throw new AppError('Invalid review decision', 422);
  }

  let responseItem;

  await runDatabaseWork(async (session) => {
      const application = await LoanApplication.findById(req.params.id).session(session);
      if (!application) throw new AppError('Loan application not found', 404);
      if (!['SUBMITTED', 'UNDER_REVIEW'].includes(application.status)) {
        throw new AppError('This application has already been reviewed', 409);
      }

      const approvedAmount = req.body.approvedAmount ?? application.requestedAmount;
      const approvedTerm = Number(req.body.approvedTerm ?? application.requestedTerm);
      application.approvalHistory.push({
        decision,
        approvedAmount: decision === 'APPROVED' ? toMoney(approvedAmount) : null,
        approvedTerm: decision === 'APPROVED' ? approvedTerm : null,
        comment,
        reviewedBy: req.user._id
      });

      if (decision !== 'APPROVED') {
        application.status = decision === 'REJECTED' ? 'REJECTED' : 'UNDER_REVIEW';
        await application.save(sessionOptions(session));
        await writeAudit({ req, action: `LOAN_APPLICATION_${decision}`, entityType: 'LOAN_APPLICATION', entityId: application._id, newValues: req.body, session });
        responseItem = application;
        return;
      }

      const product = await Product.findById(application.productId).populate('rateId').session(session);
      if (!product || !product.rateId) throw new AppError('Product or rate is unavailable', 422);
      if (product.rateId.period !== product.repaymentFrequency) {
        throw new AppError('The starter requires the rate period to match the repayment frequency', 422);
      }
      const amount = toDecimal(approvedAmount);
      if (amount.lessThan(product.minimumAmount.toString()) || amount.greaterThan(product.maximumAmount.toString())) {
        throw new AppError('Approved amount is outside the product limit', 422);
      }
      const customerPortalApplication = Boolean(application.termsAcceptedAt);

      if (
        customerPortalApplication &&
        !CUSTOMER_TERM_OPTIONS.includes(approvedTerm)
      ) {
        throw new AppError(
          'Approved term must be 6, 12, 24, 36 or 48 months',
          422
        );
      }

      if (
        !customerPortalApplication &&
        (approvedTerm < product.minimumTerm || approvedTerm > product.maximumTerm)
      ) {
        throw new AppError('Approved term is outside the product limit', 422);
      }

      const startDate = req.body.startDate ? new Date(req.body.startDate) : new Date();
      const schedule = generateLoanSchedule({
        principal: amount,
        term: approvedTerm,
        ratePercent: product.rateId.ratePercent,
        ratePeriod: product.rateId.period,
        calculationMethod: product.rateId.calculationMethod,
        repaymentFrequency: product.repaymentFrequency,
        processingFeePercent: product.processingFeePercent,
        startDate
      });

      const [loan] = await Loan.create(
        [{
          loanNumber: await nextNumber('loan', 'LN', session),
          applicationId: application._id,
          customerId: application.customerId,
          productId: product._id,
          productSnapshot: {
            productCode: product.productCode,
            name: product.name,
            repaymentFrequency: product.repaymentFrequency,
            termUnit: product.termUnit
          },
          principalAmount: toMoney(amount),
          rateSnapshot: {
            rateId: product.rateId._id,
            ratePercent: product.rateId.ratePercent,
            period: product.rateId.period,
            calculationMethod: product.rateId.calculationMethod
          },
          term: approvedTerm,
          termUnit: product.termUnit,
          repaymentFrequency: product.repaymentFrequency,
          processingFee: schedule.processingFee,
          totalInterest: schedule.totalInterest,
          totalPayable: schedule.totalPayable,
          balances: {
            principal: toMoney(amount),
            interest: schedule.totalInterest,
            fees: schedule.processingFee,
            penalties: toMoney(0),
            total: schedule.totalPayable,
            totalPaid: toMoney(0)
          },
          startDate,
          maturityDate: schedule.maturityDate,
          status: 'APPROVED',
          approvedBy: req.user._id
        }],
        sessionOptions(session)
      );

      await Installment.insertMany(
        schedule.installments.map((installment) => ({ ...installment, loanId: loan._id })),
        sessionOptions(session)
      );

      application.status = 'APPROVED';
      await application.save(sessionOptions(session));

      const customer = await Customer.findById(application.customerId).session(session);
      if (customer?.userId) {
        await Notification.create(
          [{
            userId: customer.userId,
            title: 'Loan application approved',
            message: `${application.applicationNumber} was approved.`,
            type: 'LOAN',
            referenceId: loan._id
          }],
          sessionOptions(session)
        );
      }

      await writeAudit({ req, action: 'LOAN_APPLICATION_APPROVED', entityType: 'LOAN', entityId: loan._id, newValues: req.body, session });
      responseItem = loan;
  });

  const realtimeCustomer = await Customer.findById(responseItem.customerId).select('userId');
  publishChange({
    topics: decision === 'APPROVED'
      ? ['applications', 'loans', 'dashboard', 'notifications']
      : ['applications', 'dashboard'],
    action: `LOAN_APPLICATION_${decision}`,
    entityId: responseItem._id,
    staff: true,
    userIds: [realtimeCustomer?.userId]
  });

  res.json({ success: true, item: responseItem });
});
