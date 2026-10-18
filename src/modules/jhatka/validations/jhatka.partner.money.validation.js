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
 * jhatka.partner.money.validation.js — Joi schemas for the money surface.
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const idParam = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};

const payoutGenerateBody = {
  body: Joi.object()
    .keys({
      periodStart: Joi.date().required(),
      periodEnd: Joi.date().required(),
      driverIds: Joi.array().items(objectId),
    })
    .unknown(true),
};

const payBody = {
  body: Joi.object()
    .keys({
      paymentReference: Joi.string(),
      notes: Joi.string(),
    })
    .unknown(true),
};

const commissionRuleBody = {
  body: Joi.object()
    .keys({
      // Rate is BASIS POINTS here (100 bps = 1%) — not the percent the
      // admin taxonomy endpoint takes. Mixing the two is a 100x payout bug.
      type: Joi.string().required(),
      rateBps: Joi.number().integer().min(0).required(),
      minOrderValuePaise: Joi.number().integer().min(0),
      maxOrderValuePaise: Joi.number().integer().min(0),
      outlet: objectId,
      variant: objectId,
      priority: Joi.number().integer(),
      validFrom: Joi.date(),
      validUntil: Joi.date(),
      description: Joi.string(),
    })
    .unknown(true),
};

module.exports = {
  idParam,
  payoutGenerateBody,
  payBody,
  commissionRuleBody,
};