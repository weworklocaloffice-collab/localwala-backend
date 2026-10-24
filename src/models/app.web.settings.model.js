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

const appWebSettingSchema = mongoose.Schema(
  {
    showPopularFood: {
      type: Boolean,
      default: true,
    },
    showMostReviewedFood: {
      type: Boolean,
      default: true,
    },
    showTodaysTrendingFood: {
      type: Boolean,
      default: true,
    },
    showPopularRestaurant: {
      type: Boolean,
      default: true,
    },
    showNewRestaurant: {
      type: Boolean,
      default: true,
    },
    showTiffinSubscriptionPackages: {
      type: Boolean,
      default: true,
    },
    showPopularDiningRestaurant: {
      type: Boolean,
      default: true,
    },
    showNewDiningRestaurant: {
      type: Boolean,
      default: true,
    },

    /// Reels ///
    // How many reels a signed-out visitor may watch before the app asks them to
    // sign in. Read by the reels feed service on every anonymous request; 0 means
    // guests get no reels at all, and a null/absent value falls back to the
    // service default. Admin-editable from System Settings > App Web Settings.
    reelsGuestLimit: {
      type: Number,
      default: 5,
      min: 0,
      max: 100,
    },
    /// Reels ///

    /// User App Info //
    userAndroidForceUpdateVersion: {
      type: String,
      required: false,
    },
    userAndroidUpdateUrl: {
      type: String,
      required: false,
    },
    useriOSForceUpdateVersion: {
      type: String,
      required: false,
    },
    useriOSUpdateUrl: {
      type: String,
      required: false,
    },
    /// User App Info //

    /// Vendor App Info //
    vendorAndroidForceUpdateVersion: {
      type: String,
      required: false,
    },
    vendorAndroidUpdateUrl: {
      type: String,
      required: false,
    },
    vendoriOSForceUpdateVersion: {
      type: String,
      required: false,
    },
    vendoriOSUpdateUrl: {
      type: String,
      required: false,
    },
    /// Vendor App Info //

    /// DeliveryMan App Info //
    deliveryManAndroidForceUpdateVersion: {
      type: String,
      required: false,
    },
    deliveryManAndroidUpdateUrl: {
      type: String,
      required: false,
    },
    deliveryManiOSForceUpdateVersion: {
      type: String,
      required: false,
    },
    deliveryManiOSUpdateUrl: {
      type: String,
      required: false,
    },
    /// DeliveryMan App Info //

    // Waiter App Info //
    waiterAndroidForceUpdateVersion: {
      type: String,
      required: false,
    },
    waiterAndroidUpdateUrl: {
      type: String,
      required: false,
    },
    waiteriOSForceUpdateVersion: {
      type: String,
      required: false,
    },
    waiteriOSUpdateUrl: {
      type: String,
      required: false,
    },
    // Waiter App Info //

    // Kitchen App Info //
    kitchenAndroidForceUpdateVersion: {
      type: String,
      required: false,
    },
    kitchenAndroidUpdateUrl: {
      type: String,
      required: false,
    },
    kitcheniOSForceUpdateVersion: {
      type: String,
      required: false,
    },
    kitcheniOSUpdateUrl: {
      type: String,
      required: false,
    },
    // Kitchen App Info //
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
appWebSettingSchema.plugin(toJSON);
appWebSettingSchema.plugin(paginate);

/**
 * @typedef AppWebSetting
 */
const AppWebSetting = mongoose.model('AppWebSetting', appWebSettingSchema);

module.exports = AppWebSetting;

