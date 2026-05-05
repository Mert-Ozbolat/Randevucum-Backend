const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null, // optional: link to User if staff has an account
    },
    name: {
      type: String,
      required: [true, 'Staff name is required'],
      trim: true,
    },
    title: {
      type: String,
      trim: true, // e.g. "Senior Stylist", "Dentist"
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    /** Profil fotoğrafı (ImageKit veya tam URL) */
    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    serviceIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
      },
    ], // services this staff can perform
    workingHours: [
      {
        dayOfWeek: { type: Number, min: 0, max: 6 },
        open: String,
        close: String,
        isClosed: { type: Boolean, default: false },
      },
    ], // optional override per staff
    isActive: {
      type: Boolean,
      default: true,
    },
    /** Giriş yapmış hesap (userId) kendi atandığı randevuları görebilsin */
    canViewOwnReservations: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

staffSchema.index({ businessId: 1 });
staffSchema.index({ businessId: 1, isActive: 1 });
staffSchema.index({ userId: 1 }, { sparse: true });

module.exports = mongoose.model('Staff', staffSchema);
