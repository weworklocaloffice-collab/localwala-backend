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

/**
 * jhatka.partner.subscriptions.validation.js — Joi schemas for subscriptions.
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const subscriptionParam = {
  params: Joi.object().keys({
    subscription: objectId.required(),
  }),
};

const occurrenceParam = {
  params: Joi.object().keys({
    occurrence: objectId.required(),
  }),
};

const itemsBody = {
  body: Joi.object()
    .keys({
      items: Joi.array().min(1).required(),
      reason: Joi.string().trim().min(3).required(),
    })
    .unknown(true),
};

const pauseBody = {
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(3).required(),
    })
    .unknown(true),
};

const cancelBody = {
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(3).required(),
    })
    .unknown(true),
};

const skipBody = {
  body: Joi.object()
    .keys({
      occurrenceDate: Joi.date(),
      reason: Joi.string(),
    })
    .unknown(true),
};

const generateBody = {
  body: Joi.object()
    .keys({
      occurrenceDate: Joi.date().required(),
    })
    .unknown(true),
};

const subscriptionCreateBody = {
  body: Joi.object()
    .keys({
      items: Joi.array().min(1).required(),
      scheduleType: Joi.string().valid('daily', 'alternate_days', 'weekly', 'custom_days').required(),
      customDays: Joi.array().items(Joi.number().integer().min(0).max(6)),
      intervalCount: Joi.number().integer().min(1),
      startDate: Joi.date().required(),
      endDate: Joi.date(),
      deliverySlot: Joi.object().unknown(true),
      paymentMode: Joi.string().valid('gateway', 'cod'),
      editCutoffHours: Joi.number().min(0),
    })
    .unknown(true),
};

module.exports = {
  subscriptionParam,
  occurrenceParam,
  itemsBody,
  pauseBody,
  cancelBody,
  skipBody,
  generateBody,
  subscriptionCreateBody,
};
