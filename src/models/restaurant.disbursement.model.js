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

const restaurantDisbursementSchema = mongoose.Schema(
  {
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    disbursementId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DisbursementData',
      required: true,
    },
    restaurantPayoutMethod: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RestaurantPayoutMethod',
      required: false,
    },
    withdrawalMethod: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'WithdrawalMethod',
      required: false,
    },
    amount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    status: {
      type: String,
      default: 'created', // created, accepted, rejected
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
restaurantDisbursementSchema.plugin(toJSON);
restaurantDisbursementSchema.plugin(paginate);

/**
 * @typedef RestaurantDisbursement
 */
const RestaurantDisbursement = mongoose.model(
  'RestaurantDisbursement',
  restaurantDisbursementSchema
);

module.exports = RestaurantDisbursement;

