const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const businessRoutes = require('./routes/businessRoutes');
const apiCategoryRoutes = require('./routes/apiCategoryRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const staffRoutes = require('./routes/staffRoutes');
const reservationRoutes = require('./routes/reservationRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const { error } = require('./utils/response');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/auth', authRoutes);
app.use('/business', businessRoutes);
app.use('/api', apiCategoryRoutes);
app.use('/services', serviceRoutes);
app.use('/staff', staffRoutes);
app.use('/reservations', reservationRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/reviews', reviewRoutes);

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
