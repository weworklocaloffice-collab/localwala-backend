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
const { toJSON, slugGenerator, paginate } = require('./plugins');

const citySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: true,
    },
    location: {
      type: {
        type: String, // Don't do `{ location: { type: String } }`
        enum: ['Point'], // 'location.type' must be 'Point'
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    slug: {
      type: 'String',
      source: 'name',
      unique: true,
    },
    translations: {
      type: Array,
      default: [],
    },
    status: {
      type: Boolean,
      default: true,
    },
    // City default delivery radius, in metres (food dispatch policy layer).
    // Purely additive and optional: when absent, restaurants in this city fall
    // back to the platform-wide `BusinessSettings.deliveryArea`, exactly as
    // before. A per-restaurant `deliveryConfig.deliveryRadiusMeters` still
    // wins over this. Never repurpose `BusinessSettings.deliveryArea`.
    defaultDeliveryRadiusMeters: {
      type: Number,
      required: false,
      default: null,
    },
    // Max diameter of an auto-clustered delivery zone, in kilometres.
    // Optional: when absent the clustering default (8 km) applies. One value
    // per city — Hyderabad and a small town must not share a cap.
    maxZoneDiameterKm: {
      type: Number,
      required: false,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
citySchema.plugin(toJSON);
citySchema.plugin(slugGenerator);
citySchema.plugin(paginate);
citySchema.index({ location: '2dsphere' });

citySchema.statics.isNameTaken = async function (name, excludeCityId) {
  const city = await this.findOne({ name, _id: { $ne: excludeCityId } });
  return !!city;
};

/**
 * @typedef City
 */
const City = mongoose.model('City', citySchema);

module.exports = City;

