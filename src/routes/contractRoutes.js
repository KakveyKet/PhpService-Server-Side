import { Router } from 'express';
import {
  getContractTemplate,
  getLoanContract,
  updateContractTemplate
} from '../controllers/contractController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get(
  '/template',
  allowRoles(ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  getContractTemplate
);

router.patch(
  '/template',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  updateContractTemplate
);

router.get(
  '/loans/:loanId',
  allowRoles(ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN),
  getLoanContract
);

export default router;
