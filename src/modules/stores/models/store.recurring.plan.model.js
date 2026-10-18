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

const storeRecurringPlanSchema = mongoose.Schema(
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
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    image: {
      type: String,
    },
    items: [{
      _id: false,
      variant: { type: mongoose.SchemaTypes.ObjectId, ref: 'ChainProductVariant', required: true },
      quantity: { type: Number, required: true, min: 1 },
      isSubstitutable: { type: Boolean, default: false },
    }],
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    compareAt: {
      type: Number,
      min: 0,
    },
    discountPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    cadence: {
      type: String,
      required: true,
      enum: ['weekly', 'biweekly', 'monthly'],
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
    serviceLocalities: [{
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Locality',
    }],
    maxSubscribers: {
      type: Number,
      default: 0,
    },
    subscriberCount: {
      type: Number,
      default: 0,
    },
    substitutionPolicy: {
      type: String,
      default: 'none',
      enum: ['none', 'same_category', 'same_brand', 'store_choice'],
    },
    status: {
      type: String,
      default: 'draft',
      enum: ['draft', 'active', 'paused', 'archived'],
    },
  },
  { timestamps: true }
);

storeRecurringPlanSchema.plugin(toJSON);
storeRecurringPlanSchema.plugin(paginate);

storeRecurringPlanSchema.index({ outlet: 1, status: 1 });
storeRecurringPlanSchema.index({ chain: 1, status: 1 });

storeRecurringPlanSchema.statics.findActive = async function (outletId) {
  return this.find({ outlet: outletId, status: 'active' });
};

module.exports = mongoose.model('StoreRecurringPlan', storeRecurringPlanSchema);