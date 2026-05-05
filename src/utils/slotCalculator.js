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
 * Whether a reservation overlaps [slotStart, slotStart + duration)
 */
function reservationOverlapsSlot(reservation, slotStartStr, durationMinutes) {
  const slotStart = timeToMinutes(slotStartStr);
  const slotEnd = slotStart + durationMinutes;
  const rStart = timeToMinutes(reservation.time);
  const rEnd = timeToMinutes(reservation.endTime);
  return slotStart < rEnd && slotEnd > rStart;
}

/**
 * Kapasite + isteğe bağlı personel: aynı dilimde en fazla `capacity` randevu;
 * belirli personel seçiliyse o personelin aynı saatte ikinci randevusu engellenir.
 */
function filterSlotsByOccupancy(slots, reservations, durationMinutes, capacity, selectedStaffId) {
  const cap = Math.max(1, capacity || 1);
  const sid = selectedStaffId ? String(selectedStaffId) : null;

  return slots.filter((slotStr) => {
    const overlapping = (reservations || []).filter((r) =>
      reservationOverlapsSlot(r, slotStr, durationMinutes)
    );
    if (overlapping.length >= cap) return false;
    if (sid) {
      const sameStaffTaken = overlapping.some(
        (r) => r.staffId && String(r.staffId) === sid
      );
      if (sameStaffTaken) return false;
    }
    return true;
  });
}

/**
 * @deprecated Teklı takvim için — filterSlotsByOccupancy(capacity=1) ile aynı
 */
function excludeBookedSlots(slots, reservations, durationMinutes) {
  return filterSlotsByOccupancy(slots, reservations, durationMinutes, 1, null);
}

/**
 * Main: get available time slots for a business + service + date (+ optional staffId)
 * @param {object} business - Business doc with workingHours, breakTimes
 * @param {number} durationMinutes - from service
 * @param {Date} date - the day to get slots for
 * @param {array} existingReservations - o günün tüm randevuları (personel filtresi olmadan)
 * @param {object} staff - optional Staff doc with workingHours override
 * @param {{ capacity?: number, selectedStaffId?: string|null }} options capacity = eşzamanlı üst sınır
 * @returns {string[]} available slot times "HH:mm"
 */
function getAvailableSlots(
  business,
  durationMinutes,
  date,
  existingReservations,
  staff = null,
  options = {}
) {
  const { capacity = 1, selectedStaffId = null } = options;
  const d = new Date(date);
  const dayOfWeek = d.getUTCDay();

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

  return filterSlotsByOccupancy(
    allSlots,
    existingReservations || [],
    durationMinutes,
    capacity,
    selectedStaffId
  );
}

module.exports = {
  timeToMinutes,
  minutesToTime,
  getWorkingHoursForDay,
  isInBreak,
  generateSlotsInRange,
  excludeBookedSlots,
  reservationOverlapsSlot,
  filterSlotsByOccupancy,
  getAvailableSlots,
};
