import { Router } from 'express';
import {
  createRate,
  deleteRate,
  listRates,
  updateRate
} from '../controllers/rateController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.get('/', listRates);
router.post('/', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), createRate);
router.patch('/:id', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), updateRate);
router.delete('/:id', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), deleteRate);

export default router;
