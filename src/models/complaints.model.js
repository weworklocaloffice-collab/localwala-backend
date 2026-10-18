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

const complaintsSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
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
      default: 'order', // order, restaurant, product, deliveryman, customer
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    driver: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Food',
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
complaintsSchema.plugin(toJSON);

/**
 * @typedef Complaints
 */
const Complaints = mongoose.model('Complaints', complaintsSchema);

module.exports = Complaints;

