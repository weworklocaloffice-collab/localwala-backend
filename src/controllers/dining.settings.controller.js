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
  diningSettingsService,
  diningCancellationReasonService,
  diningCategoryService,
  diningNoticeService,
} = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await diningSettingsService.createDiningSettings(req.body);
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const result = await diningSettingsService.updateDiningSetting(req.params.id, req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const settings = await diningSettingsService.getDiningSetting();
  const reasons = await diningCancellationReasonService.getDiningCancallationListAdmin(options);
  const categories = await diningCategoryService.getAllCategoryAdmin(options);
  const notice = await diningNoticeService.getList(options);
  res.send({ settings, reasons, categories, notice });
});

const getDiningSettingForVendor = catchAsync(async (req, res) => {
  const result = await diningSettingsService.getDiningSettingForVendor();
  res.send(result);
});

module.exports = {
  create,
  update,
  get,
  getDiningSettingForVendor,
};

