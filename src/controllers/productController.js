import Product from '../models/Product.js';
import Rate from '../models/Rate.js';
import { ROLES } from '../constants/index.js';
import { writeAudit } from '../services/auditService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toDecimal, toMoney, toRate } from '../utils/decimal.js';

const BASIC_PRODUCT_FIELDS = [
  'productCode',
  'name',
  'description',
  'rateId',
  'minimumAmount',
  'maximumAmount',
  'minimumTerm',
  'maximumTerm'
];

const SUPER_ADMIN_PRODUCT_FIELDS = [
  'termUnit',
  'repaymentFrequency',
  'processingFeePercent',
  'lateFeeType',
  'lateFeeValue',
  'gracePeriodDays',
  'status'
];

function hasOwn(body, field) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function getAllowedProductData(body, role) {
  if (role === ROLES.ADMIN) {
    const restrictedFields = SUPER_ADMIN_PRODUCT_FIELDS.filter((field) => hasOwn(body, field));
    if (restrictedFields.length) {
      throw new AppError(
        `Only SUPER_ADMIN can change these product fields: ${restrictedFields.join(', ')}`,
        403
      );
    }
  }

  const allowedFields = role === ROLES.SUPER_ADMIN
    ? [...BASIC_PRODUCT_FIELDS, ...SUPER_ADMIN_PRODUCT_FIELDS]
    : BASIC_PRODUCT_FIELDS;

  return allowedFields.reduce((data, field) => {
    if (hasOwn(body, field)) data[field] = body[field];
    return data;
  }, {});
}

export const listProducts = asyncHandler(async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  const items = await Product.find(filter).populate('rateId').sort({ createdAt: -1 });
  res.json({ success: true, items });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).populate('rateId');
  if (!product) throw new AppError('Product not found', 404);
  res.json({ success: true, item: product });
});

function validateProduct(body) {
  if (body.minimumAmount !== undefined && body.maximumAmount !== undefined) {
    if (toDecimal(body.minimumAmount).greaterThan(body.maximumAmount)) {
      throw new AppError('Minimum amount cannot exceed maximum amount', 422);
    }
  }
  if (body.minimumTerm !== undefined && body.maximumTerm !== undefined && Number(body.minimumTerm) > Number(body.maximumTerm)) {
    throw new AppError('Minimum term cannot exceed maximum term', 422);
  }
}

export const createProduct = asyncHandler(async (req, res) => {
  const productData = getAllowedProductData(req.body, req.role);
  const { productCode, name, rateId, minimumAmount, maximumAmount, minimumTerm, maximumTerm } = productData;
  if (!productCode || !name || !rateId || minimumAmount === undefined || maximumAmount === undefined || !minimumTerm || !maximumTerm) {
    throw new AppError('Product code, name, rate, amounts and terms are required', 422);
  }
  validateProduct(productData);
  const rate = await Rate.findOne({ _id: rateId, status: 'ACTIVE' });
  if (!rate) throw new AppError('Active rate not found', 422);

  const product = await Product.create({
    ...productData,
    minimumAmount: toMoney(minimumAmount),
    maximumAmount: toMoney(maximumAmount),
    processingFeePercent: toRate(productData.processingFeePercent || 0),
    lateFeeValue: toRate(productData.lateFeeValue || 0),
    currency: 'PHP',
    createdBy: req.user._id
  });
  await writeAudit({ req, action: 'PRODUCT_CREATED', entityType: 'PRODUCT', entityId: product._id, newValues: product.toObject() });
  await product.populate('rateId');
  res.status(201).json({ success: true, item: product });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);
  const productData = getAllowedProductData(req.body, req.role);
  validateProduct({
    minimumAmount: productData.minimumAmount ?? product.minimumAmount,
    maximumAmount: productData.maximumAmount ?? product.maximumAmount,
    minimumTerm: productData.minimumTerm ?? product.minimumTerm,
    maximumTerm: productData.maximumTerm ?? product.maximumTerm
  });

  if (productData.rateId !== undefined) {
    const rate = await Rate.findOne({ _id: productData.rateId, status: 'ACTIVE' });
    if (!rate) throw new AppError('Active rate not found', 422);
  }

  const oldValues = product.toObject();
  const fields = [
    'productCode', 'name', 'description', 'rateId', 'minimumTerm', 'maximumTerm', 'termUnit',
    'repaymentFrequency', 'lateFeeType', 'gracePeriodDays', 'status'
  ];
  for (const field of fields) {
    if (productData[field] !== undefined) product[field] = productData[field];
  }
  if (productData.minimumAmount !== undefined) product.minimumAmount = toMoney(productData.minimumAmount);
  if (productData.maximumAmount !== undefined) product.maximumAmount = toMoney(productData.maximumAmount);
  if (productData.processingFeePercent !== undefined) product.processingFeePercent = toRate(productData.processingFeePercent);
  if (productData.lateFeeValue !== undefined) product.lateFeeValue = toRate(productData.lateFeeValue);

  await product.save();
  await writeAudit({ req, action: 'PRODUCT_UPDATED', entityType: 'PRODUCT', entityId: product._id, oldValues, newValues: product.toObject() });
  await product.populate('rateId');
  res.json({ success: true, item: product });
});
