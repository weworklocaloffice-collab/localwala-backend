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
const validator = require('validator');
const { toJSON, paginate } = require('./plugins');

const deletedDeliverymanAccountSchema = mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    countryCode: {
      type: Number,
      required: true,
    },
    mobile: {
      type: String,
      required: true,
    },
    gender: {
      type: String,
      default: 'male',
    },
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: true,
    },
    locality: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Locality',
      required: false,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: false,
    },
    reason: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserDeleteAccountReason',
      required: true,
    },
    cancelledOrder: {
      type: Number,
      default: 0,
      required: true,
    },
    delayedOrder: {
      type: Number,
      default: 0,
      required: true,
    },
    deliveredOrders: {
      type: Number,
      default: 0,
      required: true,
    },
    rating: {
      type: Number,
      default: 0,
      required: true,
    },
    type: {
      type: String,
      default: 'freelancer',
      required: true,
    },
    extraEarningOnShiftAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    incentiveAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    rejectedOrder: {
      type: Number,
      default: 0,
      required: true,
    },
    role: {
      type: String,
      default: 'driver',
      required: true,
    },
    tipAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    totalEarning: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    totalRating: {
      type: Number,
      default: 0,
      required: true,
    },
    walletBalance: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    medias: {
      type: Number,
      default: 0,
      required: true,
    },
    directChat: {
      type: Number,
      default: 0,
      required: true,
    },
    supportChat: {
      type: Number,
      default: 0,
      required: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
deletedDeliverymanAccountSchema.plugin(toJSON);
deletedDeliverymanAccountSchema.plugin(paginate);

/**
 * @typedef DeletedDeliverymanAccount
 */
const DeletedDeliverymanAccount = mongoose.model(
  'DeletedDeliverymanAccount',
  deletedDeliverymanAccountSchema
);

module.exports = DeletedDeliverymanAccount;

