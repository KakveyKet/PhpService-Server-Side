import { Router } from 'express';
import { createRepayment, listRepayments, reverseRepayment } from '../controllers/repaymentController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, allowRoles(ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN));
router.get('/', listRepayments);
router.post('/', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), createRepayment);
router.post('/:id/reverse', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), reverseRepayment);

export default router;
