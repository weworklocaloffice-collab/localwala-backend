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
const { fcmNotificationService } = require('../services');

const test = catchAsync(async (req, res) => {
  res.send({ ok: true });
});

const adminSendNotification = catchAsync(async (req, res) => {
  const { to, title, description } = req.body;
  const result = await fcmNotificationService.adminSendNotification(to, title, description);
  res.send(result);
});

const cityzenSendNotificaiton = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { to, title, description } = req.body;
  const result = await fcmNotificationService.cityzenSendNotificaiton(id, to, title, description);
  res.send(result);
});

module.exports = {
  test,
  adminSendNotification,
  cityzenSendNotificaiton,
};

