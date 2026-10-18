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
const { pushNotificationTokenService } = require('../services');

const save = catchAsync(async (req, res) => {
  const result = await pushNotificationTokenService.savePushNotificationToken(req.body);
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const result = await pushNotificationTokenService.updatePushNotificationToken(req.body);
  res.send(result);
});

module.exports = {
  save,
  update,
};

