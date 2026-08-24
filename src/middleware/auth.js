import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) throw new AppError('Authentication is required', 401);

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new AppError('Invalid or expired token', 401);
  }

  const user = await User.findById(decoded.sub).populate('roleId');
  if (!user || user.status !== 'ACTIVE' || user.roleId?.status !== 'ACTIVE') {
    throw new AppError('Account is unavailable', 401);
  }

  req.user = user;
  req.role = user.roleId.name;
  next();
});

export function allowRoles(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.role)) return next(new AppError('You do not have permission', 403));
    next();
  };
}

export function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user.roleId.permissions.includes(permission)) {
      return next(new AppError('You do not have permission', 403));
    }
    next();
  };
}
