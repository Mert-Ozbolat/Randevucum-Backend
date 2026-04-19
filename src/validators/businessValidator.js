const { body, param, query, validationResult } = require('express-validator');
const { BUSINESS_TYPES } = require('../config/constants');

exports.createBusinessRules = () => [
  body('name').trim().notEmpty().withMessage('Business name is required'),
  body('mainCategory').optional().trim(),
  body('subCategory').optional().trim(),
  body('area').optional().trim(),
  body('profession').optional().trim(),
  // businessType UI'dan gelmeyebilir; controller gerekirse derive eder.
  body('businessType').optional().isIn(Object.values(BUSINESS_TYPES)).withMessage('Invalid business type'),
  body('address').optional().isObject(),
  body('location').optional().isObject(),
  body('phone').optional().trim(),
  body('email').optional().isEmail().normalizeEmail(),
  body('description').optional().trim(),
  body('workingHours').optional().isArray(),
  body('breakTimes').optional().isArray(),
];

exports.updateBusinessRules = () => [
  param('id').isMongoId().withMessage('Invalid business ID'),
  body('name').optional().trim().notEmpty(),
  body('mainCategory').optional().trim(),
  body('subCategory').optional().trim(),
  body('area').optional().trim(),
  body('profession').optional().trim(),
  body('businessType').optional().isIn(Object.values(BUSINESS_TYPES)),
  body('address').optional().isObject(),
  body('location').optional().isObject(),
  body('phone').optional().trim(),
  body('email').optional().isEmail().normalizeEmail(),
  body('workingHours').optional().isArray(),
  body('breakTimes').optional().isArray(),
  body('isActive').optional().isBoolean(),
  body('description').optional().trim(),
  body('imageUrl').optional().isString(),
];

exports.getBusinessRules = () => [
  param('id').isMongoId().withMessage('Invalid business ID'),
];

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const msg = errors.array().map((e) => e.msg).join(', ');
  return res.status(400).json({ status: 'fail', message: msg });
};
