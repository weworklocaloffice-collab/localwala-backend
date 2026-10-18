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
const { KitchenOwnerSetting } = require('../models');
const ApiError = require('../utils/ApiError');

const createSettings = async (param) => {
  if ((await KitchenOwnerSetting.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const settingData = new KitchenOwnerSetting({
    ownerLoginWith: param.ownerLoginWith,
    ownerResetPasswordWith: param.ownerResetPasswordWith,
  });
  const details = await KitchenOwnerSetting.create(settingData);
  return { id: details.id, success: true };
};

const getSettings = async () => {
  const settings = await KitchenOwnerSetting.findOne();
  return settings;
};

const updateSettings = async (settingId, param) => {
  const settings = await KitchenOwnerSetting.findById(settingId);
  if (!settings) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const settingsData = {
    ownerLoginWith: param.ownerLoginWith,
    ownerResetPasswordWith: param.ownerResetPasswordWith,
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

