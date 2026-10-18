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

const otpWebVerificationSchema = mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
    },
    redirectUrl: {
      type: String,
      required: true,
    },
    kind: {
      type: String,
      required: true,
    },
    token: {
      type: String,
      default: '',
    },
    mode: {
      type: String,
      required: true,
    },
    locale: {
      type: String,
      required: true,
    },
    status: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
otpWebVerificationSchema.plugin(toJSON);
otpWebVerificationSchema.plugin(paginate);

/**
 * @typedef OtpWebVerification
 */
const OtpWebVerification = mongoose.model('OtpWebVerification', otpWebVerificationSchema);

module.exports = OtpWebVerification;

