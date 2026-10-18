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
const { toJSON, paginate } = require('./plugins');

const diningSettingSchema = mongoose.Schema(
  {
    restaurantCanCancelRequest: {
      type: Boolean,
      default: false,
    },
    restaurantCanAddOffers: {
      type: Boolean,
      default: false,
    },
    preBookingChargeRequired: {
      type: Boolean,
      default: false,
    },
    guestBooking: {
      type: Boolean,
      required: false,
    },
    commissionPreBooking: {
      type: Number,
      required: true,
      default: 10, // 10
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    minBookingCharge: {
      type: Number,
      required: true,
      default: 100, // 10
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
diningSettingSchema.plugin(toJSON);
diningSettingSchema.plugin(paginate);

/**
 * @typedef DiningSetting
 */
const DiningSetting = mongoose.model('DiningSetting', diningSettingSchema);

module.exports = DiningSetting;

