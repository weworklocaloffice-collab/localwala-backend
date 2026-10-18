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

const storeSubscriptionPlanSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    billingPeriod: {
      type: String,
      enum: ['monthly', 'quarterly', 'yearly'],
      default: 'monthly',
    },
    trialDays: {
      type: Number,
      default: 0,
    },
    features: {
      type: [String],
      default: [],
    },
    maxOutlets: {
      type: Number,
      default: 1,
    },
    maxProducts: {
      type: Number,
      default: 100,
    },
    maxStaff: {
      type: Number,
      default: 5,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      default: 'active',
      enum: ['active', 'inactive', 'archived'],
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

storeSubscriptionPlanSchema.plugin(toJSON);
storeSubscriptionPlanSchema.plugin(paginate);

storeSubscriptionPlanSchema.index({ slug: 1 }, { unique: true });
storeSubscriptionPlanSchema.index({ status: 1, sortOrder: 1 });

storeSubscriptionPlanSchema.statics.findActive = async function () {
  return this.find({ status: 'active' }).sort({ sortOrder: 1 });
};

storeSubscriptionPlanSchema.statics.findDefault = async function () {
  return this.findOne({ isDefault: true, status: 'active' });
};

module.exports = mongoose.model('StoreSubscriptionPlan', storeSubscriptionPlanSchema);