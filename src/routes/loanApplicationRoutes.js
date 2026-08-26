import { Router } from 'express';
import {
  createApplication,
  getApplicationSignatureUrl,
  listApplications,
  reviewApplication
} from '../controllers/loanApplicationController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';
import { uploadLoanApplicationFiles } from '../middleware/loanApplicationUpload.js';

const router = Router();
router.use(authenticate);
router.get('/', listApplications);
router.post(
  '/',
  allowRoles(ROLES.CUSTOMER, ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  uploadLoanApplicationFiles,
  createApplication
);
router.get(
  '/:id/signature',
  allowRoles(ROLES.CUSTOMER, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  getApplicationSignatureUrl
);
router.post('/:id/review', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), reviewApplication);

export default router;
