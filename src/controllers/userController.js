import Role from "../models/Role.js";
import User from "../models/User.js";

import { ROLES, STAFF_ROLES } from "../constants/index.js";

import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAudit } from "../services/auditService.js";

function validateRequiredText(value, fieldName) {
  if (value === undefined || !String(value).trim()) {
    throw new AppError(`${fieldName} is required`, 422);
  }
}

function validatePassword(password) {
  if (String(password).length < 8) {
    throw new AppError("Password must contain at least 8 characters", 422);
  }
}

function cleanOptionalValue(value) {
  const cleaned =
    value === null || value === undefined ? "" : String(value).trim();

  return cleaned || undefined;
}

export const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);

  /*
   * Display staff accounts only.
   * Customer accounts are managed
   * through the customer module.
   */
  const staffRoles = await Role.find({
    name: {
      $in: STAFF_ROLES,
    },
  }).select("_id");

  const filter = {
    roleId: {
      $in: staffRoles.map((role) => role._id),
    },
  };

  if (req.query.q) {
    filter.$or = [
      {
        username: {
          $regex: req.query.q,
          $options: "i",
        },
      },
      {
        displayName: {
          $regex: req.query.q,
          $options: "i",
        },
      },
      {
        email: {
          $regex: req.query.q,
          $options: "i",
        },
      },
      {
        phone: {
          $regex: req.query.q,
          $options: "i",
        },
      },
    ];
  }

  const [items, total] = await Promise.all([
    User.find(filter)
      .populate("roleId", "name displayName")
      .sort({
        createdAt: -1,
      })
      .skip((page - 1) * limit)
      .limit(limit),

    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

export const createUser = asyncHandler(async (req, res) => {
  const {
    username,
    email,
    phone,
    password,
    displayName,
    role: roleName = ROLES.USER,
  } = req.body;

  validateRequiredText(username, "Username");

  validateRequiredText(displayName, "Display name");

  if (!password) {
    throw new AppError("Password is required", 422);
  }

  validatePassword(password);

  if (!STAFF_ROLES.includes(roleName)) {
    throw new AppError("Invalid staff role", 422);
  }

  const role = await Role.findOne({
    name: roleName,
    status: "ACTIVE",
  });

  if (!role) {
    throw new AppError("Invalid or inactive staff role", 422);
  }

  const user = await User.create({
    roleId: role._id,
    username: String(username).trim(),
    email: cleanOptionalValue(email),
    phone: cleanOptionalValue(phone),
    passwordHash: password,
    displayName: String(displayName).trim(),
    status: "ACTIVE",
    createdBy: req.user._id,
  });

  await writeAudit({
    req,
    action: "USER_CREATED",
    entityType: "USER",
    entityId: user._id,
    newValues: {
      username: user.username,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      role: roleName,
      status: user.status,
    },
  });

  await user.populate("roleId", "name displayName");

  res.status(201).json({
    success: true,
    item: user,
  });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate("roleId");

  if (!user) {
    throw new AppError("User not found", 404);
  }

  /*
   * Customers are managed from the
   * customer module, not this route.
   */
  if (!STAFF_ROLES.includes(user.roleId.name)) {
    throw new AppError("Only staff accounts can be managed here", 422);
  }

  const nextRoleName = req.body.role ?? user.roleId.name;

  const nextStatus = req.body.status ?? user.status;

  if (!STAFF_ROLES.includes(nextRoleName)) {
    throw new AppError("Invalid staff role", 422);
  }

  /*
   * Prevent the system from losing
   * its final active super-admin.
   */
  if (
    user.roleId.name === ROLES.SUPER_ADMIN &&
    user.status === "ACTIVE" &&
    (nextRoleName !== ROLES.SUPER_ADMIN || nextStatus !== "ACTIVE")
  ) {
    const activeSuperAdminCount = await User.countDocuments({
      roleId: user.roleId._id,
      status: "ACTIVE",
    });

    if (activeSuperAdminCount <= 1) {
      throw new AppError(
        "The last active super admin cannot be demoted or disabled",
        422,
      );
    }
  }

  const oldValues = {
    username: user.username,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    role: user.roleId.name,
    status: user.status,
  };

  if (req.body.username !== undefined) {
    validateRequiredText(req.body.username, "Username");

    user.username = String(req.body.username).trim();
  }

  if (req.body.email !== undefined) {
    user.email = cleanOptionalValue(req.body.email);
  }

  if (req.body.phone !== undefined) {
    user.phone = cleanOptionalValue(req.body.phone);
  }

  if (req.body.displayName !== undefined) {
    validateRequiredText(req.body.displayName, "Display name");

    user.displayName = String(req.body.displayName).trim();
  }

  if (req.body.status !== undefined) {
    user.status = req.body.status;
  }

  if (req.body.role) {
    const role = await Role.findOne({
      name: req.body.role,
      status: "ACTIVE",
    });

    if (!role || !STAFF_ROLES.includes(role.name)) {
      throw new AppError("Invalid staff role", 422);
    }

    user.roleId = role._id;
  }

  if (req.body.password) {
    validatePassword(req.body.password);

    user.passwordHash = req.body.password;
  }

  await user.save();

  await writeAudit({
    req,
    action: "USER_UPDATED",
    entityType: "USER",
    entityId: user._id,
    oldValues,
    newValues: {
      username: user.username,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      role: nextRoleName,
      status: user.status,
      passwordChanged: Boolean(req.body.password),
    },
  });

  await user.populate("roleId", "name displayName");

  res.json({
    success: true,
    item: user,
  });
});
