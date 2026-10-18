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

const cronJobSchedulerSchema = mongoose.Schema(
  {
    jobName: {
      type: String,
      required: true,
      trim: true,
    },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    status: { type: String, enum: ['success', 'failure'], required: true },
    errorMessage: { type: String },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
cronJobSchedulerSchema.plugin(toJSON);

/**
 * @typedef CronJobScheduler
 */
const CronJobScheduler = mongoose.model('CronJobScheduler', cronJobSchedulerSchema);

module.exports = CronJobScheduler;

