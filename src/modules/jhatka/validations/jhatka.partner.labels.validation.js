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
 * jhatka.partner.labels.validation.js — Joi schemas for the label surface.
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const labelParam = {
  params: Joi.object().keys({
    label: objectId.required(),
  }),
};

const labelCreateBody = {
  body: Joi.object()
    .keys({
      order: objectId.required(),
      items: Joi.array().min(1).required(),
      storageInstruction: Joi.string(),
      customerCare: Joi.string(),
      qrImageUrl: Joi.string(),
    })
    .unknown(true),
};

const voidBody = {
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(3).required(),
    })
    .unknown(true),
};

module.exports = {
  labelParam,
  labelCreateBody,
  voidBody,
};
