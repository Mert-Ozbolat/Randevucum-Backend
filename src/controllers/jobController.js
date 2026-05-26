const { success, error } = require('../utils/response');
const { asyncHandler } = require('../utils/errors');
const { runWhatsAppReminders } = require('../jobs/whatsappReminders');
const Reservation = require('../models/Reservation');
const { sendReservationBookingWhatsApp } = require('../services/whatsappReservationNotify');

exports.sendWhatsAppReminders = asyncHandler(async (req, res) => {
  const result = await runWhatsAppReminders();
  return success(res, 200, result, 'OK');
});

exports.testBookingWhatsApp = asyncHandler(async (req, res) => {
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
