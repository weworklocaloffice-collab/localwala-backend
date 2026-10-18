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

const loyaltyPointsSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    orderId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Orders',
      required: true,
    },
    coupon: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Coupon',
      required: false,
    },
    loyaltyPointValue: {
      type: Number, // Loyalty Points
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    redeemFrom: {
      type: String,
      required: false,
      default: 'order', // order, coupon
    },
    redeemedToWallet: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
loyaltyPointsSchema.plugin(toJSON);

/**
 * @typedef LoyaltyPoints
 */
const LoyaltyPoints = mongoose.model('LoyaltyPoints', loyaltyPointsSchema);

module.exports = LoyaltyPoints;

