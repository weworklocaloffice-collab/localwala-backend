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

const subscriptionsSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: 'String',
      source: 'name',
      unique: true,
    },
    price: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    discount: {
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    shortDescriptions: {
      type: String,
      required: true,
      trim: true,
    },
    validity: {
      // Package Validation in days
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      required: true,
    },
    haveTrial: {
      // If true give trial package in days
      type: Boolean,
      default: false,
    },
    trialValidity: {
      // Trial Validation in days
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    icon: {
      type: String,
      required: true,
    },
    pos: {
      type: Boolean,
      default: false,
    },
    ownDriver: {
      type: Boolean,
      default: false,
    },
    promote: {
      type: Boolean,
      default: false,
    },
    customCategory: {
      type: Boolean,
      default: false,
    },
    multiOutlet: {
      type: Boolean,
      default: false,
    },
    preBooking: {
      type: Boolean,
      default: false,
    },
    tableOrder: {
      type: Boolean,
      default: false,
    },
    tiffinSubscription: {
      type: Boolean,
      default: false,
    },
    ownWaiter: {
      type: Boolean,
      default: false,
    },
    ownKitchen: {
      type: Boolean,
      default: false,
    },
    orderLimit: {
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: -1, // -1 means unlimited
    },
    productLimit: {
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: -1, // -1 means unlimited
    },
    commission: {
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      required: false,
      default: 0,
    },
    translations: {
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
subscriptionsSchema.plugin(toJSON);
subscriptionsSchema.plugin(slugGenerator);
subscriptionsSchema.plugin(paginate);

subscriptionsSchema.statics.isNameTaken = async function (name, excludeSubscriptionId) {
  const subscription = await this.findOne({ name, _id: { $ne: excludeSubscriptionId } });
  return !!subscription;
};

/**
 * @typedef Subscriptions
 */
const Subscriptions = mongoose.model('Subscriptions', subscriptionsSchema);

module.exports = Subscriptions;

