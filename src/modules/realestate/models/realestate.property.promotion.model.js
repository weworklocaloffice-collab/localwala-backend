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

/**
 * RealEstatePropertyPromotion — featured / boosted listing (F-20).
 *
 * Deferred revenue line (blueprint §52 "optional future services").
 * Schema lands now so a later launch is a service + UI, not a
 * migration. Disabled by `RealEstateSetting.promotionsEnabled`
 * until built.
 */
const realEstatePropertyPromotionSchema = mongoose.Schema(
  {
    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    vendor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVendor',
      required: true,
    },

    amount: moneyField(0),

    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },

    status: {
      type: String,
      required: true,
      default: 'PENDING_PAYMENT',
      enum: ['PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED'],
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstatePropertyPromotionSchema.plugin(toJSON);
realEstatePropertyPromotionSchema.plugin(paginate);

realEstatePropertyPromotionSchema.index({ property: 1, status: 1 });
realEstatePropertyPromotionSchema.index({ status: 1, endsAt: 1 });

/**
 * @typedef RealEstatePropertyPromotion
 */
const RealEstatePropertyPromotion = mongoose.model(
  'RealEstatePropertyPromotion',
  realEstatePropertyPromotionSchema
);

module.exports = RealEstatePropertyPromotion;
