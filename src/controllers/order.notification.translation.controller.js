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
const { orderNotificationTranslationService } = require('../services');

const getBySlug = catchAsync(async (req, res) => {
  const result = await orderNotificationTranslationService.getBySlug(req.params.slug);
  res.send(result);
});

const createOrUpdate = catchAsync(async (req, res) => {
  const result = await orderNotificationTranslationService.saveOrderNotificationTranslation(
    req.body
  );
  res.send(result);
});

module.exports = { getBySlug, createOrUpdate };

