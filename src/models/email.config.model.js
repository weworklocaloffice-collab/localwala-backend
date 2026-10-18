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

const EmailConfigSchema = mongoose.Schema(
  {
    smtpHost: {
      type: String,
      required: true,
      trim: true,
    },
    smtpPort: {
      type: Number,
      required: true,
    },
    smtpUsername: {
      type: String,
      required: true,
      trim: true,
    },
    smtpPassword: {
      type: String,
      required: true,
      trim: true,
    },
    smtpFromEmail: {
      type: String,
      required: true,
      trim: true,
    },
    smtpFromName: {
      type: String,
      required: true,
      trim: true,
    },
    smtpDriver: {
      type: String,
      required: true,
      trim: true,
    },
    smtpEncryption: {
      type: String,
      required: true,
      trim: true,
    },
    mediaUrls: {
      type: Object,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
EmailConfigSchema.plugin(toJSON);
EmailConfigSchema.plugin(paginate);

/**
 * @typedef EmailConfig
 */
const EmailConfig = mongoose.model('EmailConfig', EmailConfigSchema);

module.exports = EmailConfig;

