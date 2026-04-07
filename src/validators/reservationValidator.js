const { body, param, query, validationResult } = require('express-validator');
const { RESERVATION_STATUS } = require('../config/constants');

exports.createReservationRules = () => [
  body('businessId').isMongoId().withMessage('Valid business ID is required'),
  body('serviceId').isMongoId().withMessage('Valid service ID is required'),
  body('staffId').optional().isMongoId(),
  body('date').isISO8601().withMessage('Valid date is required'),
  body('time').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Time must be HH:mm format'),
  body('notes').optional().trim(),
];

exports.updateStatusRules = () => [
  param('id').isMongoId().withMessage('Invalid reservation ID'),
  body('status').isIn([RESERVATION_STATUS.APPROVED, RESERVATION_STATUS.CANCELED]).withMessage('Status must be approved or canceled'),
];

exports.availableSlotsQueryRules = () => [
  query('businessId').isMongoId().withMessage('Valid business ID is required'),
  query('serviceId').isMongoId().withMessage('Valid service ID is required'),
  query('date').isISO8601().withMessage('Valid date is required'),
  query('staffId').optional().isMongoId(),
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

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const msg = errors.array().map((e) => e.msg).join(', ');
  return res.status(400).json({ status: 'fail', message: msg });
};
