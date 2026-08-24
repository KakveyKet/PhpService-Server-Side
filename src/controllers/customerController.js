import Customer from '../models/Customer.js';
import Loan from '../models/Loan.js';
import LoanApplication from '../models/LoanApplication.js';
import Repayment from '../models/Repayment.js';
import User from '../models/User.js';
import { ROLES } from '../constants/index.js';
import { writeAudit } from '../services/auditService.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { nextNumber } from '../utils/counter.js';
import { runDatabaseWork, sessionOptions } from '../utils/databaseWork.js';
import { toMoney } from '../utils/decimal.js';

export const listCustomers = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    filter.$or = [
      { customerCode: { $regex: req.query.q, $options: 'i' } },
      { firstName: { $regex: req.query.q, $options: 'i' } },
      { lastName: { $regex: req.query.q, $options: 'i' } },
      { phone: { $regex: req.query.q, $options: 'i' } }
    ];
  }

  const [items, total] = await Promise.all([
    Customer.find(filter).populate('userId', 'username status').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Customer.countDocuments(filter)
  ]);

  res.json({ success: true, items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

export const getMyCustomer = asyncHandler(async (req, res) => {
  if (req.role !== ROLES.CUSTOMER) throw new AppError('Customer account required', 403);
  const customer = await Customer.findOne({ userId: req.user._id });
  if (!customer) throw new AppError('Customer profile not found', 404);
  res.json({ success: true, item: customer });
});

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id).populate('userId', 'username status');
  if (!customer) throw new AppError('Customer not found', 404);
  res.json({ success: true, item: customer });
});

export const createCustomer = asyncHandler(async (req, res) => {
  const { firstName, lastName, phone } = req.body;
  if (!firstName || !lastName || !phone) throw new AppError('First name, last name and phone are required', 422);

  const customer = await Customer.create({
    ...req.body,
    customerCode: await nextNumber('customer', 'CUS'),
    nationalId: req.body.nationalId || undefined,
    monthlyIncome: toMoney(req.body.monthlyIncome || 0),
    createdBy: req.user._id
  });

  await writeAudit({ req, action: 'CUSTOMER_CREATED', entityType: 'CUSTOMER', entityId: customer._id, newValues: req.body });
  res.status(201).json({ success: true, item: customer });
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw new AppError('Customer not found', 404);

  const allowed = ['firstName', 'middleName', 'lastName', 'gender', 'dateOfBirth', 'nationalId', 'phone', 'email', 'occupation', 'address', 'status'];
  const oldValues = customer.toObject();
  for (const field of allowed) {
    if (req.body[field] !== undefined) customer[field] = req.body[field];
  }
  if (req.body.nationalId !== undefined) customer.nationalId = req.body.nationalId || undefined;
  if (req.body.monthlyIncome !== undefined) customer.monthlyIncome = toMoney(req.body.monthlyIncome);

  await customer.save();
  await writeAudit({ req, action: 'CUSTOMER_UPDATED', entityType: 'CUSTOMER', entityId: customer._id, oldValues, newValues: customer.toObject() });
  res.json({ success: true, item: customer });
});

export const deleteCustomer = asyncHandler(async (req, res) => {
  await runDatabaseWork(async (session) => {
    const customer = await Customer.findById(req.params.id).session(session);
    if (!customer) throw new AppError('Customer not found', 404);

    const [applicationCount, loanCount, repaymentCount] = await Promise.all([
      LoanApplication.countDocuments({ customerId: customer._id }).session(session),
      Loan.countDocuments({ customerId: customer._id }).session(session),
      Repayment.countDocuments({ customerId: customer._id }).session(session)
    ]);

    if (applicationCount || loanCount || repaymentCount) {
      throw new AppError(
        'This customer has financial records and cannot be deleted. Set the customer status to INACTIVE instead.',
        409
      );
    }

    const oldValues = customer.toObject();

    if (customer.userId) {
      await User.deleteOne(
        { _id: customer.userId },
        sessionOptions(session)
      );
    }

    await Customer.deleteOne(
      { _id: customer._id },
      sessionOptions(session)
    );

    await writeAudit({
      req,
      action: 'CUSTOMER_DELETED',
      entityType: 'CUSTOMER',
      entityId: customer._id,
      oldValues,
      session
    });
  });

  res.json({
    success: true,
    message: 'Customer deleted successfully'
  });
});
