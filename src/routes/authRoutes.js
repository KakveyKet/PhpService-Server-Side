import { Router } from 'express';
import { login, me, registerCustomer } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/login', login);
router.post('/register-customer', registerCustomer);
router.get('/me', authenticate, me);

export default router;
