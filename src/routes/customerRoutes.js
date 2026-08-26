import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  getCustomerIdentityImageUrls,
  getMyBankDetails,
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
const bankDetailsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many password attempts. Try again later.'
  }
});

router.use(authenticate);
router.get('/me', allowRoles(ROLES.CUSTOMER), getMyCustomer);
router.post(
  '/me/bank-details',
  allowRoles(ROLES.CUSTOMER),
  bankDetailsLimiter,
  getMyBankDetails
);
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
