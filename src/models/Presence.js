const mongoose = require('mongoose');

/**
 * Anonim oturum veya giriş yapmış kullanıcı için son aktivite (ana sayfa “aktif kullanıcı”).
 * lastPing güncellenir; TTL ile eski kayıtlar temizlenir.
 */
const presenceSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 64,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    lastPing: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

/** Eski oturum kayıtlarını temizlemek için TTL (lastPing’ten 15 dk sonra) */
presenceSchema.index({ lastPing: 1 }, { expireAfterSeconds: 900 });

module.exports = mongoose.model('Presence', presenceSchema);
