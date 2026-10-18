/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const storeCustomerSubscriptionSchema = mongoose.Schema(
  {
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    plan: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreRecurringPlan',
    },
    items: [{
      _id: false,
      variant: { type: mongoose.SchemaTypes.ObjectId, ref: 'ChainProductVariant', required: true },
      quantity: { type: Number, required: true, min: 1 },
      name: String,
      unitPriceAtSubscribe: Number,
    }],
    cadence: {
      type: String,
      required: true,
      enum: ['weekly', 'biweekly', 'monthly', 'custom'],
    },
    intervalCount: {
      type: Number,
      default: 1,
    },
    deliveryDayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6,
    },
    deliverySlot: {
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
    },
    address: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserAddress',
    },
    discountPercentage: {
      type: Number,
      default: 0,
    },
    substitutionPolicy: {
      type: String,
      default: 'none',
      enum: ['none', 'same_category', 'same_brand', 'store_choice'],
    },
    priceLockPolicy: {
      type: String,
      default: 'notify_and_confirm',
      enum: ['notify_and_confirm', 'charge_current_price'],
    },
    status: {
      type: String,
      default: 'scheduled',
      enum: ['scheduled', 'paused', 'skipped', 'payment_failed', 'cancelled', 'completed', 'failed'],
    },
    startDate: {
      type: Date,
      required: true,
    },
    nextOccurrenceDate: {
      type: Date,
      required: true,
    },
    lastOccurrenceDate: {
      type: Date,
    },
    editCutoffHours: {
      type: Number,
      default: 2,
    },
    skipDates: [{ type: Date }],
    endDate: Date,
    cancelledAt: Date,
    cancelReason: String,
    failureStreak: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

storeCustomerSubscriptionSchema.plugin(toJSON);
storeCustomerSubscriptionSchema.plugin(paginate);

storeCustomerSubscriptionSchema.index({ outlet: 1, status: 1, nextOccurrenceDate: 1 });
storeCustomerSubscriptionSchema.index({ customer: 1, status: 1 });
storeCustomerSubscriptionSchema.index({ nextOccurrenceDate: 1 }, { partialFilterExpression: { status: 'scheduled' } });

storeCustomerSubscriptionSchema.statics.findDueForGeneration = async function () {
  return this.find({
    status: 'scheduled',
    nextOccurrenceDate: { $lte: new Date() },
  });
};

storeCustomerSubscriptionSchema.statics.findByCustomer = async function (customerId) {
  return this.find({ customer: customerId }).sort({ createdAt: -1 });
};

storeCustomerSubscriptionSchema.statics.findByOutlet = async function (outletId) {
  return this.find({ outlet: outletId, status: 'scheduled' });
};

module.exports = mongoose.model('StoreCustomerSubscription', storeCustomerSubscriptionSchema);