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

const userSettingsSchema = mongoose.Schema(
  {
    // Wallet Settings //
    canEarnBuyFromWallet: {
      type: Boolean,
      required: false,
      default: false,
    },
    refundToWallet: {
      type: Boolean,
      required: false,
      default: false,
    },
    canAddFundToWallet: {
      type: Boolean,
      required: false,
      default: false,
    },
    // Wallet Settings //

    // Referral Settings //
    canEarnBuyFromReferral: {
      type: Boolean,
      required: false,
      default: false,
    },
    earnPerReferral: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    referralLimit: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 5,
    },
    whoEarnReferral: {
      type: String,
      required: false,
      default: 'both', // both, invitee, redeemer
    },
    referralTitle: {
      type: String,
      required: false,
    },
    referralMessage: {
      type: String,
      required: false,
    },
    referralTranslations: {
      type: Array,
      default: [],
    },
    // Referral Settings //

    // Verification Settings //
    userLoginWith: {
      type: String,
      required: false,
      default: 'email_password', // email_password, phone_password, phone_otp, email_otp
    },
    userResetPasswordWith: {
      type: String,
      required: false,
      default: 'email_otp', // email_otp, phone_otp
    },
    signUpVerification: {
      type: Boolean,
      required: false,
      default: false,
    },
    signUpVerifyWith: {
      type: String,
      required: false,
      default: 'email_otp', // email_otp, phone_otp
    },
    // Verification Settings //

    // Loyalty Point //
    canEarnLoyaltyPointOnOrder: {
      type: Boolean,
      required: false,
      default: false,
    },
    loyaltyMinOrderTotal: {
      type: Number, // Min Order Value
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    loyaltyPointValue: {
      type: Number, // Loyalty Value In % over order value
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    minLoyaltyPointToRedeem: {
      type: Number, // Minimum Loyalty Point Required to Redeem In Wallet
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    priceOfOneLoyaltyPoint: {
      type: Number, // 1 Loyalty Points to Total Cash Amount Ex.10/Points to 1$ in Wallet
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    // Loyalty Point //
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
userSettingsSchema.plugin(toJSON);

/**
 * @typedef UserSettings
 */
const UserSettings = mongoose.model('UserSettings', userSettingsSchema);

module.exports = UserSettings;

