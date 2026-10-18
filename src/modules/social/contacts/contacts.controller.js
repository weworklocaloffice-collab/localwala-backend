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
const contactsService = require('./contacts.service');

const resolveUserId = (req) => req.user._id || req.user.id;

const sync = catchAsync(async (req, res) => {
  const result = await contactsService.syncContacts(resolveUserId(req), req.body.contacts);
  res.status(httpStatus.OK).send(result);
});

module.exports = {
  sync,
};
