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

const diningBookingRefundRequestSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    booking: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DiningBooking',
      required: false,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    payment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentConfig',
      required: true,
    },
    amount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    refundTo: {
      type: String,
      default: 'none', // none, wallet, inherit
    },
    payResponse: {
      type: Object,
      required: false,
    },
    refundReason: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DiningBookingRefundRequestReason',
      required: true,
    },
    cancelReason: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      default: 'initiated', // initiated, refunded, partially_refunded, cancelled
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
diningBookingRefundRequestSchema.plugin(toJSON);

/**
 * @typedef DiningBookingRefundRequest
 */
const DiningBookingRefundRequest = mongoose.model(
  'DiningBookingRefundRequest',
  diningBookingRefundRequestSchema
);

module.exports = DiningBookingRefundRequest;

