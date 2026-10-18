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
const { WaiterSettings } = require('../models');
const ApiError = require('../utils/ApiError');

const createSettings = async (param) => {
  if ((await WaiterSettings.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const settingData = new WaiterSettings({
    waiterLoginWith: param.waiterLoginWith,
    waiterResetPasswordWith: param.waiterResetPasswordWith,
    getTip: param.getTip,
  });
  const details = await WaiterSettings.create(settingData);
  return { id: details.id, success: true };
};

const getSettings = async () => {
  const settings = await WaiterSettings.findOne();
  return settings;
};

const updateSettings = async (settingId, param) => {
  const settings = await WaiterSettings.findById(settingId);
  if (!settings) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const settingsData = {
    waiterLoginWith: param.waiterLoginWith,
    waiterResetPasswordWith: param.waiterResetPasswordWith,
    getTip: param.getTip,
  };

  Object.assign(settings, settingsData);
  await settings.save();
  return { success: true };
};

module.exports = {
  createSettings,
  getSettings,
  updateSettings,
};

