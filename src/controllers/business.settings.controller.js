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

const catchAsync = require('../utils/catchAsync');
const {
  businessSettingsService,
  restaurantSettingsService,
  languageService,
  socialSigninService,
  appWebSettingService,
  mediaStorageSettingService,
} = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await businessSettingsService.createSettings(req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const result = await businessSettingsService.getSettings();
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const result = await businessSettingsService.updateSettings(req.params.businessId, req.body);
  res.send(result);
});

const getVendorSettings = catchAsync(async (req, res) => {
  const business = await businessSettingsService.getVendorBusinessSetting();
  const vendor = await restaurantSettingsService.getVendorSettings();
  const language = await languageService.getDefaultLanguage();
  const socialSignin = await socialSigninService.publicSocialSignin();
  const appVersion = await appWebSettingService.vendorAppVersionDetail();
  const imagePath = await mediaStorageSettingService.getFilePathUrl();
  res.send({ business, vendor, language, social: socialSignin, versions: appVersion, imagePath });
});

module.exports = {
  create,
  get,
  update,
  getVendorSettings,
};

