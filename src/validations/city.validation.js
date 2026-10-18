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
const { objectId, latitude, longitude } = require('./custom.validation');

const createCity = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    image: Joi.string().required(),
    latitude,
    longitude,
    type: Joi.string().required(),
    translations: Joi.allow(),
    defaultDeliveryRadiusMeters: Joi.number().integer().min(100).max(50000).allow(null, ''),
    maxZoneDiameterKm: Joi.number().min(1).max(100).allow(null, ''),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    cityId: Joi.string().custom(objectId),
  }),
};

const getAllCities = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    search: Joi.string().allow(null, ''),
  }),
};

module.exports = {
  createCity,
  idValidation,
  getAllCities,
  exportValidation,
};

