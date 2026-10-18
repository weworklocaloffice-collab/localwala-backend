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

const reportEmergencyFormSchema = mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    userCountryCode: {
      type: Number,
      required: true,
    },
    userContact: {
      type: String,
      required: true,
    },
    userEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    shortDescription: {
      type: String,
      required: true,
      trim: true,
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
reportEmergencyFormSchema.plugin(toJSON);
reportEmergencyFormSchema.plugin(paginate);

/**
 * @typedef ReportEmergencyForm
 */
const ReportEmergencyForm = mongoose.model('ReportEmergencyForm', reportEmergencyFormSchema);

module.exports = ReportEmergencyForm;

