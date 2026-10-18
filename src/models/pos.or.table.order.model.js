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

const posOrTableOrderSchema = mongoose.Schema(
  {
    orderNo: {
      type: Number,
      required: true,
    },
    foods: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Food',
        required: true,
      },
    ],
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    paymentMode: {
      type: String,
      required: false,
      default: 'online', // online, offline
    },
    customerType: {
      type: String,
      required: false,
      default: 'guest', // guest, regular
    },
    customerName: {
      type: String,
      required: false,
      default: 'none',
    },
    customerCountryCode: {
      type: Number,
      required: false,
      default: 1,
    },
    customerMobileNumber: {
      type: String,
      required: false,
      default: '000000000000',
    },
    cartItemRaw: {
      type: String,
      required: true,
    },
    realTotal: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    itemTotal: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    itemDiscount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    discountType: {
      type: String,
      required: false,
      default: 'per', // per, amount
    },
    discountAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    discountCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    foodServiceCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    serviceCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    packageCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    packageChargeTax: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    waiterTip: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    extraCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    grandTotal: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    orderFrom: {
      type: String,
      default: 'vendor', // vendor, waiter, user_web
    },
    tableOrder: {
      type: Boolean,
      default: true,
    },
    restaurantCommission: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    status: {
      type: String,
      default: 'created', // created, accepted, preparing, ready, completed
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
posOrTableOrderSchema.plugin(toJSON);
posOrTableOrderSchema.plugin(paginate);

/**
 * @typedef PosOrTableOrder
 */
const PosOrTableOrder = mongoose.model('PosOrTableOrder', posOrTableOrderSchema);

module.exports = PosOrTableOrder;

