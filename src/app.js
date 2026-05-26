const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const businessRoutes = require('./routes/businessRoutes');
const apiCategoryRoutes = require('./routes/apiCategoryRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const staffRoutes = require('./routes/staffRoutes');
const reservationRoutes = require('./routes/reservationRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const jobRoutes = require('./routes/jobRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const favoriteRoutes = require('./routes/favoriteRoutes');
const statsRoutes = require('./routes/statsRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const stripeController = require('./controllers/stripeController');
const {
  helmetMiddleware,
  buildCorsOptions,
  globalRateLimiter,
  authRateLimiter,
  jsonBodyLimit,
  hpp,
  mongoSanitize,
  requestId,
  stripSensitiveHeaders,
  blockSuspiciousQuery,
  corsErrorHandler,
} = require('./middleware/security');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandler');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Cloud Run / reverse proxy — doğru IP ve rate limit için
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));
app.disable('x-powered-by');

app.use(requestId);
app.use(stripSensitiveHeaders);
app.use(helmetMiddleware);
app.use(cors(buildCorsOptions()));
app.use(corsErrorHandler);

// Stripe webhook — ham gövde (imza doğrulama)
app.post(
  '/payments/stripe/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  stripeController.stripeWebhook
);
app.post(
  '/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  stripeController.stripeWebhook
);

app.use(blockSuspiciousQuery);
app.use(globalRateLimiter);
app.use(hpp);
app.use(express.json({ limit: jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonBodyLimit, parameterLimit: 50 }));
app.use(mongoSanitize);

app.get('/health', (req, res) => {
  const readyState = mongoose?.connection?.readyState;
  const dbConnected = readyState === 1;
  if (isProd) {
    return res.status(dbConnected ? 200 : 503).json({ status: dbConnected ? 'ok' : 'degraded' });
  }
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    db: { connected: dbConnected, readyState },
  });
});

app.use('/auth', authRateLimiter, authRoutes);
app.use('/business', businessRoutes);
app.use('/api', apiCategoryRoutes);
app.use('/services', serviceRoutes);
app.use('/staff', staffRoutes);
app.use('/reservations', reservationRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/payments', paymentRoutes);
app.use('/jobs', jobRoutes);
app.use('/reviews', reviewRoutes);
app.use('/favorites', favoriteRoutes);
app.use('/stats', statsRoutes);
app.use('/upload', uploadRoutes);

app.use(notFoundHandler);
app.use(globalErrorHandler);

module.exports = app;
