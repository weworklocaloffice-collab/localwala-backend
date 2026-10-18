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
const { emailConfigService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await emailConfigService.createEmailConfig(req.body);
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const result = await emailConfigService.updateEmailConfig(req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const result = await emailConfigService.getEmailConfig();
  res.send(result);
});

const sendDemoMail = catchAsync(async (req, res) => {
  const result = await emailConfigService.sendDemoMail(req.params.email);
  res.send(result);
});

const sendVerificationEmail = catchAsync(async (req, res) => {
  const result = await emailConfigService.sendVerificationEmail(
    req.params.email,
    req.params.locale
  );
  res.send(result);
});

const emailMediaConfig = catchAsync(async (req, res) => {
  const result = await emailConfigService.emailMediaConfig();
  res.send(result);
});

const saveEmailMediaConfig = catchAsync(async (req, res) => {
  const { mediaUrls } = req.body;
  const result = await emailConfigService.saveEmailMediaConfig(mediaUrls);
  res.send(result);
});

module.exports = {
  create,
  update,
  get,
  sendDemoMail,
  sendVerificationEmail,
  emailMediaConfig,
  saveEmailMediaConfig,
};

