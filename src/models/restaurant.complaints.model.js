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
const { toJSON } = require('./plugins');

const restaurantComplaintsSchema = mongoose.Schema(
  {
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    orders: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Orders',
      required: true,
    },
    reason: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ComplaintsReason',
      required: false,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    brief: {
      type: String,
      required: true,
      trim: true,
    },
    issueWith: {
      type: String,
      required: true,
      default: 'customer', // deliveryman, customer
    },
    driver: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    proof: {
      type: Array,
      default: [],
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
restaurantComplaintsSchema.plugin(toJSON);

/**
 * @typedef RestaurantComplaints
 */
const RestaurantComplaints = mongoose.model('RestaurantComplaints', restaurantComplaintsSchema);

module.exports = RestaurantComplaints;

