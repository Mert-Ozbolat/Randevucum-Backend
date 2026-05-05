const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Service name is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    durationMinutes: {
      type: Number,
      required: [true, 'Duration is required'],
      min: [5, 'Duration must be at least 5 minutes'],
      max: [480, 'Duration cannot exceed 8 hours'],
    },
    /** @deprecated Yeni kayıtlarda priceMin / priceMax kullanın */
    price: {
      type: Number,
      min: 0,
      default: null,
    },
    /** Fiyat aralığı alt sınır (TRY vb.) — işlem göre göre değişebileceği için sabit fiyat yerine */
    priceMin: {
      type: Number,
      min: 0,
      default: null,
    },
    priceMax: {
      type: Number,
      min: 0,
      default: null,
    },
    currency: {
      type: String,
      default: 'TRY',
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    /** Bu hizmeti yapabilecek personel. Boş = personelin kendi serviceIds listesine göre (eski davranış). */
    staffIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Staff',
      },
    ],
  },
  {
    timestamps: true,
  }
);

serviceSchema.index({ businessId: 1 });
serviceSchema.index({ businessId: 1, isActive: 1 });

module.exports = mongoose.model('Service', serviceSchema);
