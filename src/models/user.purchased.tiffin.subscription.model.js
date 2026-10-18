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

const userPurchasedTiffinSubscriptionSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    subscriptionPackage: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'SubscriptionTiffinPackage',
      required: true,
    },
    payment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentConfig',
      required: true,
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    addons: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Addons',
        required: false,
      },
    ],
    foods: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Food',
        required: true,
      },
    ],
    slot: {
      type: String,
      required: true,
    },
    orderAt: {
      type: String,
      required: true,
    },
    orderTo: {
      type: String,
      required: false,
      default: 'homedelivery', // homedelivery, selfpickup
    },
    cookingInstruction: {
      type: String,
      required: false,
    },
    deliveryInstruction: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryInstruction',
      required: false,
    },
    deliveryAddress: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserAddress',
      required: false,
    },
    deliveryAddressRaw: {
      type: String,
      required: false,
    },
    receiverName: {
      type: String,
      required: false,
    },
    countryCode: {
      type: Number,
      required: false,
    },
    receiverContact: {
      type: String,
      required: false,
    },
    cartItemRaw: {
      type: String,
      required: true,
    },
    itemTotal: {
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
    totalOrder: {
      type: Number,
      required: true,
      default: 0,
    },
    startDate: {
      type: Date,
      required: true,
    },
    offDays: [
      {
        type: String,
        required: false,
      },
    ],
    ordersDates: [
      {
        type: Date,
        required: false,
      },
    ],
    requestedOffDates: [
      {
        type: Date,
        required: false,
      },
    ],
    subscriptionCancellation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'TiffinSubscriptionCancellationReason',
      required: false,
    },
    cancellationBy: {
      type: String,
      default: 'none',
    },
    status: {
      type: String,
      default: 'pending_payments', // created, cancelled, completed, refunded, partially_refunded, pending_payments
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
userPurchasedTiffinSubscriptionSchema.plugin(toJSON);
userPurchasedTiffinSubscriptionSchema.plugin(paginate);

/**
 * @typedef UserPurchasedTiffinSubscription
 */
const UserPurchasedTiffinSubscription = mongoose.model(
  'UserPurchasedTiffinSubscription',
  userPurchasedTiffinSubscriptionSchema
);

module.exports = UserPurchasedTiffinSubscription;

