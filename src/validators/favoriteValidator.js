const { body, param, validationResult } = require('express-validator');

exports.businessIdBodyRules = () => [
  body('businessId').isMongoId().withMessage('Geçerli işletme ID gerekli.'),
];

exports.businessIdParamRules = () => [
  param('businessId').isMongoId().withMessage('Geçerli işletme ID gerekli.'),
];

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const msg = errors.array().map((e) => e.msg).join(', ');
  return res.status(400).json({ status: 'fail', message: msg });
};
