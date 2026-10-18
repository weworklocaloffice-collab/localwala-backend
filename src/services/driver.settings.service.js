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
const { DriverSettings } = require('../models');
const ApiError = require('../utils/ApiError');

const createSettings = async (param) => {
  if ((await DriverSettings.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const settingData = new DriverSettings({
    driverLoginWith: param.driverLoginWith,
    driverResetPasswordWith: param.driverResetPasswordWith,
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
    getTip: param.getTip,
    showEarning: param.showEarning,
    maxOrderLimit: param.maxOrderLimit,
    pickupProof: param.pickupProof,
    deliveryProof: param.deliveryProof,
    canInitiateChat: param.canInitiateChat,
    canInitiateCall: param.canInitiateCall,
    earningModel:
      param && param.earningModel && param.earningModel !== null && param.earningModel !== ''
        ? param.earningModel
        : 'salaried',
    earningOnOrder:
      param && param.earningOnOrder && param.earningOnOrder !== null && param.earningOnOrder !== ''
        ? param.earningOnOrder
        : 'fixed',
    salaryAmount:
      param && param.salaryAmount && param.salaryAmount !== null && param.salaryAmount !== ''
        ? param.salaryAmount
        : 0,
    distanceRadiusForFixed:
      param &&
      param.distanceRadiusForFixed &&
      param.distanceRadiusForFixed !== null &&
      param.distanceRadiusForFixed !== ''
        ? param.distanceRadiusForFixed
        : 10,
    earningFixedDistanceAmount:
      param &&
      param.earningFixedDistanceAmount &&
      param.earningFixedDistanceAmount !== null &&
      param.earningFixedDistanceAmount !== ''
        ? param.earningFixedDistanceAmount
        : 0,
    earningAmount:
      param && param.earningAmount && param.earningAmount !== null && param.earningAmount !== ''
        ? param.earningAmount
        : 0,
    earningSurplusDistanceAmount:
      param &&
      param.earningSurplusDistanceAmount &&
      param.earningSurplusDistanceAmount !== null &&
      param.earningSurplusDistanceAmount !== ''
        ? param.earningSurplusDistanceAmount
        : 0,
    haveIncentive:
      param && param.haveIncentive !== null && param.haveIncentive !== ''
        ? param.haveIncentive
        : false,
  });
  const details = await DriverSettings.create(settingData);
  return { id: details.id, success: true };
};

const getSettingsId = async (id) => {
  return DriverSettings.findById(id);
};

const getSettings = async () => {
  const settings = await DriverSettings.findOne();
  return settings;
};

const updateSettings = async (settingId, param) => {
  const settings = await getSettingsId(settingId);
  if (!settings) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const settingsData = {
    driverLoginWith: param.driverLoginWith,
    driverResetPasswordWith: param.driverResetPasswordWith,
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
    getTip: param.getTip,
    showEarning: param.showEarning,
    maxOrderLimit: param.maxOrderLimit,
    pickupProof: param.pickupProof,
    deliveryProof: param.deliveryProof,
    canInitiateChat: param.canInitiateChat,
    canInitiateCall: param.canInitiateCall,
    earningModel:
      param && param.earningModel && param.earningModel !== null && param.earningModel !== ''
        ? param.earningModel
        : 'salaried',
    earningOnOrder:
      param && param.earningOnOrder && param.earningOnOrder !== null && param.earningOnOrder !== ''
        ? param.earningOnOrder
        : 'fixed',
    salaryAmount:
      param && param.salaryAmount && param.salaryAmount !== null && param.salaryAmount !== ''
        ? param.salaryAmount
        : 0,
    distanceRadiusForFixed:
      param &&
      param.distanceRadiusForFixed &&
      param.distanceRadiusForFixed !== null &&
      param.distanceRadiusForFixed !== ''
        ? param.distanceRadiusForFixed
        : 10,
    earningFixedDistanceAmount:
      param &&
      param.earningFixedDistanceAmount &&
      param.earningFixedDistanceAmount !== null &&
      param.earningFixedDistanceAmount !== ''
        ? param.earningFixedDistanceAmount
        : 0,
    earningAmount:
      param && param.earningAmount && param.earningAmount !== null && param.earningAmount !== ''
        ? param.earningAmount
        : 0,
    earningSurplusDistanceAmount:
      param &&
      param.earningSurplusDistanceAmount &&
      param.earningSurplusDistanceAmount !== null &&
      param.earningSurplusDistanceAmount !== ''
        ? param.earningSurplusDistanceAmount
        : 0,
    haveIncentive:
      param && param.haveIncentive !== null && param.haveIncentive !== ''
        ? param.haveIncentive
        : false,
  };

  Object.assign(settings, settingsData);
  await settings.save();
  return { success: true };
};

const driverPublicSettings = async () => {
  const settings = await DriverSettings.findOne(
    {},
    {
      driverLoginWith: 1,
      driverResetPasswordWith: 1,
      selfRegistration: 1,
      _id: 0,
    }
  );
  return settings;
};

const driverSelfRegistration = async () => {
  const settings = await DriverSettings.findOne({}, { selfRegistration: 1, _id: 0 });
  return settings;
};

module.exports = {
  createSettings,
  updateSettings,
  getSettings,
  driverPublicSettings,
  driverSelfRegistration,
};

