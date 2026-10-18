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

const driverSettingsSchema = mongoose.Schema(
  {
    // Verification Settings //
    driverLoginWith: {
      type: String,
      required: false,
      default: 'email_password', // email_password, phone_password, phone_otp, email_otp
    },
    driverResetPasswordWith: {
      type: String,
      required: false,
      default: 'email_otp', // email_otp, phone_otp
    },
    selfRegistration: {
      type: Boolean,
      required: false,
      default: false,
    },
    // Verification Settings //

    // Cash In Hand //
    cashInHand: {
      type: Boolean,
      required: false,
      default: false,
    },
    minCashInHand: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    maxCashInHand: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    // Cash In Hand //

    // More Settings //
    getTip: {
      type: Boolean,
      required: false,
      default: true,
    },
    showEarning: {
      type: Boolean,
      required: false,
      default: true,
    },
    maxOrderLimit: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    pickupProof: {
      type: Boolean,
      required: false,
      default: true,
    },
    deliveryProof: {
      type: Boolean,
      required: false,
      default: true,
    },
    canInitiateChat: {
      type: Boolean,
      required: false,
      default: false,
    },
    canInitiateCall: {
      type: Boolean,
      required: false,
      default: true,
    },
    // More Settings //

    // Earning Settings //
    earningModel: {
      type: String,
      required: false,
      default: 'salaried', // salaried // order
    },
    salaryAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    earningOnOrder: {
      type: String,
      required: false,
      default: 'fixed', // fixed // distance
    },
    distanceRadiusForFixed: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 10,
    },
    earningFixedDistanceAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    earningAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    earningSurplusDistanceAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    // Earning Settings //

    // Incentive Settings //
    haveIncentive: {
      type: Boolean,
      required: false,
      default: true,
    },
    // Incentive Settings //
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
driverSettingsSchema.plugin(toJSON);

/**
 * @typedef DriverSettings
 */
const DriverSettings = mongoose.model('DriverSettings', driverSettingsSchema);

module.exports = DriverSettings;

