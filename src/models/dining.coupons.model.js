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

const diningCouponSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: true,
    },
    location: {
      type: {
        type: String, // Don't do `{ location: { type: String } }`
        enum: ['Point'], // 'location.type' must be 'Point'
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    allRestaurants: {
      type: Boolean,
      default: false,
    },
    restaurant: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Restaurant',
        required: false,
      },
    ],
    allUsers: {
      type: Boolean,
      default: false,
    },
    user: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
        required: false,
      },
    ],
    code: {
      type: String,
      required: true,
    },
    limitSameUser: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    start: {
      type: Date,
      required: true,
    },
    expires: {
      type: Date,
      required: true,
    },
    discountType: {
      type: String,
      required: false, // amount // percentage
      default: 'amount',
    },
    minDiscount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    maxDiscount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    availability: {
      type: String,
      required: true,
      default: 'breakfast', // breakfast // lunch // dinner
    },
    preBookingChargeRequired: {
      type: Boolean,
      default: false,
    },
    preBookingChargeAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    createdBy: {
      type: String,
      required: true,
      default: 'admin', // admin // vendor // vendorOutlet // cityMaster
    },
    createdById: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    translations: {
      type: Array,
      default: [],
    },
    status: {
      type: String,
      default: 'hold', // hold,live,hide,requested
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
diningCouponSchema.plugin(toJSON);
diningCouponSchema.plugin(paginate);
diningCouponSchema.index({ location: '2dsphere' });

/**
 * @typedef DiningCoupon
 */
const DiningCoupon = mongoose.model('DiningCoupon', diningCouponSchema);

module.exports = DiningCoupon;

