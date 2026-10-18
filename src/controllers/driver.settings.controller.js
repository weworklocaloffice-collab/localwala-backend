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
  driverSettingsService,
  deliveryInstructionsService,
  deliveryGratitudeService,
  driverIncentiveService,
  driverOfflineMessagesService,
} = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await driverSettingsService.createSettings(req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const settings = await driverSettingsService.getSettings();
  const options = pick(req.query, ['limit', 'page']);
  const instruction = await deliveryInstructionsService.getDeliveryInstructionListAdmin(options);
  const gratitude = await deliveryGratitudeService.getGratitudeListAdmin(options);
  const incentives = await driverIncentiveService.getIncentiveListAdmin(options);
  const offlines = await driverOfflineMessagesService.getOfflineMessageListAdmin(options);
  res.send({ settings, instruction, gratitude, incentives, offlines });
});

const update = catchAsync(async (req, res) => {
  const result = await driverSettingsService.updateSettings(req.params.settingId, req.body);
  res.send(result);
});

module.exports = {
  create,
  get,
  update,
};

