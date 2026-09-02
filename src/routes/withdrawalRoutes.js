import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  completeWithdrawal,
  createWithdrawalCode,
  forceDeleteWithdrawal,
  listWithdrawalCodes,
  listWithdrawals,
  rejectCompletedWithdrawal,
  rejectWithdrawal
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
router.get(
  '/codes',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  listWithdrawalCodes
);
router.post(
  '/codes',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  createWithdrawalCode
);
router.post(
  '/complete',
  rateLimit({ windowMs: 60 * 60 * 1000, limit: 10 }),
  allowRoles(ROLES.CUSTOMER),
  completeWithdrawal
);
router.post(
  '/:id/reject',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  rejectWithdrawal
);
router.post(
  '/:id/reject-completed',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  rejectCompletedWithdrawal
);
router.delete(
  '/:id/force',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  forceDeleteWithdrawal
);

export default router;
