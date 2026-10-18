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

const deletedRestaurantAccountSchema = mongoose.Schema(
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
    reason: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserDeleteAccountReason',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      required: true,
    },
    rating: {
      type: Number,
      default: 0,
      required: true,
    },
    type: {
      type: String,
      required: true,
      default: 'commission', // commission or subscription or derived
    },
    commission: {
      type: Number,
      required: false,
      default: 0,
    },
    posOrderCommission: {
      type: Number,
      required: false,
      default: 0,
    },
    tableOrderCommission: {
      type: Number,
      required: false,
      default: 0,
    },
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Subscriptions',
      required: false,
    },
    walletBalance: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    orderEarningAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    orderDiscountGivenAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    orderRestaurantCommission: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    orderFoodTaxAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    orderServiceChargeAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    posEarningAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    posDiscountGivenAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    posRestaurantCommission: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    posFoodTaxAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    posServiceChargeAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    tableOrderEarningAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    tableOrderDiscountGivenAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    tableOrderRestaurantCommission: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    tableOrderFoodTaxAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    tableOrderServiceChargeAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    diningEarningAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    diningCommissionAmount: {
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
    deliverymans: {
      type: Number,
      default: 0,
      required: true,
    },
    tiffinPackages: {
      type: Number,
      default: 0,
      required: true,
    },
    soldTiffinPackages: {
      type: Number,
      default: 0,
      required: true,
    },
    orderRefund: {
      type: Number,
      default: 0,
      required: true,
    },
    diningRefund: {
      type: Number,
      default: 0,
      required: true,
    },
    tiffinRefund: {
      type: Number,
      default: 0,
      required: true,
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
    orders: {
      type: Number,
      default: 0,
      required: true,
    },
    foods: {
      type: Number,
      default: 0,
      required: true,
    },
    diningBookings: {
      type: Number,
      default: 0,
      required: true,
    },
    posOrders: {
      type: Number,
      default: 0,
      required: true,
    },
    tableOrders: {
      type: Number,
      default: 0,
      required: true,
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
    takeAway: {
      type: Boolean,
      default: true,
    },
    acceptScheduleDelivery: {
      type: Boolean,
      default: true,
    },
    acceptHomeDelivery: {
      type: Boolean,
      default: true,
    },
    translations: {
      type: Array,
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
deletedRestaurantAccountSchema.plugin(toJSON);
deletedRestaurantAccountSchema.plugin(paginate);

/**
 * @typedef DeletedRestaurantAccount
 */
const DeletedRestaurantAccount = mongoose.model(
  'DeletedRestaurantAccount',
  deletedRestaurantAccountSchema
);

module.exports = DeletedRestaurantAccount;

