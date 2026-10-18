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

const restaurantJoiningRequestSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
    },
    shortDescription: {
      type: String,
      required: true,
    },
    cuisine: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Cuisine',
        required: true,
      },
    ],
    logo: {
      type: String,
      required: true,
    },
    cover: {
      type: String,
      required: true,
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
    approxDeliveryTime: {
      type: String,
      required: true,
    },
    dishPriceForTwo: {
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      required: true,
    },
    translations: {
      type: Array,
      default: [],
    },
    restaurantType: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'RestaurantType',
        required: true,
      },
    ],
    restaurantFacility: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'RestaurantFacility',
        required: true,
      },
    ],
    acceptScheduleDelivery: {
      type: Boolean,
      default: true,
    },
    acceptHomeDelivery: {
      type: Boolean,
      default: true,
    },
    takeAway: {
      type: Boolean,
      default: true,
    },
    minOrderAmount: {
      type: Number,
      default: 1000,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      required: true,
    },
    license: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RestaurantFoodLicense',
      required: false,
    },
    licenseId: {
      type: String,
      default: '',
      required: false,
    },
    formElement: {
      type: Array,
      default: [],
    },
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
      unique: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    password: {
      type: String,
      required: true,
      trim: true,
      minlength: 8,
      validate(value) {
        if (!value.match(/\d/) || !value.match(/[a-zA-Z]/)) {
          throw new Error('Password must contain at least one letter and one number');
        }
      },
      private: true, // used by the toJSON plugin
    },
    countryCode: {
      type: Number,
      required: true,
    },
    mobile: {
      type: String,
      required: true,
    },
    businessType: {
      type: String,
      required: true,
      default: 'commission', // commission or subscription or derived
    },
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Subscriptions',
      required: false,
    },
    paidAmount: {
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      required: false,
    },
    locale: {
      type: String,
      required: false,
      default: 'en',
    },
    socialFacebook: {
      type: String,
      default: '',
      required: false,
    },
    socialInstagram: {
      type: String,
      default: '',
      required: false,
    },
    socialX: {
      type: String,
      default: '',
      required: false,
    },
    socialYoutube: {
      type: String,
      default: '',
      required: false,
    },
    socialLinkedIn: {
      type: String,
      default: '',
      required: false,
    },
    socialPinterest: {
      type: String,
      default: '',
      required: false,
    },
    status: {
      type: String,
      default: 'pending_payments', // created, rejected, pending_payments
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
restaurantJoiningRequestSchema.plugin(toJSON);
restaurantJoiningRequestSchema.plugin(paginate);
restaurantJoiningRequestSchema.index({ location: '2dsphere' });

/**
 * @typedef RestaurantJoiningRequest
 */
const RestaurantJoiningRequest = mongoose.model(
  'RestaurantJoiningRequest',
  restaurantJoiningRequestSchema
);

module.exports = RestaurantJoiningRequest;

