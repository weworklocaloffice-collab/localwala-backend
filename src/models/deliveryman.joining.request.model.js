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

const deliverymanJoiningRequestSchema = mongoose.Schema(
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
    vehicle: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Vehicle',
      required: true,
    },
    cover: {
      type: String,
      required: true,
    },
    identity: {
      type: String, // passport, driving license // NID // Restaurant ID
      required: true,
    },
    identityNumber: {
      type: String,
      required: true,
    },
    identityProof: {
      type: String,
      required: true,
    },
    drivingLicense: {
      type: String,
      required: true,
    },
    age: {
      type: Number,
      required: true,
    },
    dob: {
      type: Date,
      required: true,
    },
    type: {
      type: String,
      required: true,
      default: 'freelancer', // freelancer or salary
    },
    formElement: {
      type: Array,
      default: [],
    },
    locale: {
      type: String,
      required: false,
      default: 'en',
    },
    status: {
      type: String,
      default: 'created', // created, rejected
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
deliverymanJoiningRequestSchema.plugin(toJSON);
deliverymanJoiningRequestSchema.plugin(paginate);
deliverymanJoiningRequestSchema.index({ location: '2dsphere' });

/**
 * @typedef DeliverymanJoiningRequest
 */
const DeliverymanJoiningRequest = mongoose.model(
  'DeliverymanJoiningRequest',
  deliverymanJoiningRequestSchema
);

module.exports = DeliverymanJoiningRequest;

