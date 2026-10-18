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

const driverNewOrderStatusSchema = mongoose.Schema(
  {
    orderId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Orders',
      required: true,
    },
    driver: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    deliveryAddressRaw: {
      type: String,
      required: false,
    },
    driverOrderStatus: {
      type: String,
      default: 'ideal', // ideal, accepted, driver_reached_restaurant, driver_pickpup_order, driver_reached_customer, rejected, cancelled, delivered, accepted_another
      required: false,
    },
    orderCancellation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'OrderCancellationReason',
      required: false,
    },
    orderFrom: {
      type: String,
      default: 'manually', // manually, automatically
      required: false,
    },
    earning: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    tipAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    incentiveAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    extraEarningOnShiftAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    acceptedAt: {
      type: Date,
      required: false,
    },
    deliveredAt: {
      type: Date,
      required: false,
    },
    // Manual-assignment audit. `orderFrom: 'manually'` alone does not record who
    // chose the rider or from where, so a late delivery cannot be attributed.
    selectedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
      default: null,
    },
    selectedAt: {
      type: Date,
      required: false,
      default: null,
    },
    selectionSource: {
      type: String,
      required: false,
      default: null, // vendor_app, vendor_web, admin, city_master
    },
    // Offer TTL. Without this an offer is open forever and an order whose rider
    // simply walked away can never be re-dispatched — the whole reason orders
    // used to sit at `driverAssign: 'ideal'` invisibly.
    expiresAt: {
      type: Date,
      required: false,
      default: null,
    },
    // Which rung of the escalation ladder created this offer.
    offerRound: {
      type: Number,
      required: false,
      default: 0,
    },
    // Why this rider was chosen, snapshotted at dispatch time. A dispute about an
    // assignment is answerable from this row alone.
    dispatchScore: {
      type: Number,
      required: false,
      default: null,
    },
    dispatchDistance: {
      type: Number,
      required: false,
      default: null,
    },
    dispatchEtaMinutes: {
      type: Number,
      required: false,
      default: null,
    },
    dispatchFactors: {
      type: mongoose.SchemaTypes.Mixed,
      required: false,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
driverNewOrderStatusSchema.plugin(toJSON);

driverNewOrderStatusSchema.index({ orderId: 1, driverOrderStatus: 1 });
driverNewOrderStatusSchema.index({ driver: 1, driverOrderStatus: 1 });
driverNewOrderStatusSchema.index({ driverOrderStatus: 1, expiresAt: 1 });

/**
 * @typedef DriverNewOrderStatus
 */
const DriverNewOrderStatus = mongoose.model('DriverNewOrderStatus', driverNewOrderStatusSchema);

module.exports = DriverNewOrderStatus;

