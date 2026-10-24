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

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const paymentMode = Joi.string().valid(
  'full_prepay',
  'deposit',
  'pay_after',
  'cod',
  'wallet',
  'quote_schedule'
);

const policyBody = {
  body: Joi.object()
    .keys({
      code: Joi.string().max(64).required(),
      name: Joi.string().max(200).required(),
      description: Joi.string().max(2000).allow('', null),
      categoryKey: Joi.string().max(64).allow('', null),
      subcategoryKey: Joi.string().max(64).allow('', null),
      serviceKey: Joi.string().max(64).allow('', null),
      provider: objectId.allow(null),
      cancellationCutoffHours: Joi.number().min(0).max(720),
      cancellationFee: Joi.number().min(0).max(10000000),
      providerCancellationRefundable: Joi.boolean(),
      rescheduleCutoffHours: Joi.number().min(0).max(720),
      rescheduleCountLimit: Joi.number().integer().min(0).max(20),
      quoteExpiryHours: Joi.number().min(1).max(720),
      quoteMaxExpiryHours: Joi.number().min(1).max(2160),
      advanceBookingDays: Joi.number().min(0).max(365),
      minNoticeHours: Joi.number().min(0).max(720),
      depositPercent: Joi.number().min(0).max(100),
      taxPercent: Joi.number().min(0).max(100),
      taxLabel: Joi.string().max(64),
      allowedPaymentModes: Joi.array().items(paymentMode),
      effectiveFrom: Joi.date(),
      effectiveTo: Joi.date(),
    })
    .unknown(false),
};

const updatePolicyBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      name: Joi.string().max(200),
      description: Joi.string().max(2000).allow('', null),
      cancellationCutoffHours: Joi.number().min(0).max(720),
      cancellationFee: Joi.number().min(0).max(10000000),
      providerCancellationRefundable: Joi.boolean(),
      rescheduleCutoffHours: Joi.number().min(0).max(720),
      rescheduleCountLimit: Joi.number().integer().min(0).max(20),
      quoteExpiryHours: Joi.number().min(1).max(720),
      quoteMaxExpiryHours: Joi.number().min(1).max(2160),
      advanceBookingDays: Joi.number().min(0).max(365),
      minNoticeHours: Joi.number().min(0).max(720),
      depositPercent: Joi.number().min(0).max(100),
      taxPercent: Joi.number().min(0).max(100),
      taxLabel: Joi.string().max(64),
      allowedPaymentModes: Joi.array().items(paymentMode),
      effectiveFrom: Joi.date(),
      effectiveTo: Joi.date(),
    })
    .min(1)
    .unknown(false),
};

const activatePolicyBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      effectiveFrom: Joi.date(),
      effectiveTo: Joi.date(),
    })
    .unknown(false),
};

const idParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const statusParam = {
  params: Joi.object().keys({ id: objectId.required(), status: Joi.string().required() }),
};

module.exports = { policyBody, updatePolicyBody, activatePolicyBody, idParam, statusParam };
