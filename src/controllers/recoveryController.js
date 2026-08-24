import { createHash, timingSafeEqual } from 'node:crypto';
import { PERMISSIONS, ROLES } from '../constants/index.js';
import Role from '../models/Role.js';
import User from '../models/User.js';
import { writeAudit } from '../services/auditService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

function recoveryEnabled() {
  return String(process.env.ENABLE_SUPER_ADMIN_RECOVERY).toLowerCase() === 'true';
}

function secureHash(value) {
  return createHash('sha256').update(String(value || '')).digest();
}

function verifyRecoveryKey(req) {
  if (!recoveryEnabled()) {
    throw new AppError('Route not found', 404);
  }

  const configuredKey = process.env.SUPER_ADMIN_RECOVERY_KEY || '';
  const suppliedKey = req.get('x-recovery-key') || '';

  if (configuredKey.length < 32) {
    throw new AppError(
      'Recovery is enabled but SUPER_ADMIN_RECOVERY_KEY is missing or shorter than 32 characters. Update backend/.env and restart the API.',
      503
    );
  }

  if (!suppliedKey || !timingSafeEqual(secureHash(suppliedKey), secureHash(configuredKey))) {
    throw new AppError('Route not found', 404);
  }
}

function validatePassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export const bootstrapSuperAdmin = asyncHandler(async (req, res) => {
  verifyRecoveryKey(req);

  const {
    username,
    email,
    phone,
    password,
    displayName = 'Recovery Super Admin'
  } = req.body;

  const normalizedUsername = String(username || '').trim().toLowerCase();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPhone = String(phone || '').trim();

  if (!normalizedUsername || !password || !String(displayName).trim()) {
    throw new AppError('Username, password and display name are required', 422);
  }

  if (!/^[a-z0-9._-]{4,40}$/.test(normalizedUsername)) {
    throw new AppError('Username must contain 4-40 letters, numbers, dots, underscores or hyphens', 422);
  }

  if (!validatePassword(password)) {
    throw new AppError(
      'Password must contain at least 12 characters with uppercase, lowercase, number and special character',
      422
    );
  }

  const existingSuperAdminRole = await Role.findOne({ name: ROLES.SUPER_ADMIN });

  if (existingSuperAdminRole) {
    const existingSuperAdmin = await User.exists({ roleId: existingSuperAdminRole._id });
    if (existingSuperAdmin) {
      throw new AppError('Recovery is unavailable because a super admin account already exists', 409);
    }
  }

  const duplicateConditions = [{ username: normalizedUsername }];
  if (normalizedEmail) duplicateConditions.push({ email: normalizedEmail });
  if (normalizedPhone) duplicateConditions.push({ phone: normalizedPhone });

  const duplicateUser = await User.findOne({ $or: duplicateConditions });
  if (duplicateUser) {
    throw new AppError('Username, email or phone is already in use', 409);
  }

  const superAdminRole = await Role.findOneAndUpdate(
    { name: ROLES.SUPER_ADMIN },
    {
      $set: {
        displayName: 'Super Admin',
        permissions: Object.values(PERMISSIONS),
        isSystemRole: true,
        status: 'ACTIVE'
      }
    },
    {
      upsert: true,
      returnDocument: 'after',
      runValidators: true,
      setDefaultsOnInsert: true
    }
  );

  const superAdmin = await User.create({
    roleId: superAdminRole._id,
    username: normalizedUsername,
    email: normalizedEmail || undefined,
    phone: normalizedPhone || undefined,
    passwordHash: password,
    displayName: String(displayName).trim(),
    status: 'ACTIVE',
    createdBy: null
  });

  await writeAudit({
    req,
    action: 'SUPER_ADMIN_RECOVERY_CREATED',
    entityType: 'USER',
    entityId: superAdmin._id,
    newValues: {
      username: superAdmin.username,
      email: superAdmin.email,
      displayName: superAdmin.displayName,
      role: ROLES.SUPER_ADMIN
    }
  });

  res.status(201).json({
    success: true,
    message: 'Recovery super admin created. Disable the recovery route and restart the server now.',
    user: {
      id: superAdmin._id,
      username: superAdmin.username,
      email: superAdmin.email,
      displayName: superAdmin.displayName,
      role: ROLES.SUPER_ADMIN
    }
  });
});
