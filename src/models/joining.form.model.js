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

const joiningFormSchema = mongoose.Schema(
  {
    restaurantForm: {
      type: Array,
      default: [],
    },
    deliverymanForm: {
      type: Array,
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
joiningFormSchema.plugin(toJSON);

/**
 * @typedef JoiningForm
 */
const JoiningForm = mongoose.model('JoiningForm', joiningFormSchema);

module.exports = JoiningForm;

