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

const payBody = {
  body: Joi.object()
    .keys({
      paymentReference: Joi.string(),
      notes: Joi.string(),
    })
    .unknown(true),
};

module.exports = {
  idParam,
  payBody,
};