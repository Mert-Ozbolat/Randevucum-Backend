const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
  },
  { timestamps: true }
);

// Her kullanıcı aynı işletmeye sadece bir yorum bırakabilsin.
reviewSchema.index({ businessId: 1, customerId: 1 }, { unique: true });
reviewSchema.index({ businessId: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);

