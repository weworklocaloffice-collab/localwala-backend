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
const { kitchenOwnerSettingService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await kitchenOwnerSettingService.createSettings(req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const settings = await kitchenOwnerSettingService.getSettings();
  res.send({ settings });
});

const update = catchAsync(async (req, res) => {
  const result = await kitchenOwnerSettingService.updateSettings(req.params.settingId, req.body);
  res.send(result);
});

module.exports = {
  create,
  get,
  update,
};

