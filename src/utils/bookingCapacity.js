/**
 * Aynı saat diliminde kaç randevu alınabileceğini hesaplar.
 * Varsayılan: personel sayısı (en az 1). İşletme açarsa üst sınır artırılabilir.
 */

function getSlotCapacity(business, eligibleStaffCount) {
  const staffCap = Math.max(1, eligibleStaffCount || 0);
  if (!business?.allowConcurrentBookings) {
    return staffCap;
  }
  const limit = Math.min(
    50,
    Math.max(2, parseInt(String(business.concurrentBookingLimit), 10) || 2)
  );
  return Math.max(staffCap, limit);
}

module.exports = {
  getSlotCapacity,
};
