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

const kitchenOwnerSettingSchema = mongoose.Schema(
  {
    // Verification Settings //
    ownerLoginWith: {
      type: String,
      required: false,
      default: 'email_password', // email_password, phone_password, phone_otp, email_otp
    },
    ownerResetPasswordWith: {
      type: String,
      required: false,
      default: 'email_otp', // email_otp, phone_otp
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
kitchenOwnerSettingSchema.plugin(toJSON);

/**
 * @typedef KitchenOwnerSettingSettings
 */
const KitchenOwnerSettingSettings = mongoose.model(
  'KitchenOwnerSettingSettings',
  kitchenOwnerSettingSchema
);

module.exports = KitchenOwnerSettingSettings;

