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

const visitorTrackingValidation = {
  body: Joi.object().keys({
    agent: Joi.string().required(),
    userTrackingId: Joi.string().custom(objectId).allow('', null),
  }),
};

const nearMeRestaurants = {
  body: Joi.object().keys({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const restaurantsByCuisine = {
  body: Joi.object().keys({
    cuisine: Joi.string().required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const restaurantsByCategory = {
  body: Joi.object().keys({
    category: Joi.string().required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const restaurantsFoodsByCategory = {
  body: Joi.object().keys({
    category: Joi.string().required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const restaurantsByBrands = {
  body: Joi.object().keys({
    outlet: Joi.string().required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const restaurantsByLocalities = {
  body: Joi.object().keys({
    from: Joi.string().custom(objectId).required(),
    slug: Joi.string().required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const getRestaurantInfo = {
  body: Joi.object().keys({
    slug: Joi.string().required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const globalSearchInitial = {
  body: Joi.object().keys({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }),
};

const globalSearch = {
  body: Joi.object().keys({
    searchQuery: Joi.string().required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }),
};

const foodSearchInitial = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const foodSearch = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    uid: Joi.string().custom(objectId).allow('', null),
    searchQuery: Joi.string().required(),
  }),
};

const restaurantReview = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

const foodReview = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

const nearMeDiningRestaurants = {
  body: Joi.object().keys({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const nearMeDiningRestaurantOnMap = {
  body: Joi.object().keys({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }),
};

const diningByCategory = {
  body: Joi.object().keys({
    category: Joi.string().required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const restaurantDetailInformation = {
  body: Joi.object().keys({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    slug: Joi.string().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const diningBookingInformationValidation = {
  body: Joi.object().keys({
    slug: Joi.string().required(),
    id: Joi.string().custom(objectId).required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }),
};

const fetchRestaurantCallNumberValidation = {
  params: Joi.object().keys({
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const cityValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  visitorTrackingValidation,
  nearMeRestaurants,
  restaurantsByCuisine,
  restaurantsByCategory,
  restaurantsFoodsByCategory,
  restaurantsByBrands,
  getRestaurantInfo,
  restaurantsByLocalities,
  globalSearch,
  globalSearchInitial,
  foodSearchInitial,
  foodSearch,
  restaurantReview,
  foodReview,
  nearMeDiningRestaurants,
  nearMeDiningRestaurantOnMap,
  diningByCategory,
  restaurantDetailInformation,
  diningBookingInformationValidation,
  fetchRestaurantCallNumberValidation,
  cityValidation,
};

