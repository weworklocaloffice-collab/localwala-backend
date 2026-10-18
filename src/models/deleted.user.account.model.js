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

const deletedUserAccountSchema = mongoose.Schema(
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
    reason: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserDeleteAccountReason',
      required: true,
    },
    diningBookings: {
      type: Number,
      default: 0,
      required: true,
    },
    diningGrandTotal: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    diningRefund: {
      type: Number,
      default: 0,
      required: true,
    },
    favFood: {
      type: Number,
      default: 0,
      required: true,
    },
    favOrders: {
      type: Number,
      default: 0,
      required: true,
    },
    favRest: {
      type: Number,
      default: 0,
      required: true,
    },
    hiddenRest: {
      type: Number,
      default: 0,
      required: true,
    },
    loyaltyPoints: {
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
    orderCount: {
      type: Number,
      default: 0,
      required: true,
    },
    orderGrandTotal: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    orderRefund: {
      type: Number,
      default: 0,
      required: true,
    },
    tiffinPackageGrandTotal: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    tiffinPackages: {
      type: Number,
      default: 0,
      required: true,
    },
    tiffinRefund: {
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
    userComplaints: {
      type: Number,
      default: 0,
      required: true,
    },
    restaurantComplaints: {
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
deletedUserAccountSchema.plugin(toJSON);
deletedUserAccountSchema.plugin(paginate);

/**
 * @typedef DeletedUserAccount
 */
const DeletedUserAccount = mongoose.model('DeletedUserAccount', deletedUserAccountSchema);

module.exports = DeletedUserAccount;

