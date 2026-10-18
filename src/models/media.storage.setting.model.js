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

const mediaStorageSettingSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    imagePath: {
      type: String,
      trim: true,
      default: '',
    },
    credentials: {
      type: Object,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
mediaStorageSettingSchema.plugin(toJSON);
mediaStorageSettingSchema.plugin(paginate);

/**
 * @typedef MediaStorageSetting
 */
const MediaStorageSetting = mongoose.model('MediaStorageSetting', mediaStorageSettingSchema);

module.exports = MediaStorageSetting;

