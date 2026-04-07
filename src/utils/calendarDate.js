/**
 * Reservation "date" is a calendar day (no time zone from the user's picker).
 * Avoid `new Date("YYYY-MM-DD")` (UTC midnight) + `setHours` (local) — that shifts the day.
 * Store each day at 12:00 UTC so ISO strings start with YYYY-MM-DD and DB range queries stay stable.
 */

function parseYmdParts(s) {
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

/**
 * @param {string} dateInput - "yyyy-MM-dd" or ISO string starting with yyyy-MM-dd
 * @returns {Date | null}
 */
function reservationDayToStoredDate(dateInput) {
  const parts = parseYmdParts(dateInput);
  if (!parts) return null;
  return new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, 12, 0, 0, 0));
}

/**
 * Exclusive upper bound for "same calendar day" queries (next day at 12:00 UTC).
 * @param {Date} storedDay - from reservationDayToStoredDate
 */
function nextReservationDayStoredDate(storedDay) {
  if (!storedDay || Number.isNaN(storedDay.getTime())) return null;
  const y = storedDay.getUTCFullYear();
  const m = storedDay.getUTCMonth();
  const d = storedDay.getUTCDate();
  return new Date(Date.UTC(y, m, d + 1, 12, 0, 0, 0));
}

module.exports = {
  reservationDayToStoredDate,
  nextReservationDayStoredDate,
  parseYmdParts,
};
