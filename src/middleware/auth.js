const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/errors');
const { error } = require('../utils/response');
const User = require('../models/User');
const { ROLES } = require('../config/constants');

/**
 * Protect routes - require valid JWT
 */
const protect = async (req, res, next) => {
  try {
    let token = null;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return error(res, 401, 'Not authorized. Please login.');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+password');
    if (!user) {
      return error(res, 401, 'User no longer exists.');
    }
    if (!user.isActive) {
      return error(res, 401, 'Account is deactivated.');
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return error(res, 401, 'Invalid or expired token.');
    }
    next(err);
  }
};

/**
 * Restrict to specific roles
 * @param  {...string} roles - e.g. restrictTo(ROLES.SUPER_ADMIN, ROLES.BUSINESS_OWNER)
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return error(res, 401, 'Not authenticated.');
    }
    if (!roles.includes(req.user.role)) {
      return error(res, 403, 'You do not have permission to perform this action.');
    }
    next();
  };
};

/**
 * Optional auth - attach user if token present, don't fail if not
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token = null;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (user && user.isActive) req.user = user;
    next();
  } catch {
    next();
  }
};

module.exports = { protect, restrictTo, optionalAuth };
