const { AppError } = require('../utils/errors');

function notFoundHandler(req, res) {
  res.status(404).json({
    status: 'fail',
    message: 'Route not found.',
  });
}

function globalErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const isProd = process.env.NODE_ENV === 'production';
  let statusCode = err.statusCode || 500;
  let message = err.isOperational || err instanceof AppError ? err.message : 'Internal server error';

  if (err.name === 'ValidationError' && err.errors) {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  }

  if (err.code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry.';
  }

  if (!isProd) {
    console.error('[error]', {
      requestId: req.requestId,
      path: req.originalUrl,
      message: err.message,
      stack: err.stack,
    });
  } else {
    console.error('[error]', {
      requestId: req.requestId,
      path: req.originalUrl,
      statusCode,
      name: err.name,
    });
  }

  res.status(statusCode).json({
    status: statusCode >= 500 ? 'error' : 'fail',
    message,
    ...(isProd ? {} : { requestId: req.requestId }),
  });
}

module.exports = { notFoundHandler, globalErrorHandler };
