import Customer from '../models/Customer.js';
import Installment from '../models/Installment.js';
import Loan from '../models/Loan.js';
import LoanApplication from '../models/LoanApplication.js';
import Repayment from '../models/Repayment.js';
import { ROLES } from '../constants/index.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const getDashboard = asyncHandler(async (req, res) => {
  if (req.role === ROLES.CUSTOMER) {
    const customer = await Customer.findOne({ userId: req.user._id });
    if (!customer) throw new AppError('Customer profile not found', 404);

    const [applicationCount, loans, nextInstallment] = await Promise.all([
      LoanApplication.countDocuments({ customerId: customer._id }),
      Loan.find({ customerId: customer._id }).sort({ createdAt: -1 }),
      Installment.findOne({
        loanId: { $in: await Loan.find({ customerId: customer._id }).distinct('_id') },
        status: { $in: ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'] }
      }).sort({ dueDate: 1 })
    ]);

    return res.json({
      success: true,
      data: {
        customer,
        applicationCount,
        activeLoanCount: loans.filter((loan) => ['ACTIVE', 'OVERDUE'].includes(loan.status)).length,
        loans,
        nextInstallment
      }
    });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const [
    customerCount,
    pendingApplicationCount,
    activeLoanCount,
    overdueInstallmentCount,
    portfolio,
    todayCollections,
    recentApplications
  ] = await Promise.all([
    Customer.countDocuments({ status: 'ACTIVE' }),
    LoanApplication.countDocuments({ status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } }),
    Loan.countDocuments({ status: { $in: ['ACTIVE', 'OVERDUE'] } }),
    Installment.countDocuments({ status: 'OVERDUE' }),
    Loan.aggregate([
      { $match: { status: { $in: ['ACTIVE', 'OVERDUE'] } } },
      { $group: { _id: null, value: { $sum: '$balances.total' } } }
    ]),
    Repayment.aggregate([
      { $match: { status: 'CONFIRMED', paymentDate: { $gte: startOfDay, $lt: endOfDay } } },
      { $group: { _id: null, value: { $sum: '$amount' } } }
    ]),
    LoanApplication.find()
      .populate('customerId', 'customerCode name firstName lastName')
      .populate('productId', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
  ]);

  res.json({
    success: true,
    data: {
      customerCount,
      pendingApplicationCount,
      activeLoanCount,
      overdueInstallmentCount,
      portfolioBalance: portfolio[0]?.value ?? 0,
      todayCollections: todayCollections[0]?.value ?? 0,
      recentApplications
    }
  });
});
