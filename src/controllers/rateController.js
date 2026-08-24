import Rate from "../models/Rate.js";
import { writeAudit } from "../services/auditService.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { toDecimal, toRate } from "../utils/decimal.js";

const ALLOWED_RATE_FIELDS = ["rateCode", "name", "ratePercent"];

function getAllowedRateData(body) {
  return ALLOWED_RATE_FIELDS.reduce((data, field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      data[field] = body[field];
    }

    return data;
  }, {});
}

function validateRatePercentage(ratePercent) {
  if (toDecimal(ratePercent).isNegative()) {
    throw new AppError("Rate percentage cannot be negative", 422);
  }
}

export const listRates = asyncHandler(async (req, res) => {
  const filter = {};

  if (req.query.status) {
    filter.status = req.query.status;
  }

  const items = await Rate.find(filter).sort({
    createdAt: -1,
  });

  res.json({
    success: true,
    items,
  });
});

export const createRate = asyncHandler(async (req, res) => {
  const rateData = getAllowedRateData(req.body);

  const { rateCode, name, ratePercent } = rateData;

  if (!rateCode || !name || ratePercent === undefined) {
    throw new AppError("Rate code, name and percentage are required", 422);
  }

  validateRatePercentage(ratePercent);

  const rate = await Rate.create({
    rateCode,
    name,
    ratePercent: toRate(ratePercent),

    // Backend-controlled default conditions
    period: "MONTHLY",
    calculationMethod: "FLAT",
    effectiveFrom: new Date(),
    effectiveTo: null,
    status: "ACTIVE",

    createdBy: req.user._id,
  });

  await writeAudit({
    req,
    action: "RATE_CREATED",
    entityType: "RATE",
    entityId: rate._id,
    newValues: rate.toObject(),
  });

  res.status(201).json({
    success: true,
    item: rate,
  });
});

export const updateRate = asyncHandler(async (req, res) => {
  const rate = await Rate.findById(req.params.id);

  if (!rate) {
    throw new AppError("Rate not found", 404);
  }

  const rateData = getAllowedRateData(req.body);

  const oldValues = rate.toObject();

  if (rateData.rateCode !== undefined) {
    rate.rateCode = rateData.rateCode;
  }

  if (rateData.name !== undefined) {
    rate.name = rateData.name;
  }

  if (rateData.ratePercent !== undefined) {
    validateRatePercentage(rateData.ratePercent);

    rate.ratePercent = toRate(rateData.ratePercent);
  }

  await rate.save();

  await writeAudit({
    req,
    action: "RATE_UPDATED",
    entityType: "RATE",
    entityId: rate._id,
    oldValues,
    newValues: rate.toObject(),
  });

  res.json({
    success: true,
    item: rate,
  });
});
