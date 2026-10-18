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

const restaurantPosTableOrderCommissionSchema = mongoose.Schema(
  {
    posOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PosOrTableOrder',
      required: false,
    },
    tableOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'TableOrder',
      required: false,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    foodServiceCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    serviceCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    orderCommission: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    totalEarning: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    commission: {
      type: Number,
      required: false,
      default: 0,
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
restaurantPosTableOrderCommissionSchema.plugin(toJSON);
restaurantPosTableOrderCommissionSchema.plugin(paginate);

/**
 * @typedef RestaurantPosTableOrderCommission
 */
const RestaurantPosTableOrderCommission = mongoose.model(
  'RestaurantPosTableOrderCommission',
  restaurantPosTableOrderCommissionSchema
);

module.exports = RestaurantPosTableOrderCommission;

