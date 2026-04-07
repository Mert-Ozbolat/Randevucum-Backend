const { body, param, validationResult } = require('express-validator');

exports.createReviewRules = () => [
  body('businessId').isMongoId().withMessage('Invalid businessId'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').isString().trim().notEmpty().withMessage('Comment is required'),
];

exports.businessIdParamRules = () => [
  param('businessId').isMongoId().withMessage('Invalid businessId'),
];

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const msg = errors.array().map((e) => e.msg).join(', ');
  return res.status(400).json({ status: 'fail', message: msg });
};

