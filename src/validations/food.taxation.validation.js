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

const saveFoodTaxationValidation = {
  body: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
    taxName: Joi.string().required(),
    taxAmount: Joi.number().required(),
    translation: Joi.allow(),
  }),
};

const restaurantValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const updateValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
    taxName: Joi.string().required(),
    taxAmount: Joi.number().required(),
    translation: Joi.allow(),
  }),
};

const deleteValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const deleteAdminValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const getAllMyTaxationValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const allValidation = {
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

const cityMasterValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

module.exports = {
  saveFoodTaxationValidation,
  restaurantValidation,
  updateValidation,
  deleteValidation,
  deleteAdminValidation,
  getAllMyTaxationValidation,
  allValidation,
  exportValidation,
  cityMasterValidation,
};

