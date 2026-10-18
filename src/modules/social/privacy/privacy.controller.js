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
const catchAsync = require('../../../utils/catchAsync');
const privacyService = require('./privacy.service');

const resolveUserId = (req) => req.user._id || req.user.id;

const get = catchAsync(async (req, res) => {
  const row = await privacyService.getOrCreate(resolveUserId(req));
  res.status(httpStatus.OK).send(row);
});

const update = catchAsync(async (req, res) => {
  const row = await privacyService.updatePrivacy(resolveUserId(req), req.body);
  res.status(httpStatus.OK).send(row);
});

module.exports = {
  get,
  update,
};
