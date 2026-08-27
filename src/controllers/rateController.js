import Rate from '../models/Rate.js';
import Product from '../models/Product.js';
import { writeAudit } from '../services/auditService.js';
import { publishChange } from '../services/realtimeService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { toDecimal, toRate } from '../utils/decimal.js';

const ALLOWED_RATE_FIELDS = ['rateCode', 'name', 'ratePercent'];

function getAllowedRateData(body) {
  return ALLOWED_RATE_FIELDS.reduce((data, field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      data[field] = body[field];
    }
    return data;
  }, {});
}

export const listRates = asyncHandler(async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  const items = await Rate.find(filter).sort({ createdAt: -1 });
  res.json({ success: true, items });
});

export const createRate = asyncHandler(async (req, res) => {
  const rateData = getAllowedRateData(req.body);
  const { rateCode, name, ratePercent } = rateData;
  if (!rateCode || !name || ratePercent === undefined) {
    throw new AppError('Rate code, name and percentage are required', 422);
  }
  if (toDecimal(ratePercent).isNegative()) throw new AppError('Rate percentage cannot be negative', 422);

  const rate = await Rate.create({
    rateCode,
    name,
    ratePercent: toRate(ratePercent),
    period: 'MONTHLY',
    calculationMethod: 'FLAT',
    effectiveFrom: new Date(),
    effectiveTo: null,
    status: 'ACTIVE',
    createdBy: req.user._id
  });
  await writeAudit({ req, action: 'RATE_CREATED', entityType: 'RATE', entityId: rate._id, newValues: rate.toObject() });

  publishChange({
    topics: ['rates', 'products'],
    action: 'RATE_CREATED',
    entityId: rate._id,
    staff: true
  });

  res.status(201).json({ success: true, item: rate });
});

export const updateRate = asyncHandler(async (req, res) => {
  const rate = await Rate.findById(req.params.id);
  if (!rate) throw new AppError('Rate not found', 404);
  const rateData = getAllowedRateData(req.body);
  const oldValues = rate.toObject();

  for (const field of ['rateCode', 'name']) {
    if (rateData[field] !== undefined) rate[field] = rateData[field];
  }
  if (rateData.ratePercent !== undefined) {
    if (toDecimal(rateData.ratePercent).isNegative()) throw new AppError('Rate percentage cannot be negative', 422);
    rate.ratePercent = toRate(rateData.ratePercent);
  }

  await rate.save();
  await writeAudit({ req, action: 'RATE_UPDATED', entityType: 'RATE', entityId: rate._id, oldValues, newValues: rate.toObject() });

  publishChange({
    topics: ['rates', 'products'],
    action: 'RATE_UPDATED',
    entityId: rate._id,
    staff: true
  });

  res.json({ success: true, item: rate });
});

export const deleteRate = asyncHandler(async (req, res) => {
  const rate = await Rate.findById(req.params.id);
  if (!rate) throw new AppError('Rate not found', 404);

  const assignedProduct = await Product.findOne({ rateId: rate._id })
    .select('productCode name')
    .lean();

  if (assignedProduct) {
    throw new AppError(
      `This rate is assigned to product ${assignedProduct.productCode || assignedProduct.name}. Change or delete that product first.`,
      409
    );
  }

  const oldValues = rate.toObject();
  await Rate.deleteOne({ _id: rate._id });

  await writeAudit({
    req,
    action: 'RATE_DELETED',
    entityType: 'RATE',
    entityId: rate._id,
    oldValues,
    newValues: null
  });

  publishChange({
    topics: ['rates', 'products'],
    action: 'RATE_DELETED',
    entityId: rate._id,
    staff: true
  });

  res.json({
    success: true,
    message: 'Rate deleted successfully'
  });
});
