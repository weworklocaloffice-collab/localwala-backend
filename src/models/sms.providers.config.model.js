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

const smsProvidersConfigSchema = mongoose.Schema(
  {
    slug: {
      type: String,
      unique: true,
    },
    credentials: {
      type: Object,
      required: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    template: {
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
  }
);

// add plugin that converts mongoose to json & convert to unique slug
smsProvidersConfigSchema.plugin(toJSON);

/**
 * @typedef SmsProviderConfig
 */
const SmsProviderConfig = mongoose.model('SmsProviderConfig', smsProvidersConfigSchema);

module.exports = SmsProviderConfig;

