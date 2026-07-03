const { reservationDayToStoredDate } = require('./calendarDate');

const MAX_EXCEPTION_RANGES = 100;
const MAX_RANGE_SPAN_DAYS = 366;

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

function getExceptionRangeBounds(entry) {
  if (!entry) return null;
  if (entry.startDate && entry.endDate) {
    return { start: entry.startDate, end: entry.endDate };
  }
  if (entry.date) {
    return { start: entry.date, end: entry.date };
  }
  if (entry.startDate) {
    return { start: entry.startDate, end: entry.startDate };
  }
  return null;
}

function isDateInException(entry, date) {
  const bounds = getExceptionRangeBounds(entry);
  if (!bounds) return false;
  const stored = date instanceof Date ? date : reservationDayToStoredDate(date);
  if (!stored) return false;
  const key = exceptionDayKey(stored);
  const startKey = exceptionDayKey(bounds.start);
  const endKey = exceptionDayKey(bounds.end);
  if (!key || !startKey || !endKey) return false;
  return key >= startKey && key <= endKey;
}

/**
 * @param {Array<string|{date?:string,startDate?:string,endDate?:string,reason?:string}>|null|undefined} input
 * @returns {Array<{startDate:Date,endDate:Date,reason:string}>|null}
 */
function normalizeExceptionDays(input) {
  if (input === undefined) return null;
  if (!Array.isArray(input)) return [];

  const out = [];
  const seen = new Set();

  for (const item of input) {
    let startRaw;
    let endRaw;
    if (typeof item === 'string') {
      startRaw = item;
      endRaw = item;
    } else if (item?.startDate || item?.endDate) {
      startRaw = item.startDate;
      endRaw = item.endDate || item.startDate;
    } else if (item?.date) {
      startRaw = item.date;
      endRaw = item.date;
    } else {
      continue;
    }

    let startStored = reservationDayToStoredDate(startRaw);
    let endStored = reservationDayToStoredDate(endRaw);
    if (!startStored || !endStored) continue;

    if (endStored.getTime() < startStored.getTime()) {
      const tmp = startStored;
      startStored = endStored;
      endStored = tmp;
    }

    const spanKeys = eachCalendarDayKeys(startStored, endStored);
    if (spanKeys.length > MAX_RANGE_SPAN_DAYS) continue;

    const rangeKey = `${exceptionDayKey(startStored)}_${exceptionDayKey(endStored)}`;
    if (seen.has(rangeKey)) continue;
    seen.add(rangeKey);

    const reason =
      typeof item === 'object' && item?.reason ? String(item.reason).trim().slice(0, 120) : '';
    out.push({ startDate: startStored, endDate: endStored, reason });
    if (out.length >= MAX_EXCEPTION_RANGES) break;
  }

  out.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return out;
}

function expandExceptionToDayKeys(entry) {
  const bounds = getExceptionRangeBounds(entry);
  if (!bounds) return [];
  const start =
    bounds.start instanceof Date ? bounds.start : reservationDayToStoredDate(bounds.start);
  const end = bounds.end instanceof Date ? bounds.end : reservationDayToStoredDate(bounds.end);
  if (!start || !end) return [];
  let from = start;
  let to = end;
  if (to.getTime() < from.getTime()) {
    from = end;
    to = start;
  }
  return eachCalendarDayKeys(from, to);
}

function isBusinessClosedOnDate(business, date) {
  if (!business?.closedDays?.length) return false;
  return business.closedDays.some((entry) => isDateInException(entry, date));
}

function getBusinessClosedReason(business, date) {
  if (!business?.closedDays?.length) return null;
  const hit = business.closedDays.find((entry) => isDateInException(entry, date));
  return hit?.reason || 'İşletme kapalı';
}

function isStaffOnLeave(staff, date) {
  if (!staff?.leaveDays?.length) return false;
  return staff.leaveDays.some((entry) => isDateInException(entry, date));
}

function getStaffLeaveReason(staff, date) {
  if (!staff?.leaveDays?.length) return null;
  const hit = staff.leaveDays.find((entry) => isDateInException(entry, date));
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
  MAX_EXCEPTION_RANGES,
  MAX_RANGE_SPAN_DAYS,
  exceptionDayKey,
  getExceptionRangeBounds,
  isDateInException,
  normalizeExceptionDays,
  expandExceptionToDayKeys,
  isBusinessClosedOnDate,
  getBusinessClosedReason,
  isStaffOnLeave,
  getStaffLeaveReason,
  eachCalendarDayKeys,
};
