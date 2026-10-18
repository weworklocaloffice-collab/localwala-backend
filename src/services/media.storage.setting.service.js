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
const { MediaStorageSetting } = require('../models');
const ApiError = require('../utils/ApiError');

const createMediaStorageSetting = async (param) => {
  if ((await MediaStorageSetting.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const details = await MediaStorageSetting.create(param);
  return { id: details.id, success: true };
};

const getMediaStorageSetting = async () => {
  const result = await MediaStorageSetting.findOne();
  return result;
};

const updateMediaStorageSetting = async (slug, param) => {
  const result = await getMediaStorageSetting(slug);

  Object.assign(result, param);
  await result.save();
  return { success: true };
};

const getFilePathUrl = async () => {
  const result = await MediaStorageSetting.findOne({}, { id: 1, imagePath: 1 });
  if (result && result !== null && result.id && result.id !== null && result.id !== '') {
    return result.imagePath;
  }
  return 'none';
};

module.exports = {
  createMediaStorageSetting,
  getMediaStorageSetting,
  updateMediaStorageSetting,
  getFilePathUrl,
};

