import { Router } from 'express';
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  getMyCustomer,
  listCustomers,
  updateCustomer
} from '../controllers/customerController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.get('/me', allowRoles(ROLES.CUSTOMER), getMyCustomer);
router.get('/', allowRoles(ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN), listCustomers);
router.post('/', allowRoles(ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN), createCustomer);
router.get('/:id', allowRoles(ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN), getCustomer);
router.patch('/:id', allowRoles(ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN), updateCustomer);
router.delete('/:id', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), deleteCustomer);

export default router;
