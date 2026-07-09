const User = require('../models/User');
const { reservationDayToStoredDate } = require('./calendarDate');
const { ATTENDANCE_OUTCOME } = require('../config/constants');

function timeToMinutes(t) {
  const [hh, mm] = String(t || '00:00').split(':');
  return (Number(hh) || 0) * 60 + (Number(mm) || 0);
}

function reservationEndAt(reservation) {
  const raw = reservation?.date;
  if (!raw) return null;
  const stored = raw instanceof Date ? raw : reservationDayToStoredDate(String(raw));
  if (!stored || Number.isNaN(stored.getTime())) return null;
  const y = stored.getUTCFullYear();
  const mo = stored.getUTCMonth();
  const d = stored.getUTCDate();
  const endMin = timeToMinutes(reservation.endTime || reservation.time);
  const dt = new Date(y, mo, d);
  dt.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
  return dt;
}

function isReservationPastEnd(reservation, now = new Date()) {
  const end = reservationEndAt(reservation);
  if (!end) return false;
  return end.getTime() < now.getTime();
}

function defaultAttendanceStats() {
  return {
    totalMarked: 0,
    attendedCount: 0,
    noShowCount: 0,
    attendanceRate: 100,
    warningCount: 0,
    lastWarningAt: null,
    lastNoShowAt: null,
  };
}

function computeAttendanceRate(attendedCount, noShowCount) {
  const total = attendedCount + noShowCount;
  if (total === 0) return 100;
  return Math.round((attendedCount / total) * 100);
}

/**
 * Müşteri katılım istatistiklerini güncelle.
 * previousOutcome: önceki işaretleme (null = ilk kez)
 */
async function updateCustomerAttendanceStats(customerId, previousOutcome, newOutcome) {
  const user = await User.findById(customerId);
  if (!user) return null;

  if (!user.attendanceStats) {
    user.attendanceStats = defaultAttendanceStats();
  }

  const stats = user.attendanceStats;

  if (previousOutcome === ATTENDANCE_OUTCOME.ATTENDED) {
    stats.attendedCount = Math.max(0, (stats.attendedCount || 0) - 1);
  } else if (previousOutcome === ATTENDANCE_OUTCOME.NO_SHOW) {
    stats.noShowCount = Math.max(0, (stats.noShowCount || 0) - 1);
  }

  if (newOutcome === ATTENDANCE_OUTCOME.ATTENDED) {
    stats.attendedCount = (stats.attendedCount || 0) + 1;
  } else if (newOutcome === ATTENDANCE_OUTCOME.NO_SHOW) {
    stats.noShowCount = (stats.noShowCount || 0) + 1;
    if (previousOutcome !== ATTENDANCE_OUTCOME.NO_SHOW) {
      stats.warningCount = (stats.warningCount || 0) + 1;
      stats.lastWarningAt = new Date();
      stats.lastNoShowAt = new Date();
    }
  }

  const total = (stats.attendedCount || 0) + (stats.noShowCount || 0);
  stats.totalMarked = total;
  stats.attendanceRate = computeAttendanceRate(stats.attendedCount || 0, stats.noShowCount || 0);

  await user.save();
  return stats;
}

/** Uyarı seviyesi: none | warning | critical */
function getAttendanceWarningLevel(stats) {
  if (!stats || (stats.totalMarked || 0) < 1) return 'none';
  const rate = stats.attendanceRate ?? 100;
  const noShows = stats.noShowCount || 0;
  const total = stats.totalMarked || 0;

  if (total >= 3 && rate < 50) return 'critical';
  if (noShows >= 2 && rate < 70) return 'warning';
  if (total >= 2 && rate < 60) return 'warning';
  return 'none';
}

function getAttendanceWarningMessage(stats) {
  const level = getAttendanceWarningLevel(stats);
  if (level === 'none') return null;

  const rate = stats.attendanceRate ?? 100;
  const noShows = stats.noShowCount || 0;

  if (level === 'critical') {
    return `Randevularınıza katılım oranınız %${rate} (${noShows} kez gelmediniz). Gelecekteki randevularınız iptal edilebilir. Lütfen randevularınıza zamanında gelin veya önceden iptal edin.`;
  }
  return `Randevularınıza katılım oranınız %${rate}. Randevunuza gelemeyecekseniz lütfen önceden iptal edin.`;
}

module.exports = {
  reservationEndAt,
  isReservationPastEnd,
  updateCustomerAttendanceStats,
  computeAttendanceRate,
  getAttendanceWarningLevel,
  getAttendanceWarningMessage,
  defaultAttendanceStats,
};
