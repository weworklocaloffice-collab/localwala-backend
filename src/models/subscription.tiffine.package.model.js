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

const subscriptionTiffinPackageSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    shortDescription: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: true,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    foods: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Food',
        required: true,
      },
    ],
    interval: {
      type: String,
      required: true,
      default: 'week', // week or fortnight or month
    },
    offDays: {
      type: Array,
      default: [], // sunday, saturday
    },
    totalOrder: {
      type: Number,
      required: true,
      default: 0,
    },
    orderTo: {
      type: String,
      required: true,
      default: 'homedelivery', // homedelivery, selfpickup
    },
    deliveryArea: {
      type: Number,
      required: false,
      default: 0,
    },
    available: {
      type: String,
      required: true,
      default: 'breakfast', // breakfast or lunch or dinner
    },
    timeSlots: {
      type: Array,
      default: [],
    },
    canSelectAddon: {
      type: Boolean,
      default: false,
    },
    canSelectVariation: {
      type: Boolean,
      default: false,
    },
    price: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    discountType: {
      type: String,
      default: '%', // per = % // $ = amount
    },
    discount: {
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 7, // 7 or 15 or 30
    },
    notice: {
      type: Array,
      default: [],
    },
    translations: {
      type: Array,
      default: [],
    },
    status: {
      type: String,
      default: 'hold',
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
subscriptionTiffinPackageSchema.plugin(toJSON);
subscriptionTiffinPackageSchema.plugin(paginate);

/**
 * @typedef SubscriptionTiffinPackage
 */
const SubscriptionTiffinPackage = mongoose.model(
  'SubscriptionTiffinPackage',
  subscriptionTiffinPackageSchema
);

module.exports = SubscriptionTiffinPackage;

