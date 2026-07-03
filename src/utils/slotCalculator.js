/**
 * Calculates available time slots for a given business, service, date and optional staff.
 * Prevents double booking by excluding existing reservations (respecting service duration).
 */

const { SLOT_INTERVAL_MINUTES } = require('../config/constants');
const { isBusinessClosedOnDate, isStaffOnLeave } = require('./availabilityExceptions');

/**
 * Parse "HH:mm" to minutes since midnight
 */
function timeToMinutes(timeStr) {
  const normalized = normalizeTimeStr(timeStr);
  const [h, m] = normalized.split(':').map(Number);
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

function normalizeTimeStr(timeStr) {
  if (!timeStr) return '00:00';
  const parts = String(timeStr).trim().split(':');
  const h = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getReservationEndMinutes(reservation) {
  const rStart = timeToMinutes(reservation.time);
  if (reservation.endTime) {
    const end = timeToMinutes(reservation.endTime);
    if (end > rStart) return end;
  }
  const dur = Math.max(1, parseInt(reservation.durationMinutes, 10) || SLOT_INTERVAL_MINUTES);
  return rStart + dur;
}

function clampConcurrentLimit(value, fallback = 2) {
  return Math.min(50, Math.max(2, parseInt(String(value), 10) || fallback));
}

/**
 * Personel için eşzamanlı randevu üst sınırı (null = personel seçilmedi).
 * allowConcurrentBookings: null → işletme ayarını kullan
 */
function getStaffConcurrentLimit(business, staff) {
  if (!staff) return null;
  if (staff.allowConcurrentBookings === false) return 1;
  if (staff.allowConcurrentBookings === true) {
    return clampConcurrentLimit(
      staff.concurrentBookingLimit ?? business?.concurrentBookingLimit ?? 2
    );
  }
  if (business?.allowConcurrentBookings) {
    return clampConcurrentLimit(business.concurrentBookingLimit ?? 2);
  }
  return 1;
}

/**
 * Get working hours for a day (from business or staff override)
 */
function getWorkingHoursForDay(dayOfWeek, workingHours) {
  if (!workingHours || workingHours.length === 0) return null;
  const daySchedule = workingHours.find((wh) => wh.dayOfWeek === dayOfWeek);
  if (!daySchedule || daySchedule.isClosed) return null;
  return { open: daySchedule.open, close: daySchedule.close };
}

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
 * Slot başlangıçları: hizmet süresine göre (30 dk hizmet → 9:00, 9:30, 10:00…)
 */
function generateSlotsInRange(open, close, durationMinutes, breakTimes, dayOfWeek) {
  const openMin = timeToMinutes(open);
  const closeMin = timeToMinutes(close);
  const step = Math.max(SLOT_INTERVAL_MINUTES, durationMinutes);
  const slots = [];

  for (let start = openMin; start + durationMinutes <= closeMin; start += step) {
    const end = start + durationMinutes;
    const slotInBreak =
      isInBreak(start, breakTimes, dayOfWeek) || isInBreak(end - 1, breakTimes, dayOfWeek);
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
  const rEnd = getReservationEndMinutes(reservation);
  return slotStart < rEnd && slotEnd > rStart;
}

function findOverlappingReservations(reservations, slotStartStr, durationMinutes) {
  return (reservations || []).filter((r) =>
    reservationOverlapsSlot(r, slotStartStr, durationMinutes)
  );
}

/**
 * Kapasite + isteğe bağlı personel: aynı dilimde en fazla `capacity` randevu;
 * belirli personel seçiliyse personelin eşzamanlı limiti uygulanır.
 */
function filterSlotsByOccupancy(
  slots,
  reservations,
  durationMinutes,
  capacity,
  selectedStaffId,
  staffConcurrentLimit = null
) {
  const cap = Math.max(1, capacity || 1);
  const sid = selectedStaffId ? String(selectedStaffId) : null;

  return slots.filter((slotStr) => {
    const overlapping = findOverlappingReservations(reservations, slotStr, durationMinutes);
    if (overlapping.length >= cap) return false;
    if (sid) {
      const staffOverlapping = overlapping.filter(
        (r) => r.staffId && String(r.staffId) === sid
      );
      const staffCap = staffConcurrentLimit ?? 1;
      if (staffOverlapping.length >= staffCap) return false;
    }
    return true;
  });
}

function excludeBookedSlots(slots, reservations, durationMinutes) {
  return filterSlotsByOccupancy(slots, reservations, durationMinutes, 1, null, 1);
}

function getAvailableSlots(
  business,
  durationMinutes,
  date,
  existingReservations,
  staff = null,
  options = {}
) {
  const { capacity = 1, selectedStaffId = null, staffConcurrentLimit = null } = options;
  const d = new Date(date);
  const dayOfWeek = d.getUTCDay();

  if (isBusinessClosedOnDate(business, d)) return [];
  if (staff && isStaffOnLeave(staff, d)) return [];

  const workingHours = staff?.workingHours?.length ? staff.workingHours : business.workingHours;
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

  const effectiveStaffLimit =
    staffConcurrentLimit ?? (staff ? getStaffConcurrentLimit(business, staff) : null);

  return filterSlotsByOccupancy(
    allSlots,
    existingReservations || [],
    durationMinutes,
    capacity,
    selectedStaffId,
    effectiveStaffLimit
  );
}

module.exports = {
  timeToMinutes,
  minutesToTime,
  normalizeTimeStr,
  getReservationEndMinutes,
  getStaffConcurrentLimit,
  getWorkingHoursForDay,
  isInBreak,
  generateSlotsInRange,
  excludeBookedSlots,
  reservationOverlapsSlot,
  findOverlappingReservations,
  filterSlotsByOccupancy,
  getAvailableSlots,
};
