const { body, validationResult } = require('express-validator');

exports.registerRules = () => [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('role').optional().isIn(['customer', 'business_owner']).withMessage('Invalid role'),
  body('phone')
    .optional()
    .trim()
    .custom((value, { req }) => {
      const role = req.body?.role;
      if (role === 'business_owner' && (!value || !String(value).trim())) {
        throw new Error('Telefon işletme hesabı için zorunludur.');
      }
      return true;
    }),
];

exports.loginRules = () => [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

exports.googleAuthRules = () => [
  body('idToken').trim().notEmpty().withMessage('Google credential is required'),
  body('accountType').optional().isIn(['customer', 'business_owner']).withMessage('Invalid account type'),
  body('firstName').optional().trim().notEmpty(),
  body('lastName').optional().trim().notEmpty(),
  body('phone').optional().trim(),
];

exports.updateProfileRules = () => [
  body('firstName').optional().trim().isLength({ min: 1, max: 80 }).withMessage('Ad geçersiz.'),
  body('lastName').optional().trim().isLength({ min: 1, max: 80 }).withMessage('Soyad geçersiz.'),
  body('phone').optional({ values: 'null' }).trim(),
  body('avatarUrl').optional({ values: 'null' }).trim().isLength({ max: 2048 }).withMessage('Profil resmi URL çok uzun.'),
];

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const msg = errors.array().map((e) => e.msg).join(', ');
  return res.status(400).json({ status: 'fail', message: msg });
};
