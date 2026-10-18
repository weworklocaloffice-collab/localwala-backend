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

const restaurantSettingsSchema = mongoose.Schema(
  {
    // Verification Settings //
    restaurantLoginWith: {
      type: String,
      required: false,
      default: 'email_password', // email_password, phone_password, phone_otp, email_otp
    },
    restaurantResetPasswordWith: {
      type: String,
      required: false,
      default: 'email_otp', // email_otp, phone_otp
    },
    selfRegistration: {
      type: Boolean,
      required: false,
      default: false,
    },
    // Verification Settings //

    // Cash In Hand //
    cashInHand: {
      type: Boolean,
      required: false,
      default: false,
    },
    minCashInHand: {
      type: Number,
      required: false,
      default: 0,
    },
    maxCashInHand: {
      type: Number,
      required: false,
      default: 0,
    },
    // Cash In Hand //

    driverPickup: {
      type: Boolean,
      required: false,
      default: true,
    },
    // Whether a restaurant that draws from the PLATFORM rider pool may pick the
    // rider itself.
    //
    // Separate from `driverPickup` because the two answer different questions.
    // `driverPickup` asks "does this restaurant manage its own delivery staff" —
    // it owns those riders, employs them and answers for them. This one asks
    // "should the platform hand a gig worker's identity, photo and live position
    // to a third party who does not employ them", and the default answer is no.
    //
    // It exists so an operator can restore the old behaviour for one restaurant
    // if a vendor pushes back, without shipping a build. It is a rollback lever,
    // not a supported mode — every comparable platform runs platform-rider
    // assignment centrally.
    platformDriverPickup: {
      type: Boolean,
      required: false,
      default: false,
    },
    canInitiateChat: {
      type: Boolean,
      required: false,
      default: false,
    },
    canInitiateCall: {
      type: Boolean,
      required: false,
      default: true,
    },

    // Packages Charges
    havePackagingCharges: {
      type: Boolean,
      required: false,
      default: false,
    },
    packagingCharges: {
      type: Number,
      required: false,
      default: 0,
    },
    includePackagesChargesInTax: {
      type: Boolean,
      required: false,
      default: false,
    },
    packagingChargesTax: { type: Number, required: false, default: 0 },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
restaurantSettingsSchema.plugin(toJSON);

/**
 * @typedef RestaurantSettings
 */
const RestaurantSettings = mongoose.model('RestaurantSettings', restaurantSettingsSchema);

module.exports = RestaurantSettings;

