import { Router } from 'express';
import { createApplication, listApplications, reviewApplication } from '../controllers/loanApplicationController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.get('/', listApplications);
router.post('/', allowRoles(ROLES.CUSTOMER, ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN), createApplication);
router.post('/:id/review', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), reviewApplication);

export default router;
