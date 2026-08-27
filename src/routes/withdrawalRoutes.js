import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  approveWithdrawal,
  createWithdrawal,
  generateWithdrawalOtp,
  listWithdrawals,
  rejectWithdrawal,
  verifyWithdrawalOtp
} from '../controllers/withdrawalController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  allowRoles(ROLES.CUSTOMER, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  listWithdrawals
);
router.post(
  '/',
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 10 }),
  allowRoles(ROLES.CUSTOMER),
  createWithdrawal
);
router.post(
  '/:id/generate-otp',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  generateWithdrawalOtp
);
router.post(
  '/:id/approve',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  approveWithdrawal
);
router.post(
  '/:id/reject',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  rejectWithdrawal
);
router.post(
  '/:id/verify-otp',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }),
  allowRoles(ROLES.CUSTOMER),
  verifyWithdrawalOtp
);

export default router;
