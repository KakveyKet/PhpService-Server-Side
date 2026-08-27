import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './routes/authRoutes.js';
import contractRoutes from './routes/contractRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import loanApplicationRoutes from './routes/loanApplicationRoutes.js';
import loanRoutes from './routes/loanRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import productRoutes from './routes/productRoutes.js';
import rateRoutes from './routes/rateRoutes.js';
import repaymentRoutes from './routes/repaymentRoutes.js';
import userRoutes from './routes/userRoutes.js';
import withdrawalRoutes from './routes/withdrawalRoutes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { realtimeDiagnostics } from './services/realtimeService.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL?.split(',') || ['http://localhost:5173'], credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100 }), authRoutes);
app.get('/api/health', (_req, res) => res.json({
  success: true,
  service: 'microfinance-api',
  realtime: realtimeDiagnostics()
}));
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/rates', rateRoutes);
app.use('/api/products', productRoutes);
app.use('/api/loan-applications', loanApplicationRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/repayments', repaymentRoutes);
app.use('/api/withdrawals', withdrawalRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
