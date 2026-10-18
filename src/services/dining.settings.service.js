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
const { DiningSetting } = require('../models');
const ApiError = require('../utils/ApiError');

const createDiningSettings = async (param) => {
  if ((await DiningSetting.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const details = await DiningSetting.create(param);
  return { id: details.id, success: true };
};

const getDiningSetting = async () => {
  return DiningSetting.findOne();
};

const updateDiningSetting = async (slug, param) => {
  const diningSetting = await getDiningSetting(slug);

  Object.assign(diningSetting, param);
  await diningSetting.save();
  return { success: true };
};

const getDiningSettingForVendor = async () => {
  const detail = await DiningSetting.findOne({}, { restaurantCanAddOffers: 1 });
  return detail;
};

module.exports = {
  createDiningSettings,
  getDiningSetting,
  updateDiningSetting,
  getDiningSettingForVendor,
};

