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

const { status: httpStatus } = require('http-status');
const { UserSettings } = require('../models');
const ApiError = require('../utils/ApiError');

const createSettings = async (param) => {
  if ((await UserSettings.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const settingData = new UserSettings({
    canEarnBuyFromWallet: param.canEarnBuyFromWallet,
    refundToWallet: param.refundToWallet,
    canAddFundToWallet: param.canAddFundToWallet,
    canEarnBuyFromReferral: param.canEarnBuyFromReferral,
    earnPerReferral:
      param &&
      param.earnPerReferral &&
      param.earnPerReferral !== null &&
      param.earnPerReferral !== ''
        ? param.earnPerReferral
        : 0,
    referralLimit:
      param && param.referralLimit && param.referralLimit !== null && param.referralLimit !== ''
        ? param.referralLimit
        : 0,
    whoEarnReferral: param.whoEarnReferral,
    referralTitle: param.referralTitle,
    referralMessage: param.referralMessage,
    referralTranslations: param.referralTranslations,
    userLoginWith: param.userLoginWith,
    userResetPasswordWith: param.userResetPasswordWith,
    signUpVerification: param.signUpVerification,
    signUpVerifyWith: param.signUpVerifyWith,
    canEarnLoyaltyPointOnOrder: param.canEarnLoyaltyPointOnOrder,
    loyaltyMinOrderTotal:
      param &&
      param.loyaltyMinOrderTotal &&
      param.loyaltyMinOrderTotal !== null &&
      param.loyaltyMinOrderTotal !== ''
        ? param.loyaltyMinOrderTotal
        : 0,
    loyaltyPointValue:
      param &&
      param.loyaltyPointValue &&
      param.loyaltyPointValue !== null &&
      param.loyaltyPointValue !== ''
        ? param.loyaltyPointValue
        : 0,
    minLoyaltyPointToRedeem:
      param &&
      param.minLoyaltyPointToRedeem &&
      param.minLoyaltyPointToRedeem !== null &&
      param.minLoyaltyPointToRedeem !== ''
        ? param.minLoyaltyPointToRedeem
        : 0,
    priceOfOneLoyaltyPoint:
      param &&
      param.priceOfOneLoyaltyPoint &&
      param.priceOfOneLoyaltyPoint !== null &&
      param.priceOfOneLoyaltyPoint !== ''
        ? param.priceOfOneLoyaltyPoint
        : 0,
  });
  const details = await UserSettings.create(settingData);
  return { id: details.id, success: true };
};

const getSettingsId = async (id) => {
  return UserSettings.findById(id);
};

const getSettings = async () => {
  const settings = await UserSettings.findOne();
  return settings;
};

const updateSettings = async (settingId, param) => {
  const settings = await getSettingsId(settingId);
  if (!settings) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const settingsData = {
    canEarnBuyFromWallet: param.canEarnBuyFromWallet,
    refundToWallet: param.refundToWallet,
    canAddFundToWallet: param.canAddFundToWallet,
    canEarnBuyFromReferral: param.canEarnBuyFromReferral,
    earnPerReferral:
      param &&
      param.earnPerReferral &&
      param.earnPerReferral !== null &&
      param.earnPerReferral !== ''
        ? param.earnPerReferral
        : 0,
    referralLimit:
      param && param.referralLimit && param.referralLimit !== null && param.referralLimit !== ''
        ? param.referralLimit
        : 0,
    whoEarnReferral: param.whoEarnReferral,
    referralTitle: param.referralTitle,
    referralMessage: param.referralMessage,
    referralTranslations: param.referralTranslations,
    userLoginWith: param.userLoginWith,
    userResetPasswordWith: param.userResetPasswordWith,
    signUpVerification: param.signUpVerification,
    signUpVerifyWith: param.signUpVerifyWith,
    canEarnLoyaltyPointOnOrder: param.canEarnLoyaltyPointOnOrder,
    loyaltyMinOrderTotal:
      param &&
      param.loyaltyMinOrderTotal &&
      param.loyaltyMinOrderTotal !== null &&
      param.loyaltyMinOrderTotal !== ''
        ? param.loyaltyMinOrderTotal
        : 0,
    loyaltyPointValue:
      param &&
      param.loyaltyPointValue &&
      param.loyaltyPointValue !== null &&
      param.loyaltyPointValue !== ''
        ? param.loyaltyPointValue
        : 0,
    minLoyaltyPointToRedeem:
      param &&
      param.minLoyaltyPointToRedeem &&
      param.minLoyaltyPointToRedeem !== null &&
      param.minLoyaltyPointToRedeem !== ''
        ? param.minLoyaltyPointToRedeem
        : 0,
    priceOfOneLoyaltyPoint:
      param &&
      param.priceOfOneLoyaltyPoint &&
      param.priceOfOneLoyaltyPoint !== null &&
      param.priceOfOneLoyaltyPoint !== ''
        ? param.priceOfOneLoyaltyPoint
        : 0,
  };

  Object.assign(settings, settingsData);
  await settings.save();
  return { success: true };
};

const getUserSettingsPublic = async () => {
  const settings = await UserSettings.findOne(
    {},
    {
      canEarnBuyFromReferral: 1,
      userLoginWith: 1,
      userResetPasswordWith: 1,
      signUpVerification: 1,
      _id: 0,
    }
  );
  return settings;
};

const getVerificationDetail = async () => {
  const settings = await UserSettings.findOne({}, { signUpVerifyWith: 1, _id: 0 });
  return settings;
};

const getLoyaltySettings = async () => {
  const settings = await UserSettings.findOne(
    {},
    { canEarnLoyaltyPointOnOrder: 1, loyaltyMinOrderTotal: 1, loyaltyPointValue: 1 }
  );
  return settings;
};

const getVerificationStatus = async () => {
  const settings = await UserSettings.findOne({}, { signUpVerification: 1, _id: 0 });
  return settings;
};

module.exports = {
  createSettings,
  updateSettings,
  getSettings,
  getUserSettingsPublic,
  getVerificationDetail,
  getLoyaltySettings,
  getVerificationStatus,
};

