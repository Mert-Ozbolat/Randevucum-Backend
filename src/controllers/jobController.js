const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { runWhatsAppReminders } = require('../jobs/whatsappReminders');
const Reservation = require('../models/Reservation');
const { sendReservationBookingWhatsApp } = require('../services/whatsappReservationNotify');

function requireJobsSecret(req, res) {
  const secret = process.env.JOBS_SECRET;
  if (!secret) return false;
  const header = req.headers['x-jobs-secret'];
  const token = req.query?.token;
  return header === secret || token === secret;
}

/**
 * POST /jobs/whatsapp-reminders (or GET)
 * Protected by JOBS_SECRET (x-jobs-secret header or ?token=)
 */
exports.sendWhatsAppReminders = asyncHandler(async (req, res) => {
  if (!requireJobsSecret(req, res)) {
    return error(res, 401, 'Not authorized.');
  }
  const result = await runWhatsAppReminders();
  return success(res, 200, result, 'OK');
});

/**
 * POST /jobs/whatsapp-test-booking?reservationId=...
 * Anlık randevu WhatsApp bildirimini tekrar dener (JOBS_SECRET gerekli).
 */
exports.testBookingWhatsApp = asyncHandler(async (req, res) => {
  if (!requireJobsSecret(req, res)) {
    return error(res, 401, 'Not authorized.');
  }
  const reservationId = req.body?.reservationId || req.query?.reservationId;
  if (!reservationId) {
    return error(res, 400, 'reservationId is required.');
  }
  if (req.query?.force === '1' || req.body?.force === true) {
    await Reservation.updateOne(
      { _id: reservationId },
      {
        $unset: {
          'reminders.businessWhatsAppBookingSentAt': '',
          'reminders.customerWhatsAppBookingSentAt': '',
        },
      }
    );
  }
  const result = await sendReservationBookingWhatsApp(String(reservationId));
  return success(res, 200, result, 'OK');
});

