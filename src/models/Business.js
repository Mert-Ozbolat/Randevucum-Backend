const mongoose = require('mongoose');
const { BUSINESS_TYPES } = require('../config/constants');

const workingHoursSchema = new mongoose.Schema(
  {
    dayOfWeek: {
      type: Number, // 0 = Sunday, 1 = Monday, ... 6 = Saturday
      required: true,
      min: 0,
      max: 6,
    },
    open: { type: String, required: true }, // e.g. "09:00"
    close: { type: String, required: true }, // e.g. "18:00"
    isClosed: { type: Boolean, default: false },
  },
  { _id: false }
);

const breakTimeSchema = new mongoose.Schema(
  {
    start: { type: String, required: true }, // e.g. "12:00"
    end: { type: String, required: true },   // e.g. "13:00"
    dayOfWeek: { type: Number, min: 0, max: 6 }, // optional: specific day, or null for all days
  },
  { _id: false }
);

const businessSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
    },
    /**
     * UI mantığı: Alan -> Meslek (arama & filtre için)
     * Örnek:
     *  area: "Sağlık"
     *  profession: "Psikolog"
     */
    area: { type: String, trim: true },
    profession: { type: String, trim: true },
    // New UX: ana kategori / alt kategori (arama & filtre için)
    mainCategory: {
      type: String,
      trim: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    businessType: {
      type: String,
      enum: Object.values(BUSINESS_TYPES),
      required: [true, 'Business type is required'],
    },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      district: { type: String, trim: true },
      postalCode: { type: String, trim: true },
    },
    // Kullanıcı haritada pin işaretlediğinde saklanacak konum
    location: {
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
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
    description: {
      type: String,
      trim: true,
    },
    /** Liste / kart görseli (URL veya data URL) */
    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    /**
     * Ana sayfa slider reklamı (ücretli süre: paidUntil).
     * Sadece paidUntil > şimdi ve imageUrl dolu ise herkese açık slider’da gösterilir.
     */
    homeSliderPromo: {
      headline: { type: String, trim: true, default: '', maxlength: 120 },
      subline: { type: String, trim: true, default: '', maxlength: 200 },
      imageUrl: { type: String, trim: true, default: '' },
      paidUntil: { type: Date, default: null },
    },
    workingHours: [workingHoursSchema],
    breakTimes: [breakTimeSchema],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

businessSchema.index({ ownerId: 1 });
businessSchema.index({ businessType: 1 });
businessSchema.index({ mainCategory: 1 });
businessSchema.index({ subCategory: 1 });
businessSchema.index({ area: 1 });
businessSchema.index({ profession: 1 });
businessSchema.index({ 'location.lat': 1 });
businessSchema.index({ 'location.lng': 1 });
businessSchema.index({ isActive: 1 });

module.exports = mongoose.model('Business', businessSchema);
