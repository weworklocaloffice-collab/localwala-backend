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

/**
 * RealEstatePropertyDailyStat — per-day counters for one property.
 *
 * Rolled up by cron from the denormalised counters on the property.
 * Beyond counters + rollups is deferred (F-19); this is the shape
 * analytics reads so the hot property row is never scanned.
 */
const realEstatePropertyDailyStatSchema = mongoose.Schema(
  {
    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    day: {
      type: Date,
      required: true,
    },

    views: { type: Number, default: 0, min: 0 },
    enquiries: { type: Number, default: 0, min: 0 },
    leads: { type: Number, default: 0, min: 0 },
    visits: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstatePropertyDailyStatSchema.plugin(toJSON);
realEstatePropertyDailyStatSchema.plugin(paginate);

realEstatePropertyDailyStatSchema.index({ property: 1, day: 1 }, { unique: true });

/**
 * @typedef RealEstatePropertyDailyStat
 */
const RealEstatePropertyDailyStat = mongoose.model(
  'RealEstatePropertyDailyStat',
  realEstatePropertyDailyStatSchema
);

module.exports = RealEstatePropertyDailyStat;
