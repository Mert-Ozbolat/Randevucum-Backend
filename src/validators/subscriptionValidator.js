const { body, param, validationResult } = require('express-validator');

exports.subscribeRules = () => [
  body('businessId').isMongoId().withMessage('Valid business ID is required'),
];

exports.statusParamRules = () => [
  param('businessId').isMongoId().withMessage('Invalid business ID'),
];

exports.cancelParamRules = () => [
  param('id').isMongoId().withMessage('Invalid subscription ID'),
];

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const msg = errors.array().map((e) => e.msg).join(', ');
  return res.status(400).json({ status: 'fail', message: msg });
};
