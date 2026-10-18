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

const paymentConfigSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
    },
    image: {
      type: String,
      required: true,
    },
    environment: {
      type: Boolean,
      default: false,
    },
    credentials: {
      type: Object,
      required: true,
    },
    translations: {
      type: Array,
      default: [],
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    paymentWay: {
      type: String,
      required: false,
      default: 'online',
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
paymentConfigSchema.plugin(toJSON);

/**
 * @typedef PaymentConfig
 */
const PaymentConfig = mongoose.model('PaymentConfig', paymentConfigSchema);

module.exports = PaymentConfig;

