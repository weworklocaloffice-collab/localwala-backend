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
const { password, objectId } = require('./custom.validation');

const createWaiter = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    image: Joi.string().required(),
    restaurant: Joi.string().custom(objectId).required(),
    gender: Joi.string().required(),
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

const restaurantValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    waiterId: Joi.string().custom(objectId).required(),
  }),
};

const updateWaiterInfoValidation = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    image: Joi.string().required(),
    gender: Joi.string().required(),
  }),
};

const updateWaiterStatusValidation = {
  params: Joi.object().keys({
    waiterId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    status: Joi.boolean().required(),
  }),
};

const foodListValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const foodListForOrderValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const waiterInitialFoodValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const waiterFoodSearchValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
    searchQuery: Joi.string().required(),
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
  createWaiter,
  restaurantValidation,
  allValidation,
  idValidation,
  updateWaiterInfoValidation,
  updateWaiterStatusValidation,
  foodListValidation,
  foodListForOrderValidation,
  waiterInitialFoodValidation,
  waiterFoodSearchValidation,
  exportValidation,
  cityMasterValidation,
};

