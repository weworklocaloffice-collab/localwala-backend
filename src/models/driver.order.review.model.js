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

const driverOrderReviewSchema = mongoose.Schema(
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
    driver: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    ratingCount: {
      type: Number,
      required: true,
    },
    messages: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'OrderRatingMessages',
        required: false,
      },
    ],
    images: {
      type: Array,
      default: [],
    },
    shortReview: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
driverOrderReviewSchema.plugin(toJSON);

/**
 * @typedef DriverOrderReview
 */
const DriverOrderReview = mongoose.model('DriverOrderReview', driverOrderReviewSchema);

module.exports = DriverOrderReview;

