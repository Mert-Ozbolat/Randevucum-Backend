const { body, param, query, validationResult } = require('express-validator');
const { RESERVATION_STATUS, ATTENDANCE_OUTCOME } = require('../config/constants');

exports.createReservationRules = () => [
  body('businessId').isMongoId().withMessage('Valid business ID is required'),
  body('serviceId').isMongoId().withMessage('Valid service ID is required'),
  body('staffId').optional().isMongoId(),
  body('date').isISO8601().withMessage('Valid date is required'),
  body('time').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Time must be HH:mm format'),
  body('notes').optional().trim(),
  body('guestName')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('Ad soyad en az 2 karakter olmalı'),
  body('customerPhone')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 10, max: 32 })
    .withMessage('Telefon numarası geçersiz'),
];

exports.updateStatusRules = () => [
  param('id').isMongoId().withMessage('Invalid reservation ID'),
  body('status').isIn([RESERVATION_STATUS.CANCELED]).withMessage('Status must be canceled'),
];

exports.markAttendanceRules = () => [
  param('id').isMongoId().withMessage('Invalid reservation ID'),
  body('outcome')
    .isIn([ATTENDANCE_OUTCOME.ATTENDED, ATTENDANCE_OUTCOME.NO_SHOW])
    .withMessage('Outcome must be attended or no_show'),
  body('note').optional().trim().isLength({ max: 500 }),
];

exports.availableSlotsQueryRules = () => [
  query('businessId').isMongoId().withMessage('Valid business ID is required'),
  query('serviceId').isMongoId().withMessage('Valid service ID is required'),
  query('date').isISO8601().withMessage('Valid date is required'),
  query('staffId').optional().isMongoId(),
];

exports.blockedDatesQueryRules = () => [
  query('businessId').isMongoId().withMessage('Valid business ID is required'),
  query('serviceId').isMongoId().withMessage('Valid service ID is required'),
  query('staffId').optional().isMongoId(),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
];

exports.reservationIdParamRules = () => [
  param('id').isMongoId().withMessage('Invalid reservation ID'),
];

exports.businessIdParamRules = () => [
  param('businessId').isMongoId().withMessage('Invalid business ID'),
];

exports.customerIdParamRules = () => [
  param('customerId').isMongoId().withMessage('Invalid customer ID'),
];

exports.searchBusinessCustomersQueryRules = () => [
  param('businessId').isMongoId().withMessage('Invalid business ID'),
  query('q').optional().isString().trim().isLength({ min: 1, max: 80 }),
];

exports.createManualReservationRules = () => [
  param('businessId').isMongoId().withMessage('Valid business ID is required'),
  body('serviceId').isMongoId().withMessage('Valid service ID is required'),
  body('staffId').optional().isMongoId(),
  body('date').isISO8601().withMessage('Valid date is required'),
  body('time').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Time must be HH:mm format'),
  body('notes').optional().trim().isLength({ max: 500 }),
  body('customerId').optional().isMongoId(),
  body('guestName')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage('Ad soyad en az 2 karakter olmalı'),
  body('customerPhone')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 10, max: 32 })
    .withMessage('Telefon numarası geçersiz'),
  body().custom((_, { req }) => {
    if (req.body.customerId) return true;
    if (req.body.guestName && req.body.customerPhone) return true;
    throw new Error('Müşteri seçin veya ad soyad ile telefon girin.');
  }),
];

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const msg = errors.array().map((e) => e.msg).join(', ');
  return res.status(400).json({ status: 'fail', message: msg });
};
