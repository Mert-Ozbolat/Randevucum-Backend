const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');
const mongoSanitize = require('express-mongo-sanitize');
const { error } = require('../utils/response');

const isProd = process.env.NODE_ENV === 'production';

function getCorsOrigins() {
  const raw = process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function buildCorsOptions() {
  const allowed = getCorsOrigins();
  const devLocal =
    !isProd &&
    allowed.length === 0;

  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (devLocal) {
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
          return callback(null, true);
        }
      }
      const normalized = origin.replace(/\/$/, '');
      if (allowed.includes(normalized)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-jobs-secret'],
    maxAge: 86400,
  };
}

const helmetMiddleware = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

const globalRateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.RATE_LIMIT_MAX || 400),
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many requests. Please try again later.' },
  skip: (req) =>
    req.path === '/health' ||
    req.path === '/payments/stripe/webhook' ||
    req.path === '/webhook',
});

const authRateLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 25),
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many login attempts. Please try again later.' },
});

const jsonBodyLimit = process.env.JSON_BODY_LIMIT || '256kb';

function requestId(req, res, next) {
  req.requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

function stripSensitiveHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  next();
}

function blockSuspiciousQuery(req, res, next) {
  const q = JSON.stringify(req.query || {});
  if (q.length > 8000) {
    return error(res, 400, 'Query string too large.');
  }
  next();
}

function corsErrorHandler(err, req, res, next) {
  if (err && err.message === 'Not allowed by CORS') {
    return error(res, 403, 'Origin not allowed.');
  }
  next(err);
}

module.exports = {
  helmetMiddleware,
  buildCorsOptions,
  globalRateLimiter,
  authRateLimiter,
  jsonBodyLimit,
  hpp: hpp(),
  mongoSanitize: mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
      if (isProd) {
        console.warn('[security] sanitized', { path: req.path, key, requestId: req.requestId });
      }
    },
  }),
  requestId,
  stripSensitiveHeaders,
  blockSuspiciousQuery,
  corsErrorHandler,
};
