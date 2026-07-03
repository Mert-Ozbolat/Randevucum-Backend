const { reservationDayToStoredDate } = require('./calendarDate');
const { RESERVATION_STATUS } = require('../config/constants');

const CUSTOMER_CANCEL_HOURS_BEFORE = Number(process.env.CUSTOMER_CANCEL_HOURS_BEFORE || 12);

function timeToMinutes(t) {
  const [hh, mm] = String(t || '00:00').split(':');
  return (Number(hh) || 0) * 60 + (Number(mm) || 0);
}

function reservationStartAt(reservation) {
  const raw = reservation?.date;
  if (!raw) return null;
  const stored = raw instanceof Date ? raw : reservationDayToStoredDate(String(raw));
  if (!stored || Number.isNaN(stored.getTime())) return null;
  const y = stored.getUTCFullYear();
  const mo = stored.getUTCMonth();
  const d = stored.getUTCDate();
  const startMin = timeToMinutes(reservation.time);
  const dt = new Date(y, mo, d);
  dt.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
  return dt;
}

function canCustomerCancelReservation(reservation, now = new Date()) {
  if (!reservation) return false;
  if (![RESERVATION_STATUS.PENDING, RESERVATION_STATUS.APPROVED].includes(reservation.status)) {
    return false;
  }
  const start = reservationStartAt(reservation);
  if (!start) return false;
  const msUntil = start.getTime() - now.getTime();
  return msUntil >= CUSTOMER_CANCEL_HOURS_BEFORE * 60 * 60 * 1000;
}

module.exports = {
  CUSTOMER_CANCEL_HOURS_BEFORE,
  reservationStartAt,
  canCustomerCancelReservation,
};
