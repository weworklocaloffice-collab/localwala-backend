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
const { objectId } = require('./custom.validation');

/**
 * dispatch.metrics.validation.js — read-model validations (Batch E-2).
 *
 * Pure reads for dashboards; the strictness here is about rejecting nonsense
 * windows, not about trust (no writes ride on these).
 */
const metricsQuery = {
  query: Joi.object().keys({
    restaurantId: Joi.string().custom(objectId).allow(null, ''),
    since: Joi.date().iso().allow(null, ''),
    until: Joi.date().iso().allow(null, ''),
  }),
};

const zoneMetricsParams = {
  params: Joi.object().keys({
    cityId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    since: Joi.date().iso().allow(null, ''),
    until: Joi.date().iso().allow(null, ''),
    threshold: Joi.number().min(0).max(1).allow(null, ''),
  }),
};

const cityzenMetricsQuery = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    restaurantId: Joi.string().custom(objectId).allow(null, ''),
    since: Joi.date().iso().allow(null, ''),
    until: Joi.date().iso().allow(null, ''),
  }),
};

const cityzenZoneMetricsParams = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
    cityId: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    since: Joi.date().iso().allow(null, ''),
    until: Joi.date().iso().allow(null, ''),
    threshold: Joi.number().min(0).max(1).allow(null, ''),
  }),
};

module.exports = {
  metricsQuery,
  zoneMetricsParams,
  cityzenMetricsQuery,
  cityzenZoneMetricsParams,
};
