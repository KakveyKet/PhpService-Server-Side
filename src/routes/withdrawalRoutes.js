import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  createWithdrawal,
  listWithdrawals,
  rejectCompletedWithdrawal,
  rejectWithdrawal,
  setWithdrawalCode,
  verifyWithdrawalCode
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
  '/:id/set-code',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  setWithdrawalCode
);
router.post(
  '/:id/reject',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  rejectWithdrawal
);
router.post(
  '/:id/verify-code',
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }),
  allowRoles(ROLES.CUSTOMER),
  verifyWithdrawalCode
);
router.post(
  '/:id/reject-completed',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  rejectCompletedWithdrawal
);

export default router;
