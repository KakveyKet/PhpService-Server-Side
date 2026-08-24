import { Router } from 'express';
import { disburseLoan, getLoan, listLoans } from '../controllers/loanController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.get('/', listLoans);
router.get('/:id', getLoan);
router.post('/:id/disburse', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), disburseLoan);

export default router;
