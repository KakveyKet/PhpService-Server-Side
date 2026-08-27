import { Router } from 'express';
import {
  disburseLoan,
  getLoan,
  listLoans,
  updateLoanPlan
} from '../controllers/loanController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.get('/', listLoans);
router.get('/:id', getLoan);
router.patch(
  '/:id/plan',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  updateLoanPlan
);
router.post('/:id/disburse', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), disburseLoan);

export default router;
