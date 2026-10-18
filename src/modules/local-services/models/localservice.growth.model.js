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
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');
const moneyField = require('../../../utils/money.field');

const planSchema = mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    price: moneyField(0),
    interval: { type: String, required: true, enum: ['monthly', 'yearly'], default: 'monthly' },
    entitlements: { type: [String], required: false, default: [] },
    status: { type: String, required: true, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true, toJSON: { getters: true } }
);
planSchema.plugin(toJSON);
planSchema.plugin(paginate);
planSchema.index({ code: 1 }, { unique: true });
const LocalServiceSubscriptionPlan = mongoose.model('LocalServiceSubscriptionPlan', planSchema);

const subscriptionSchema = mongoose.Schema(
  {
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true },
    plan: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceSubscriptionPlan', required: true },
    status: { type: String, required: true, enum: ['active', 'expired', 'cancelled'], default: 'active' },
    startedAt: { type: Date, required: true, default: Date.now },
    renewAt: { type: Date, required: true },
    cancelledAt: { type: Date, required: false },
  },
  { timestamps: true, toJSON: { getters: true } }
);
subscriptionSchema.plugin(toJSON);
subscriptionSchema.plugin(paginate);
subscriptionSchema.index({ provider: 1, status: 1 });
const LocalServiceSubscription = mongoose.model('LocalServiceSubscription', subscriptionSchema);

const featuredSchema = mongoose.Schema(
  {
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: false },
    service: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceService', required: false },
    placement: { type: String, required: true, enum: ['home', 'search', 'category'], default: 'search' },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    price: moneyField(0),
    status: { type: String, required: true, enum: ['scheduled', 'active', 'expired', 'cancelled'], default: 'scheduled' },
  },
  { timestamps: true, toJSON: { getters: true } }
);
featuredSchema.plugin(toJSON);
featuredSchema.plugin(paginate);
featuredSchema.index({ status: 1, from: 1, to: 1 });
const LocalServiceFeaturedPlacement = mongoose.model('LocalServiceFeaturedPlacement', featuredSchema);

module.exports = { LocalServiceSubscriptionPlan, LocalServiceSubscription, LocalServiceFeaturedPlacement };
