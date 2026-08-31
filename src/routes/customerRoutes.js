import { Router } from 'express';
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  getCustomerIdentityImageUrls,
  getMyCustomer,
  getCustomerSelfieWithIdUrl,
  listCustomers,
  uploadCustomerIdentityImages,
  uploadCustomerSelfieWithId,
  updateCustomer
} from '../controllers/customerController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';
import {
  uploadIdentityImages,
  uploadSelfieWithId
} from '../middleware/customerUpload.js';

const router = Router();
router.use(authenticate);
router.get('/me', allowRoles(ROLES.CUSTOMER), getMyCustomer);
router.get('/', allowRoles(ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN), listCustomers);
router.post('/', allowRoles(ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN), createCustomer);
router.get('/:id', allowRoles(ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN), getCustomer);
router.get(
  '/:id/identity-images',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  getCustomerIdentityImageUrls
);
router.post(
  '/:id/identity-images',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  uploadIdentityImages,
  uploadCustomerIdentityImages
);
router.get(
  '/:id/selfie-with-id',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  getCustomerSelfieWithIdUrl
);
router.post(
  '/:id/selfie-with-id',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  uploadSelfieWithId,
  uploadCustomerSelfieWithId
);
router.patch(
  '/:id',
  allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  updateCustomer
);
router.delete('/:id', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), deleteCustomer);

export default router;
