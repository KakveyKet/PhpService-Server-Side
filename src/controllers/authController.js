import jwt from 'jsonwebtoken';
import Customer from '../models/Customer.js';
import Role from '../models/Role.js';
import User from '../models/User.js';
import { ROLES } from '../constants/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextNumber } from '../utils/counter.js';
import { runDatabaseWork, sessionOptions } from '../utils/databaseWork.js';
import { isValidPhone, normalizePhone } from '../utils/phone.js';

function createToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.roleId.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
}

function userPayload(user) {
  const payload = {
    id: user._id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    profileImage: user.profileImage,
    status: user.status,
    role: user.roleId.name,
    roleDisplayName: user.roleId.displayName
  };

  if (user.roleId.name === ROLES.SUPER_ADMIN) {
    Object.assign(payload, {
      permissions: user.roleId.permissions || [],
      lastLoginAt: user.lastLoginAt,
      passwordChangedAt: user.passwordChangedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
  }

  return payload;
}

export const login = asyncHandler(async (req, res) => {
  const { login: loginValue, password } = req.body;
  if (!loginValue || !password) throw new AppError('Login and password are required', 422);

  const normalized = String(loginValue).trim().toLowerCase();
  const normalizedPhone = normalizePhone(loginValue);
  const user = await User.findOne({
    $or: [
      { username: normalized },
      { email: normalized },
      { phone: normalizedPhone }
    ]
  })
    .select('+passwordHash')
    .populate('roleId');

  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Invalid login or password', 401);
  }
  if (user.status !== 'ACTIVE' || user.roleId.status !== 'ACTIVE') {
    throw new AppError('Account is unavailable', 403);
  }

  user.lastLoginAt = new Date();
  await user.save();

  res.json({ success: true, token: createToken(user), user: userPayload(user) });
});

export const registerCustomer = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone || !password) {
    throw new AppError('Phone number and password are required', 422);
  }

  if (!isValidPhone(normalizedPhone)) {
    throw new AppError('Enter a valid phone number', 422);
  }

  if (String(password).length < 8) throw new AppError('Password must contain at least 8 characters', 422);

  const role = await Role.findOne({ name: ROLES.CUSTOMER, status: 'ACTIVE' });
  if (!role) throw new AppError('Customer registration is not configured', 500);

  const existingUser = await User.exists({
    $or: [
      { username: normalizedPhone.toLowerCase() },
      { phone: normalizedPhone }
    ]
  });

  if (existingUser) {
    throw new AppError('This phone number is already registered', 409);
  }

  const savedUserId = await runDatabaseWork(async (session) => {
      const [user] = await User.create(
        [{
          roleId: role._id,
          username: normalizedPhone,
          phone: normalizedPhone,
          passwordHash: password,
          displayName: 'Customer'
        }],
        sessionOptions(session)
      );

      const customerCode = await nextNumber('customer', 'CUS', session);
      await Customer.create(
        [{
          customerCode,
          userId: user._id,
          name: '',
          firstName: '',
          middleName: '',
          lastName: '',
          phone: normalizedPhone,
          createdBy: user._id
        }],
        sessionOptions(session)
      );

      return user._id;
  });

  const savedUser = await User.findById(savedUserId).populate('roleId');
  res.status(201).json({
    success: true,
    token: createToken(savedUser),
    user: userPayload(savedUser)
  });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: userPayload(req.user) });
});
