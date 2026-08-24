import { Router } from 'express';
import { createProduct, getProduct, listProducts, updateProduct } from '../controllers/productController.js';
import { ROLES } from '../constants/index.js';
import { allowRoles, authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);
router.get('/', listProducts);
router.get('/:id', getProduct);
router.post('/', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), createProduct);
router.patch('/:id', allowRoles(ROLES.ADMIN, ROLES.SUPER_ADMIN), updateProduct);

export default router;
