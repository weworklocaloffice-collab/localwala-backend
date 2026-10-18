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

const diningBookingSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    payment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentConfig',
      required: false,
    },
    paymentMode: {
      type: String,
      required: false,
      default: 'online',
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    coupon: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DiningCoupon',
      required: false,
    },
    campaign: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DiningCampaign',
      required: false,
    },
    bookingDate: {
      type: Date,
      required: true,
    },
    bookingSlot: {
      type: String,
      required: true,
    },
    guest: {
      type: Number,
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    userCountryCode: {
      type: Number,
      required: true,
    },
    userContact: {
      type: String,
      required: true,
    },
    userEmail: {
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
    specialRequest: {
      type: String,
      required: false,
    },
    preBookingCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    couponCoverCharge: {
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
    bookingCancellation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DiningCancellationReason',
      required: false,
    },
    bookingCommission: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    diningItemTotalAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    diningItemDiscountAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    diningCouponDiscountAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    diningGrandTotalBillAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    status: {
      type: String,
      default: 'pending_payments', // created, accepted, completed, cancelled, rejected, refunded, partially_refunded, pending_payments
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
diningBookingSchema.plugin(toJSON);
diningBookingSchema.plugin(paginate);

/**
 * @typedef DiningBooking
 */
const DiningBooking = mongoose.model('DiningBooking', diningBookingSchema);

module.exports = DiningBooking;

