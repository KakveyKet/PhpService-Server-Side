import { Router } from 'express';
import {
  createUser,
  listUsers,
  resetUserPassword,
  updateUser
} from '../controllers/userController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.patch(
  '/:id/reset-password',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  resetUserPassword
);

router.get('/', allowRoles(ROLES.SUPER_ADMIN), listUsers);
router.post('/', allowRoles(ROLES.SUPER_ADMIN), createUser);
router.patch('/:id', allowRoles(ROLES.SUPER_ADMIN), updateUser);

export default router;
