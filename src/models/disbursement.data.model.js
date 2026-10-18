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

const disbursementDataSchema = mongoose.Schema(
  {
    disbursementNo: {
      type: Number,
      required: true,
    },
    generatedTime: {
      type: String,
      required: true,
    },
    totalAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    cronJobDate: {
      type: String,
      required: true,
    },
    disbursementType: {
      type: String,
      required: true,
      default: 'restaurant', // restaurant, deliveryman
    },
    status: {
      type: String,
      default: 'pending', // pending, completed, partially_completed, cancelled
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
disbursementDataSchema.plugin(toJSON);
disbursementDataSchema.plugin(paginate);

/**
 * @typedef DisbursementData
 */
const DisbursementData = mongoose.model('DisbursementData', disbursementDataSchema);

module.exports = DisbursementData;

