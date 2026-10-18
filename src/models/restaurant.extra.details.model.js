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
const { toJSON } = require('./plugins');

const restaurantExtraDetailSchema = mongoose.Schema(
  {
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    guestAvailability: {
      type: [Number],
      default: [],
    },
    slots: {
      type: Array,
      default: [],
    },
    photos: {
      type: [String],
      default: [],
    },
    menu: {
      type: Array,
      default: [],
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
restaurantExtraDetailSchema.plugin(toJSON);

/**
 * @typedef RestaurantExtraDetail
 */
const RestaurantExtraDetail = mongoose.model('RestaurantExtraDetail', restaurantExtraDetailSchema);

module.exports = RestaurantExtraDetail;

