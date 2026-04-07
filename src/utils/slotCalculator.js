/**
 * Calculates available time slots for a given business, service, date and optional staff.
 * Prevents double booking by excluding existing reservations.
 */

const { SLOT_INTERVAL_MINUTES } = require('../config/constants');

/**
 * Parse "HH:mm" to minutes since midnight
 */
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

/**
 * Minutes since midnight to "HH:mm"
 */
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Get working hours for a day (from business or staff override)
 * @param {number} dayOfWeek 0-6
 * @param {object} workingHours array of { dayOfWeek, open, close, isClosed }
 * @returns { { open: string, close: string } | null }
 */
function getWorkingHoursForDay(dayOfWeek, workingHours) {
  if (!workingHours || workingHours.length === 0) return null;
  const daySchedule = workingHours.find((wh) => wh.dayOfWeek === dayOfWeek);
  if (!daySchedule || daySchedule.isClosed) return null;
  return { open: daySchedule.open, close: daySchedule.close };
}

/**
 * Check if a time falls within any break
 */
function isInBreak(minutes, breakTimes, dayOfWeek) {
  if (!breakTimes || breakTimes.length === 0) return false;
  for (const bt of breakTimes) {
    const btDay = bt.dayOfWeek;
    if (btDay !== undefined && btDay !== null && btDay !== dayOfWeek) continue;
    const start = timeToMinutes(bt.start);
    const end = timeToMinutes(bt.end);
    if (minutes >= start && minutes < end) return true;
  }
  return false;
}

/**
 * Generate all possible slot start times between open and close
 * @param {string} open "HH:mm"
 * @param {string} close "HH:mm"
 * @param {number} durationMinutes
 * @param {array} breakTimes
 * @param {number} dayOfWeek
 * @returns {string[]} array of "HH:mm"
 */
function generateSlotsInRange(open, close, durationMinutes, breakTimes, dayOfWeek) {
  const openMin = timeToMinutes(open);
  const closeMin = timeToMinutes(close);
  const slots = [];

  for (let start = openMin; start + durationMinutes <= closeMin; start += SLOT_INTERVAL_MINUTES) {
    const end = start + durationMinutes;
    // slot must not overlap with break
    const slotInBreak =
      isInBreak(start, breakTimes, dayOfWeek) ||
      isInBreak(end - 1, breakTimes, dayOfWeek);
    if (slotInBreak) continue;
    slots.push(minutesToTime(start));
  }
  return slots;
}

/**
 * Filter out slots that overlap with existing reservations
 * @param {string[]} slots array of "HH:mm"
 * @param {array} reservations existing reservations for that day (and optionally staff)
 * @param {number} durationMinutes
 */
function excludeBookedSlots(slots, reservations, durationMinutes) {
  const bookedRanges = reservations.map((r) => ({
    start: timeToMinutes(r.time),
    end: timeToMinutes(r.endTime),
  }));

  return slots.filter((slotStr) => {
    const slotStart = timeToMinutes(slotStr);
    const slotEnd = slotStart + durationMinutes;
    const overlaps = bookedRanges.some(
      (range) => slotStart < range.end && slotEnd > range.start
    );
    return !overlaps;
  });
}

/**
 * Main: get available time slots for a business + service + date (+ optional staffId)
 * @param {object} business - Business doc with workingHours, breakTimes
 * @param {number} durationMinutes - from service
 * @param {Date} date - the day to get slots for
 * @param {array} existingReservations - reservations for that day (and staff if filtered)
 * @param {object} staff - optional Staff doc with workingHours override
 * @returns {string[]} available slot times "HH:mm"
 */
function getAvailableSlots(business, durationMinutes, date, existingReservations, staff = null) {
  const d = new Date(date);
  // Reservation `date` is stored at UTC noon for a calendar day — use UTC weekday
  const dayOfWeek = d.getUTCDay(); // 0 = Sunday

  const workingHours = staff?.workingHours?.length
    ? staff.workingHours
    : business.workingHours;
  const breakTimes = business.breakTimes || [];

  const daySchedule = getWorkingHoursForDay(dayOfWeek, workingHours);
  if (!daySchedule) return [];

  const allSlots = generateSlotsInRange(
    daySchedule.open,
    daySchedule.close,
    durationMinutes,
    breakTimes,
    dayOfWeek
  );

  return excludeBookedSlots(allSlots, existingReservations || [], durationMinutes);
}

module.exports = {
  timeToMinutes,
  minutesToTime,
  getWorkingHoursForDay,
  isInBreak,
  generateSlotsInRange,
  excludeBookedSlots,
  getAvailableSlots,
};
