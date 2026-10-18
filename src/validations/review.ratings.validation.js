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

const saveReviewValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    orders: Joi.string().custom(objectId).required(),
    driver: Joi.string().custom(objectId).allow(null, ''),
    restaurant: Joi.string().custom(objectId).allow(null, ''),
    driverRate: Joi.number().allow(0, '', null).min(1).max(5),
    restaurantRate: Joi.number().allow(0, '', null).min(1).max(5),
    driverMessage: Joi.string().allow(null, ''),
    restaurantMessage: Joi.string().allow(null, ''),
    images: Joi.string().allow(null, ''),
    shortReview: Joi.string().allow(null, ''),
    product: Joi.array().items(
      Joi.object({
        id: Joi.string().custom(objectId),
        rate: Joi.number().min(1).max(5),
        message: Joi.string().allow(null, ''),
      })
    ),
  }),
};

const savePublicRestaurantReviewValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).allow(null, ''),
    restaurantRate: Joi.number().allow(0, '', null).min(1).max(5),
    restaurantMessage: Joi.string().allow(null, ''),
    images: Joi.string().allow(null, ''),
    shortReview: Joi.string().allow(null, ''),
  }),
};

const getMyReviewListValidation = {
  params: Joi.object().keys({
    uid: Joi.string().custom(objectId).required(),
  }),
};

const getDeliverymanReviewValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    id: Joi.string().custom(objectId).required(),
  }),
};

const restaurantReviewValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

module.exports = {
  saveReviewValidation,
  savePublicRestaurantReviewValidation,
  getMyReviewListValidation,
  getDeliverymanReviewValidation,
  restaurantReviewValidation,
};

