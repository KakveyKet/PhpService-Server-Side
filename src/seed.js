import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { PERMISSIONS, ROLES } from './constants/index.js';
import Product from './models/Product.js';
import Rate from './models/Rate.js';
import Role from './models/Role.js';
import User from './models/User.js';
import { toMoney, toRate } from './utils/decimal.js';

const roleDefinitions = [
  {
    name: ROLES.CUSTOMER,
    displayName: 'Customer',
    permissions: [PERMISSIONS.PRODUCT_VIEW, PERMISSIONS.APPLICATION_CREATE, PERMISSIONS.LOAN_VIEW]
  },
  {
    name: ROLES.USER,
    displayName: 'User',
    permissions: [
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.CUSTOMER_MANAGE,
      PERMISSIONS.PRODUCT_VIEW,
      PERMISSIONS.APPLICATION_VIEW,
      PERMISSIONS.APPLICATION_CREATE,
      PERMISSIONS.LOAN_VIEW,
      PERMISSIONS.REPAYMENT_CREATE,
      PERMISSIONS.REPORT_VIEW
    ]
  },
  {
    name: ROLES.ADMIN,
    displayName: 'Admin',
    permissions: Object.values(PERMISSIONS).filter((permission) => !['user.manage', 'audit.view'].includes(permission))
  },
  {
    name: ROLES.SUPER_ADMIN,
    displayName: 'Super Admin',
    permissions: Object.values(PERMISSIONS)
  }
];

async function seed() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await connectDatabase();

  for (const definition of roleDefinitions) {
    await Role.findOneAndUpdate(
      { name: definition.name },
      { $set: { ...definition, isSystemRole: true, status: 'ACTIVE' } },
      { upsert: true, returnDocument: 'after' }
    );
  }

  const superAdminRole = await Role.findOne({ name: ROLES.SUPER_ADMIN });
  const username = (process.env.SUPER_ADMIN_USERNAME || 'superadmin').toLowerCase();
  let superAdmin = await User.findOne({ username });
  if (!superAdmin) {
    superAdmin = await User.create({
      roleId: superAdminRole._id,
      username,
      email: process.env.SUPER_ADMIN_EMAIL || 'admin@example.com',
      passwordHash: process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe123!',
      displayName: 'System Super Admin'
    });
  }

  let rate = await Rate.findOne({ rateCode: 'RATE-0001' });
  if (!rate) {
    rate = await Rate.create({
      rateCode: 'RATE-0001',
      name: 'Monthly 0.7% Flat',
      ratePercent: toRate('0.7'),
      period: 'MONTHLY',
      calculationMethod: 'FLAT',
      status: 'ACTIVE',
      createdBy: superAdmin._id
    });
  }

  const starterProducts = [
    {
      productCode: 'PERSONAL-001',
      name: 'Personal Loan',
      description: 'Flexible financing for personal needs and important expenses.',
      minimumAmount: 1000,
      maximumAmount: 50000
    },
    {
      productCode: 'BUSINESS-001',
      name: 'Business Loan',
      description: 'Working capital for inventory, equipment and business growth.',
      minimumAmount: 10000,
      maximumAmount: 200000
    },
    {
      productCode: 'OFW-001',
      name: 'OFW Loan',
      description: 'Financial support designed for overseas Filipino workers and families.',
      minimumAmount: 5000,
      maximumAmount: 100000
    }
  ];

  for (const product of starterProducts) {
    await Product.findOneAndUpdate(
      { productCode: product.productCode },
      {
        $set: {
          name: product.name,
          description: product.description,
          rateId: rate._id,
          minimumAmount: toMoney(product.minimumAmount),
          maximumAmount: toMoney(product.maximumAmount),
          minimumTerm: 6,
          maximumTerm: 36,
          termUnit: 'MONTH',
          repaymentFrequency: 'MONTHLY',
          processingFeePercent: toRate(1),
          lateFeeType: 'FIXED',
          lateFeeValue: toRate(100),
          gracePeriodDays: 3,
          currency: 'PHP',
          status: 'ACTIVE'
        },
        $setOnInsert: { createdBy: superAdmin._id }
      },
      { upsert: true, returnDocument: 'after' }
    );
  }

  console.log(`Seed complete. Login with username: ${username}`);
  await disconnectDatabase();
}

seed().catch(async (error) => {
  console.error(error);
  await disconnectDatabase();
  process.exit(1);
});
