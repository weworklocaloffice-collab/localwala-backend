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
 * jhatka.catalogue.validation.js — Joi schemas for catalogue + public browse.
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const idParam = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};

const categoryParam = {
  params: Joi.object().keys({
    category: objectId.required(),
  }),
};

const variantParam = {
  params: Joi.object().keys({
    variant: objectId.required(),
  }),
};

const variantIdParam = {
  params: Joi.object().keys({
    variantId: objectId.required(),
  }),
};

const nearbyQuery = {
  query: Joi.object().keys({
    lat: Joi.number().min(-90).max(90).required(),
    lng: Joi.number().min(-180).max(180).required(),
    radiusKm: Joi.number().positive().max(50),
  }),
};

module.exports = {
  idParam,
  categoryParam,
  variantParam,
  variantIdParam,
  nearbyQuery,
};
