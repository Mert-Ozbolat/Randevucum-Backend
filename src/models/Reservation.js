const mongoose = require('mongoose');
const { RESERVATION_STATUS } = require('../config/constants');

const reservationSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service',
      required: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      default: null,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    }, // reservation date (day)
    time: {
      type: String,
      required: true,
    }, // start time e.g. "14:00"
    durationMinutes: {
      type: Number,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    }, // calculated end time e.g. "14:30"
    status: {
      type: String,
      enum: Object.values(RESERVATION_STATUS),
      default: RESERVATION_STATUS.PENDING,
    },
    notes: {
      type: String,
      trim: true,
    },
    canceledAt: {
      type: Date,
      default: null,
    },
    canceledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reminders: {
      /** WhatsApp reminder to customer (end-user) */
      customerWhatsAppSentAt: { type: Date, default: null },
      /** WhatsApp reminder to business owner / business phone */
      businessWhatsAppSentAt: { type: Date, default: null },
      /** Randevu oluşturulunca müşteriye onay mesajı */
      customerWhatsAppBookingSentAt: { type: Date, default: null },
      /** Randevu oluşturulunca işletmeye yeni randevu mesajı */
      businessWhatsAppBookingSentAt: { type: Date, default: null },
      /** Yaklaşan randevu sorusu: müşteri yanıtı (onay/iptal) */
      customerRsvp: { type: String, enum: ['confirmed', 'canceled'], default: null },
      customerRsvpAt: { type: Date, default: null },
      /** İptal 2-aşama: müşteri önce IPTAL <kod> der, sonra IPTAL-ONAY <kod> ile kesinleştirir */
      cancelConfirmPendingAt: { type: Date, default: null },
      /** İşletmeye müşteri yanıtı bildirimi atıldı mı */
      businessRsvpNotifiedAt: { type: Date, default: null },
      /** Last error message (debug) */
      lastError: { type: String, trim: true, default: '' },
    },
  },
  {
    timestamps: true,
  }
);

reservationSchema.index({ businessId: 1, date: 1, time: 1 });
reservationSchema.index({ customerId: 1 });
reservationSchema.index({ staffId: 1, date: 1 });
reservationSchema.index({ businessId: 1, status: 1 });
reservationSchema.index({ date: 1, time: 1, status: 1 });

module.exports = mongoose.model('Reservation', reservationSchema);
