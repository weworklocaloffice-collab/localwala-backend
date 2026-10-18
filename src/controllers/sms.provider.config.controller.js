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
const { smsProviderConfigService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await smsProviderConfigService.createConfig(req.body);
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const result = await smsProviderConfigService.updateSmsProviderConfig(req.params.slug, req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const result = await smsProviderConfigService.getSmsProviderBySlug(req.params.slug);
  res.send(result);
});

const sendTwilioDemoSMS = catchAsync(async (req, res) => {
  const { mobile, locale } = req.body;
  const result = await smsProviderConfigService.sendTwilioDemoSMS(mobile, locale);
  res.send(result);
});

const sendNexmoDemoSMS = catchAsync(async (req, res) => {
  const { mobile, locale } = req.body;
  const result = await smsProviderConfigService.sendNexmoDemoSMS(mobile, locale);
  res.send(result);
});

const sendSMStoDemoSMS = catchAsync(async (req, res) => {
  const { mobile, locale } = req.body;
  const result = await smsProviderConfigService.sendSMStoDemoSMS(mobile, locale);
  res.send(result);
});

const send2FactorDemoSMS = catchAsync(async (req, res) => {
  const { mobile, locale } = req.body;
  const result = await smsProviderConfigService.send2FactorDemoSMS(mobile, locale);
  res.send(result);
});

const sendFast2SMSDemoSMS = catchAsync(async (req, res) => {
  const { mobile, locale } = req.body;
  const result = await smsProviderConfigService.sendFast2SMSDemoSMS(mobile, locale);
  res.send(result);
});

module.exports = {
  create,
  update,
  get,
  sendTwilioDemoSMS,
  sendNexmoDemoSMS,
  sendSMStoDemoSMS,
  send2FactorDemoSMS,
  sendFast2SMSDemoSMS,
};

