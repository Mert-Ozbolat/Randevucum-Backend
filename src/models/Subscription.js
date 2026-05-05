const mongoose = require('mongoose');
const { SUBSCRIPTION_STATUS } = require('../config/constants');

const subscriptionSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.ACTIVE,
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endDate: {
      type: Date,
      required: true,
    },
    canceledAt: {
      type: Date,
      default: null,
    },
    /** Stripe Billing — set by webhook after successful Checkout */
    stripeCustomerId: { type: String, trim: true },
    stripeSubscriptionId: { type: String, trim: true },
  },
  {
    timestamps: true,
  }
);

subscriptionSchema.index({ businessId: 1 });
subscriptionSchema.index({ endDate: 1, status: 1 });
subscriptionSchema.index({ stripeSubscriptionId: 1 }, { unique: true, sparse: true });

subscriptionSchema.virtual('isActive').get(function () {
  if (this.status !== SUBSCRIPTION_STATUS.ACTIVE) return false;
  return new Date() <= this.endDate;
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
