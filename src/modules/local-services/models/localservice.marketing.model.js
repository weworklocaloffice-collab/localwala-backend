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

const packageSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    placement: { type: String, required: true, enum: ['home', 'search', 'category'] },
    targetingLevel: { type: String, required: true, enum: ['locality', 'pincode', 'city'] },
    durationHours: { type: Number, required: true, enum: [1, 3, 6, 12, 24, 168, 720] },
    price: moneyField(0),
    maxConcurrent: { type: Number, required: false, default: 1, min: 1, max: 20 },
    status: { type: Boolean, required: false, default: true },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    updatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  },
  { timestamps: true, toJSON: { getters: true } }
);

packageSchema.plugin(toJSON);
packageSchema.plugin(paginate);
packageSchema.index({ status: 1, placement: 1, targetingLevel: 1, durationHours: 1 });

const LocalServiceMarketingPackage = mongoose.model('LocalServiceMarketingPackage', packageSchema);

const campaignSchema = mongoose.Schema(
  {
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true },
    package: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceMarketingPackage', required: true },
    caption: { type: String, required: true, trim: true, maxlength: 100 },
    packageSnapshot: {
      name: { type: String, required: true },
      code: { type: String, required: true },
      placement: { type: String, required: true },
      targetingLevel: { type: String, required: true },
      durationHours: { type: Number, required: true },
      price: moneyField(0),
    },
    city: { type: String, required: false, trim: true },
    targetLocalities: { type: [String], required: false, default: [] },
    targetPincodes: { type: [String], required: false, default: [] },
    categoryKey: { type: String, required: false, trim: true, lowercase: true },
    service: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceService', required: false },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    amount: moneyField(0),
    paymentStatus: {
      type: String,
      required: true,
      enum: ['unpaid', 'initiated', 'paid', 'refunded'],
      default: 'unpaid',
    },
    paymentInitiation: { type: mongoose.SchemaTypes.ObjectId, ref: 'PaymentInitiation', required: false },
    paidAt: { type: Date, required: false },
    status: {
      type: String,
      required: true,
      enum: ['pending_review', 'rejected', 'approved_unpaid', 'scheduled', 'live', 'paused', 'completed', 'cancelled'],
      default: 'pending_review',
    },
    approval: {
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      at: { type: Date, required: false },
      note: { type: String, trim: true, maxlength: 500, default: '' },
    },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, toJSON: { getters: true } }
);

campaignSchema.plugin(toJSON);
campaignSchema.plugin(paginate);
campaignSchema.index({ provider: 1, createdAt: -1 });
campaignSchema.index({ status: 1, startsAt: 1, endsAt: 1, targetLocalities: 1, targetPincodes: 1 });
campaignSchema.index({ package: 1, status: 1, startsAt: 1, endsAt: 1 });

const LocalServiceMarketingCampaign = mongoose.model('LocalServiceMarketingCampaign', campaignSchema);

const eventSchema = mongoose.Schema(
  {
    campaign: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceMarketingCampaign', required: true },
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceProvider', required: true },
    user: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    locality: { type: String, required: false, trim: true },
    pincode: { type: String, required: false, trim: true },
    type: { type: String, enum: ['impression', 'click'], required: true },
    day: { type: Date, required: true },
  },
  { timestamps: true }
);

eventSchema.plugin(toJSON);
eventSchema.index({ campaign: 1, user: 1, type: 1, day: 1 }, { unique: true });
eventSchema.index({ campaign: 1, type: 1, createdAt: -1 });

const LocalServiceMarketingEvent = mongoose.model('LocalServiceMarketingEvent', eventSchema);

module.exports = {
  LocalServiceMarketingPackage,
  LocalServiceMarketingCampaign,
  LocalServiceMarketingEvent,
};
