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
const { userNotificationSettingService } = require('../services');

const getNotificationSettings = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userNotificationSettingService.getNotificationSettings(id);
  res.send(result);
});

const updateNotificationSetting = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userNotificationSettingService.updateNotificationSetting(id, req.body);
  res.send(result);
});

module.exports = {
  getNotificationSettings,
  updateNotificationSetting,
};

