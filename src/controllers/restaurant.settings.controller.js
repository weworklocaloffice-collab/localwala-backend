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
const pick = require('../utils/pick');
const {
  restaurantSettingsService,
  restaurantFoodLicenseService,
  restaurantNoticeService,
} = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await restaurantSettingsService.createSettings(req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const settings = await restaurantSettingsService.getSettings();
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const license = await restaurantFoodLicenseService.getRestaurantLicenseListAdmin(options);
  const notice = await restaurantNoticeService.getList(options);
  res.send({ settings, license, notice });
});

const update = catchAsync(async (req, res) => {
  const result = await restaurantSettingsService.updateSettings(req.params.settingId, req.body);
  res.send(result);
});

module.exports = {
  create,
  get,
  update,
};

