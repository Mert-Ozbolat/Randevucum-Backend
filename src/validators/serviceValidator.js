const { body, param, validationResult } = require('express-validator');

exports.createServiceRules = () => [
  body('businessId').isMongoId().withMessage('Valid business ID is required'),
  body('name').trim().notEmpty().withMessage('Service name is required'),
  body('durationMinutes').isInt({ min: 5, max: 480 }).withMessage('Duration must be between 5 and 480 minutes'),
  body('description').optional().trim(),
  body('price').optional().isFloat({ min: 0 }),
  body('currency').optional().trim(),
];

exports.updateServiceRules = () => [
  param('id').isMongoId().withMessage('Invalid service ID'),
  body('name').optional().trim().notEmpty(),
  body('durationMinutes').optional().isInt({ min: 5, max: 480 }),
  body('description').optional().trim(),
  body('price').optional().isFloat({ min: 0 }),
  body('isActive').optional().isBoolean(),
];

exports.serviceIdParamRules = () => [
  param('id').isMongoId().withMessage('Invalid service ID'),
];

exports.businessIdParamRules = () => [
  param('businessId').isMongoId().withMessage('Invalid business ID'),
];

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const msg = errors.array().map((e) => e.msg).join(', ');
  return res.status(400).json({ status: 'fail', message: msg });
};
