const { body, param, validationResult } = require('express-validator');

exports.createStaffRules = () => [
  body('businessId').isMongoId().withMessage('Valid business ID is required'),
  body('name').trim().notEmpty().withMessage('Staff name is required'),
  body('title').optional().trim(),
  body('phone').optional().trim(),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('imageUrl').optional().isString().trim(),
  body('serviceIds').optional().isArray(),
  body('serviceIds.*').optional().isMongoId(),
  body('workingHours').optional().isArray(),
  body('leaveDays').optional().isArray(),
  body('canViewOwnReservations').optional().isBoolean(),
  body('allowConcurrentBookings').optional(),
  body('concurrentBookingLimit').optional(),
  body('linkUserEmail').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
];

exports.updateStaffRules = () => [
  param('id').isMongoId().withMessage('Invalid staff ID'),
  body('name').optional().trim().notEmpty(),
  body('title').optional().trim(),
  body('phone').optional().trim(),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('imageUrl').optional().isString().trim(),
  body('serviceIds').optional().isArray(),
  body('isActive').optional().isBoolean(),
  body('leaveDays').optional().isArray(),
  body('canViewOwnReservations').optional().isBoolean(),
  body('allowConcurrentBookings').optional(),
  body('concurrentBookingLimit').optional(),
  body('linkUserEmail').optional().trim(),
];

exports.businessIdParamRules = () => [
  param('businessId').isMongoId().withMessage('Invalid business ID'),
];

exports.updateMyStaffPhoneRules = () => [
  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Telefon numarası gerekli.')
    .isLength({ min: 10, max: 32 })
    .withMessage('Telefon numarası geçersiz.'),
];

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const msg = errors.array().map((e) => e.msg).join(', ');
  return res.status(400).json({ status: 'fail', message: msg });
};
