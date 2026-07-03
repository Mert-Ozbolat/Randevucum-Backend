const { reservationDayToStoredDate } = require('./calendarDate');

const MAX_EXCEPTION_DAYS = 366;

/**
 * @param {Date | string | null | undefined} storedOrInput
 * @returns {string | null} yyyy-MM-dd
 */
function exceptionDayKey(storedOrInput) {
  if (!storedOrInput) return null;
  if (typeof storedOrInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(storedOrInput.trim())) {
    return storedOrInput.trim();
  }
  const d = storedOrInput instanceof Date ? storedOrInput : new Date(storedOrInput);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function exceptionDaysMatch(a, b) {
  const keyA = exceptionDayKey(a);
  const keyB = exceptionDayKey(b);
  return Boolean(keyA && keyB && keyA === keyB);
}

/**
 * @param {Array<string|{date:string,reason?:string}>|null|undefined} input
 * @returns {Array<{date:Date,reason:string}>|null}
 */
function normalizeExceptionDays(input) {
  if (input === undefined) return null;
  if (!Array.isArray(input)) return [];

  const out = [];
  const seen = new Set();

  for (const item of input) {
    const rawDate = typeof item === 'string' ? item : item?.date;
    const stored = reservationDayToStoredDate(rawDate);
    if (!stored) continue;
    const key = exceptionDayKey(stored);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const reason =
      typeof item === 'object' && item?.reason ? String(item.reason).trim().slice(0, 120) : '';
    out.push({ date: stored, reason });
    if (out.length >= MAX_EXCEPTION_DAYS) break;
  }

  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}

function isBusinessClosedOnDate(business, date) {
  const stored = date instanceof Date ? date : reservationDayToStoredDate(date);
  if (!stored || !business?.closedDays?.length) return false;
  return business.closedDays.some((entry) => exceptionDaysMatch(entry.date, stored));
}

function getBusinessClosedReason(business, date) {
  const stored = date instanceof Date ? date : reservationDayToStoredDate(date);
  if (!stored || !business?.closedDays?.length) return null;
  const hit = business.closedDays.find((entry) => exceptionDaysMatch(entry.date, stored));
  return hit?.reason || 'İşletme kapalı';
}

function isStaffOnLeave(staff, date) {
  const stored = date instanceof Date ? date : reservationDayToStoredDate(date);
  if (!stored || !staff?.leaveDays?.length) return false;
  return staff.leaveDays.some((entry) => exceptionDaysMatch(entry.date, stored));
}

function getStaffLeaveReason(staff, date) {
  const stored = date instanceof Date ? date : reservationDayToStoredDate(date);
  if (!stored || !staff?.leaveDays?.length) return null;
  const hit = staff.leaveDays.find((entry) => exceptionDaysMatch(entry.date, stored));
  return hit?.reason || 'İzin günü';
}

/**
 * @param {Date} fromStored inclusive
 * @param {Date} toStored inclusive
 */
function eachCalendarDayKeys(fromStored, toStored) {
  const keys = [];
  if (!fromStored || !toStored) return keys;
  let cursor = new Date(fromStored.getTime());
  const end = toStored.getTime();
  while (cursor.getTime() <= end) {
    keys.push(exceptionDayKey(cursor));
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const d = cursor.getUTCDate();
    cursor = new Date(Date.UTC(y, m, d + 1, 12, 0, 0, 0));
  }
  return keys.filter(Boolean);
}

module.exports = {
  MAX_EXCEPTION_DAYS,
  exceptionDayKey,
  exceptionDaysMatch,
  normalizeExceptionDays,
  isBusinessClosedOnDate,
  getBusinessClosedReason,
  isStaffOnLeave,
  getStaffLeaveReason,
  eachCalendarDayKeys,
};
