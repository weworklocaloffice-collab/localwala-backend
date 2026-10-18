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

const saveFavourite = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    type: Joi.string().required().allow('restaurant', 'food'),
    restaurant: Joi.string().custom(objectId).allow(null, ''),
    food: Joi.string().custom(objectId).allow(null, ''),
  }),
};

const getFavouriteRestaurants = {
  body: Joi.object().keys({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    uid: Joi.string().custom(objectId).required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

const getFavouriteFoods = {
  body: Joi.object().keys({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    uid: Joi.string().custom(objectId).required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

const deleteFavouriteFoodValidation = {
  params: Joi.object().keys({
    foodId: Joi.string().custom(objectId).required(),
    userId: Joi.string().custom(objectId).required(),
  }),
};

const deleteFavouriteRestaurantValidation = {
  params: Joi.object().keys({
    restaurantId: Joi.string().custom(objectId).required(),
    userId: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  saveFavourite,
  getFavouriteRestaurants,
  getFavouriteFoods,
  deleteFavouriteFoodValidation,
  deleteFavouriteRestaurantValidation,
};

