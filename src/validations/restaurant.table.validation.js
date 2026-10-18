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

const createRestaurantTable = {
  body: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
    tableNumber: Joi.number().required(),
    capacity: Joi.number().required(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const updateTableStatusValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    status: Joi.boolean().required(),
  }),
};

const updateTableValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
    tableNumber: Joi.number().required(),
    capacity: Joi.number().required(),
  }),
};

const listValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const waiterTableListValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const vendorTableQrDetailValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  createRestaurantTable,
  idValidation,
  listValidation,
  updateTableStatusValidation,
  updateTableValidation,
  waiterTableListValidation,
  vendorTableQrDetailValidation,
};

