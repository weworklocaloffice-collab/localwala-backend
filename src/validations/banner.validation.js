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

const createBanner = {
  body: Joi.object().keys({
    title: Joi.string().required(),
    type: Joi.string().required().allow('restaurant', 'food', 'external'),
    city: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).allow(null, ''),
    food: Joi.string().custom(objectId).allow(null, ''),
    image: Joi.string().required(),
    external: Joi.string().allow(null, ''),
    translations: Joi.allow(),
  }),
};

const cityzenCreateBanner = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    title: Joi.string().required(),
    type: Joi.string().required().allow('restaurant', 'food', 'external'),
    restaurant: Joi.string().custom(objectId).allow(null, ''),
    food: Joi.string().custom(objectId).allow(null, ''),
    image: Joi.string().required(),
    external: Joi.string().allow(null, ''),
    translations: Joi.allow(),
  }),
};

// Banner routes use `:bannerId`, not `:id` — see admin.route.js and cityzen.route.js.
const idValidation = {
  params: Joi.object().keys({
    bannerId: Joi.string().custom(objectId),
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

const cityzenUpdateValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
    bannerId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    title: Joi.string().allow(null, ''),
    type: Joi.string().allow('restaurant', 'food', 'external'),
    image: Joi.string().allow(null, ''),
    restaurant: Joi.string().custom(objectId).allow(null, ''),
    food: Joi.string().custom(objectId).allow(null, ''),
    external: Joi.string().allow(null, ''),
    translations: Joi.allow(),
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
    status: Joi.boolean().required(),
  }),
};

module.exports = {
  createBanner,
  cityzenCreateBanner,
  idValidation,
  cityMasterValidation,
  cityzenUpdateValidation,
  allValidation,
  exportValidation,
};
