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

const withdrawalRequestSchema = mongoose.Schema(
  {
    from: {
      type: String,
      default: 'restaurant', // deliveryman // restaurant
      required: true,
    },
    deliveryman: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: false,
    },
    restaurantPayoutMethod: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RestaurantPayoutMethod',
      required: false,
    },
    deliverymanPayoutMethod: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliverymanPayoutMethod',
      required: false,
    },
    withdrawalMethod: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'WithdrawalMethod',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    rejectedBy: {
      type: String,
      default: 'admin', // admin
    },
    rejectedReason: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    approvedNotes: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    proof: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    formElement: {
      type: Array,
      default: [],
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
withdrawalRequestSchema.plugin(toJSON);
withdrawalRequestSchema.plugin(paginate);

/**
 * @typedef WithdrawalRequest
 */
const WithdrawalRequest = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);

module.exports = WithdrawalRequest;

