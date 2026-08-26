import Role from '../models/Role.js';
import User from '../models/User.js';
import { ROLES, STAFF_ROLES } from '../constants/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { writeAudit } from '../services/auditService.js';

export const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const staffRoles = await Role.find({ name: { $in: STAFF_ROLES } }).select('_id');
  const filter = { roleId: { $in: staffRoles.map((role) => role._id) } };
  if (req.query.q) {
    filter.$or = [
      { username: { $regex: req.query.q, $options: 'i' } },
      { displayName: { $regex: req.query.q, $options: 'i' } },
      { email: { $regex: req.query.q, $options: 'i' } }
    ];
  }

  const [items, total] = await Promise.all([
    User.find(filter).populate('roleId', 'name displayName').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter)
  ]);

  res.json({ success: true, items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const createUser = asyncHandler(async (req, res) => {
  const { username, email, phone, password, displayName, role: roleName = ROLES.USER } = req.body;
  if (!username || !password || !displayName) {
    throw new AppError('Username, password and display name are required', 422);
  }
  if (String(password).length < 8) throw new AppError('Password must contain at least 8 characters', 422);

  const role = await Role.findOne({ name: roleName });
  if (!role || roleName === ROLES.CUSTOMER) throw new AppError('Invalid staff role', 422);

  const user = await User.create({
    roleId: role._id,
    username,
    email: email || undefined,
    phone: phone || undefined,
    passwordHash: password,
    displayName,
    createdBy: req.user._id
  });

  await writeAudit({ req, action: 'USER_CREATED', entityType: 'USER', entityId: user._id, newValues: { username, role: roleName } });
  await user.populate('roleId', 'name displayName');
  res.status(201).json({ success: true, item: user });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate('roleId');
  if (!user) throw new AppError('User not found', 404);
  if (!STAFF_ROLES.includes(user.roleId.name)) {
    throw new AppError('Only staff accounts can be managed here', 422);
  }

  const nextRoleName = req.body.role ?? user.roleId.name;
  const nextStatus = req.body.status ?? user.status;

  if (!STAFF_ROLES.includes(nextRoleName)) {
    throw new AppError('Invalid staff role', 422);
  }

  if (
    user.roleId.name === ROLES.SUPER_ADMIN &&
    user.status === 'ACTIVE' &&
    (nextRoleName !== ROLES.SUPER_ADMIN || nextStatus !== 'ACTIVE')
  ) {
    const activeSuperAdminCount = await User.countDocuments({
      roleId: user.roleId._id,
      status: 'ACTIVE'
    });
    if (activeSuperAdminCount <= 1) {
      throw new AppError('The last active super admin cannot be demoted or disabled', 422);
    }
  }

  const oldValues = {
    username: user.username,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    role: user.roleId.name,
    status: user.status
  };

  if (req.body.username !== undefined) {
    if (!String(req.body.username).trim()) throw new AppError('Username is required', 422);
    user.username = req.body.username;
  }
  if (req.body.email !== undefined) user.email = req.body.email || undefined;
  if (req.body.phone !== undefined) user.phone = req.body.phone || undefined;
  if (req.body.displayName !== undefined) {
    if (!String(req.body.displayName).trim()) throw new AppError('Display name is required', 422);
    user.displayName = req.body.displayName;
  }
  if (req.body.status !== undefined) user.status = req.body.status;
  if (req.body.role) {
    const role = await Role.findOne({ name: req.body.role, status: 'ACTIVE' });
    if (!role || !STAFF_ROLES.includes(role.name)) throw new AppError('Invalid staff role', 422);
    user.roleId = role._id;
  }
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw new AppError('Password must contain at least 8 characters', 422);
    user.passwordHash = req.body.password;
  }

  await user.save();
  await writeAudit({
    req,
    action: 'USER_UPDATED',
    entityType: 'USER',
    entityId: user._id,
    oldValues,
    newValues: {
      username: user.username,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      role: nextRoleName,
      status: user.status,
      passwordChanged: Boolean(req.body.password)
    }
  });
  await user.populate('roleId', 'name displayName');
  res.json({ success: true, item: user });
});

export const resetUserPassword = asyncHandler(async (req, res) => {
  const { newPassword, confirmPassword } = req.body;

  if (!newPassword) {
    throw new AppError('New password is required', 422);
  }

  if (String(newPassword).length < 8) {
    throw new AppError('New password must contain at least 8 characters', 422);
  }

  if (!confirmPassword) {
    throw new AppError('Password confirmation is required', 422);
  }

  if (newPassword !== confirmPassword) {
    throw new AppError('New password and confirmation do not match', 422);
  }

  const targetUser = await User.findById(req.params.id).populate(
    'roleId',
    'name displayName status'
  );

  if (!targetUser) {
    throw new AppError('User account not found', 404);
  }

  const targetRole = targetUser.roleId?.name;

  if (!targetRole) {
    throw new AppError('The target user does not have a valid role', 422);
  }

  // An Admin can reset customer passwords only. A Super Admin can force-reset
  // any user account.
  if (req.role === ROLES.ADMIN && targetRole !== ROLES.CUSTOMER) {
    throw new AppError('Admins can reset customer passwords only', 403);
  }

  targetUser.passwordHash = newPassword;

  // Resetting a locked account also unlocks it. An intentionally inactive
  // account remains inactive until an administrator activates it separately.
  if (targetUser.status === 'LOCKED') {
    targetUser.status = 'ACTIVE';
  }

  await targetUser.save();

  await writeAudit({
    req,
    action: 'USER_PASSWORD_RESET',
    entityType: 'USER',
    entityId: targetUser._id,
    newValues: {
      username: targetUser.username,
      role: targetRole,
      resetByRole: req.role
    }
  });

  res.json({
    success: true,
    message: 'Password reset successfully'
  });
});
