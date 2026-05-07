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
const statsRoutes = require('./routes/statsRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const stripeController = require('./controllers/stripeController');
const { error } = require('./utils/response');

const app = express();

app.use(cors());
// Stripe webhook must see raw body for signature verification (before express.json)
app.post(
  '/payments/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeController.stripeWebhook
);
// Backward/Custom public URL: https://api.randevucum.online/webhook
app.post('/webhook', express.raw({ type: 'application/json' }), stripeController.stripeWebhook);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  const readyState = mongoose?.connection?.readyState; // 0=disconnected,1=connected,2=connecting,3=disconnecting
  const dbConnected = readyState === 1;
  const status = dbConnected ? 'ok' : 'degraded';

  res.status(dbConnected ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    db: {
      connected: dbConnected,
      readyState,
    },
  });
});

// API routes
app.use('/auth', authRoutes);
app.use('/business', businessRoutes);
app.use('/api', apiCategoryRoutes);
app.use('/services', serviceRoutes);
app.use('/staff', staffRoutes);
app.use('/reservations', reservationRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/payments', paymentRoutes);
app.use('/jobs', jobRoutes);
app.use('/reviews', reviewRoutes);
app.use('/stats', statsRoutes);
app.use('/upload', uploadRoutes);

// 404
app.use((req, res) => {
  error(res, 404, `Route ${req.method} ${req.originalUrl} not found`);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const statusCode = err.statusCode || 500;
  const message = err.isOperational ? err.message : 'Internal server error';
  res.status(statusCode).json({
    status: 'error',
    message,
  });
});

module.exports = app;
