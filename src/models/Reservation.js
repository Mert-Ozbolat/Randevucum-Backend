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
  },
  {
    timestamps: true,
  }
);

reservationSchema.index({ businessId: 1, date: 1, time: 1 });
reservationSchema.index({ customerId: 1 });
reservationSchema.index({ staffId: 1, date: 1 });
reservationSchema.index({ businessId: 1, status: 1 });

module.exports = mongoose.model('Reservation', reservationSchema);
