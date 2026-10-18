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

const hideRestaurantValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
    reason: Joi.string().custom(objectId).allow(null, ''),
  }),
};

const showRestaurantValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const updateHideReasonValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
    reason: Joi.string().custom(objectId).required(),
  }),
};

const getMyHiddenRestaurantsValidation = {
  body: Joi.object().keys({
    uid: Joi.string().custom(objectId).required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }),
};

module.exports = {
  hideRestaurantValidation,
  showRestaurantValidation,
  updateHideReasonValidation,
  getMyHiddenRestaurantsValidation,
};

