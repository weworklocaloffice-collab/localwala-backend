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

const Joi = require('joi');
const { objectId } = require('./custom.validation');

const createSettings = {
  body: Joi.object().keys({
    // Wallet Settings //
    canEarnBuyFromWallet: Joi.boolean().allow(),
    refundToWallet: Joi.boolean().allow(),
    canAddFundToWallet: Joi.boolean().allow(),
    // Wallet Settings //

    // Referral Settings //
    canEarnBuyFromReferral: Joi.boolean().allow(),
    earnPerReferral: Joi.number().allow(),
    referralLimit: Joi.number().allow(),
    whoEarnReferral: Joi.string().valid('both', 'invitee', 'redeemer'),
    referralTitle: Joi.string().allow(),
    referralMessage: Joi.string().allow(),
    referralTranslations: Joi.array().allow(),
    // Referral Settings //

    // Verification Settings //
    userLoginWith: Joi.string()
      .valid('email_password', 'phone_password', 'phone_otp', 'email_otp')
      .allow(),
    userResetPasswordWith: Joi.string().valid('phone_otp', 'email_otp').allow(),
    signUpVerification: Joi.boolean().allow(),
    signUpVerifyWith: Joi.string().valid('phone_otp', 'email_otp').allow(),
    // Verification Settings //

    // Loyalty Point //
    canEarnLoyaltyPointOnOrder: Joi.boolean().allow(),
    loyaltyMinOrderTotal: Joi.number().allow(),
    loyaltyPointValue: Joi.number().allow(),
    minLoyaltyPointToRedeem: Joi.number().allow(),
    priceOfOneLoyaltyPoint: Joi.number().allow(),
    // Loyalty Point //
  }),
};

const idValidation = {
  params: Joi.object().keys({
    settingId: Joi.string().custom(objectId),
  }),
};

module.exports = {
  createSettings,
  idValidation,
};

