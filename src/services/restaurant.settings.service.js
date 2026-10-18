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
const { RestaurantSettings } = require('../models');
const ApiError = require('../utils/ApiError');

const createSettings = async (param) => {
  if ((await RestaurantSettings.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const settingData = new RestaurantSettings({
    restaurantLoginWith: param.restaurantLoginWith,
    restaurantResetPasswordWith: param.restaurantResetPasswordWith,
    selfRegistration: param.selfRegistration,
    cashInHand: param.cashInHand,
    minCashInHand:
      param && param.minCashInHand && param.minCashInHand !== null && param.minCashInHand !== ''
        ? param.minCashInHand
        : 0,
    maxCashInHand:
      param && param.maxCashInHand && param.maxCashInHand !== null && param.maxCashInHand !== ''
        ? param.maxCashInHand
        : 0,
    driverPickup: param.driverPickup,
    platformDriverPickup: param.platformDriverPickup,
    canInitiateChat: param.canInitiateChat,
    canInitiateCall: param.canInitiateCall,
    havePackagingCharges: param.havePackagingCharges,
    packagingCharges:
      param &&
      param.packagingCharges &&
      param.packagingCharges !== null &&
      param.packagingCharges !== ''
        ? param.packagingCharges
        : 0,
    includePackagesChargesInTax: param.includePackagesChargesInTax,
    packagingChargesTax:
      param &&
      param.packagingChargesTax &&
      param.packagingChargesTax !== null &&
      param.packagingChargesTax !== ''
        ? param.packagingChargesTax
        : 0,
  });
  const details = await RestaurantSettings.create(settingData);
  return { id: details.id, success: true };
};

const getSettingsId = async (id) => {
  return RestaurantSettings.findById(id);
};

const getSettings = async () => {
  const settings = await RestaurantSettings.findOne();
  return settings;
};

const getVendorSettings = async () => {
  const settings = await RestaurantSettings.findOne(
    {},
    { restaurantLoginWith: 1, restaurantResetPasswordWith: 1, selfRegistration: 1, _id: 0 }
  );
  return settings;
};

const vendorSelfRegistration = async () => {
  const settings = await RestaurantSettings.findOne({}, { selfRegistration: 1, _id: 0 });
  return settings;
};

const updateSettings = async (settingId, param) => {
  const settings = await getSettingsId(settingId);
  if (!settings) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const settingsData = {
    restaurantLoginWith: param.restaurantLoginWith,
    restaurantResetPasswordWith: param.restaurantResetPasswordWith,
    selfRegistration: param.selfRegistration,
    cashInHand: param.cashInHand,
    minCashInHand:
      param && param.minCashInHand && param.minCashInHand !== null && param.minCashInHand !== ''
        ? param.minCashInHand
        : 0,
    maxCashInHand:
      param && param.maxCashInHand && param.maxCashInHand !== null && param.maxCashInHand !== ''
        ? param.maxCashInHand
        : 0,
    driverPickup: param.driverPickup,
    platformDriverPickup: param.platformDriverPickup,
    canInitiateChat: param.canInitiateChat,
    canInitiateCall: param.canInitiateCall,
    havePackagingCharges: param.havePackagingCharges,
    packagingCharges:
      param &&
      param.packagingCharges &&
      param.packagingCharges !== null &&
      param.packagingCharges !== ''
        ? param.packagingCharges
        : 0,
    includePackagesChargesInTax: param.includePackagesChargesInTax,
    packagingChargesTax:
      param &&
      param.packagingChargesTax &&
      param.packagingChargesTax !== null &&
      param.packagingChargesTax !== ''
        ? param.packagingChargesTax
        : 0,
  };

  Object.assign(settings, settingsData);
  await settings.save();
  return { success: true };
};

module.exports = {
  createSettings,
  updateSettings,
  getSettings,
  getVendorSettings,
  vendorSelfRegistration,
};

