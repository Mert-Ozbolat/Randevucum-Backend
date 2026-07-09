const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES } = require('../config/constants');
const { normalizePhoneForDatabase } = require('../utils/phone');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      minlength: 6,
      select: false,
    },
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    /** Profil fotoğrafı (ImageKit veya HTTPS URL) */
    avatarUrl: {
      type: String,
      trim: true,
      default: '',
    },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.CUSTOMER,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    /** Randevuya gelme istatistikleri (işletmeler tarafından işaretlenir) */
    attendanceStats: {
      totalMarked: { type: Number, default: 0 },
      attendedCount: { type: Number, default: 0 },
      noShowCount: { type: Number, default: 0 },
      /** Katılım yüzdesi 0–100 */
      attendanceRate: { type: Number, default: 100 },
      warningCount: { type: Number, default: 0 },
      lastWarningAt: { type: Date, default: null },
      lastNoShowAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

userSchema.pre('save', async function (next) {
  if (this.isModified('phone')) {
    const trimmed = String(this.phone ?? '').trim();
    if (!trimmed) {
      this.phone = undefined;
    } else {
      const e164 = normalizePhoneForDatabase(trimmed);
      if (!e164) {
        return next(new Error('Geçersiz telefon numarası.'));
      }
      this.phone = e164;
    }
  }
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

module.exports = mongoose.model('User', userSchema);
