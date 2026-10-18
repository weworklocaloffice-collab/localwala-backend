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

const socialSigninSchema = mongoose.Schema(
  {
    appleSignin: {
      type: Boolean,
      default: true,
    },
    googleSignin: {
      type: Boolean,
      default: true,
    },
    facebookSignin: {
      type: Boolean,
      default: true,
    },
    configCredsRaw: {
      google_client_id: {
        type: String,
        default: '',
        required: false,
      },
      google_server_id: {
        type: String,
        default: '',
        required: false,
      },
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
socialSigninSchema.plugin(toJSON);

/**
 * @typedef SocialSignin
 */
const SocialSignin = mongoose.model('SocialSignin', socialSigninSchema);

module.exports = SocialSignin;

