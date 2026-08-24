import 'dotenv/config';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { PERMISSIONS, ROLES } from './constants/index.js';
import Role from './models/Role.js';
import User from './models/User.js';

function validatePassword(password) {
  return (
    password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function normalizeOptional(value) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

async function recoverSuperAdmin() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run this command from an interactive backend terminal.');
  }

  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required in backend/.env');
  }

  const terminal = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('\nLocal Super Admin Recovery');
    console.log('This command runs directly against your MongoDB database.\n');

    const usernameInput = await terminal.question('Username [superadmin]: ');
    const username = String(usernameInput || 'superadmin').trim().toLowerCase();
    const displayNameInput = await terminal.question('Display name [System Super Admin]: ');
    const displayName = String(displayNameInput || 'System Super Admin').trim();
    const email = normalizeOptional(await terminal.question('Email (optional): '));
    const phone = normalizeOptional(await terminal.question('Phone (optional): '));
    const password = await terminal.question('New password: ');

    if (!/^[a-z0-9._-]{4,40}$/.test(username)) {
      throw new Error(
        'Username must contain 4-40 letters, numbers, dots, underscores or hyphens.'
      );
    }

    if (!validatePassword(password)) {
      throw new Error(
        'Password must contain at least 12 characters with uppercase, lowercase, number and special character.'
      );
    }

    const confirmation = await terminal.question(
      `Create or reset Super Admin "${username}"? Type YES to continue: `
    );

    if (confirmation !== 'YES') {
      console.log('Recovery cancelled.');
      return;
    }

    await connectDatabase();

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

    const duplicateConditions = [];
    if (email) duplicateConditions.push({ email: email.toLowerCase() });
    if (phone) duplicateConditions.push({ phone });

    if (duplicateConditions.length) {
      const duplicateUser = await User.findOne({
        username: { $ne: username },
        $or: duplicateConditions
      });

      if (duplicateUser) {
        throw new Error('Email or phone is already used by another account.');
      }
    }

    let user = await User.findOne({ username }).select('+passwordHash');
    const created = !user;

    if (!user) {
      user = new User({
        username,
        roleId: superAdminRole._id,
        displayName,
        email,
        phone,
        passwordHash: password,
        status: 'ACTIVE',
        createdBy: null
      });
    } else {
      user.roleId = superAdminRole._id;
      user.displayName = displayName;
      user.status = 'ACTIVE';
      user.passwordHash = password;
      if (email) user.email = email.toLowerCase();
      if (phone) user.phone = phone;
    }

    await user.save();

    console.log(
      `\nSuccess: Super Admin account ${created ? 'created' : 'reset'} for username "${user.username}".`
    );
    console.log('You can now start the API and sign in.\n');
  } finally {
    terminal.close();
    await disconnectDatabase();
  }
}

recoverSuperAdmin().catch(async (error) => {
  console.error(`\nRecovery failed: ${error.message}`);
  await disconnectDatabase();
  process.exitCode = 1;
});
