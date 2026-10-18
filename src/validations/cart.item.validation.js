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

const variationItemSchema = Joi.object({
  variation: Joi.string(),
  selected: Joi.array().items(Joi.string()),
});

const addItemToCartValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).allow(null, ''),
    trackingId: Joi.string().custom(objectId).required(),
    uuid: Joi.string(),
    addons: Joi.string().allow(null, ''),
    food: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
    quantity: Joi.number().required(),
    variations: Joi.array().items(variationItemSchema),
    campaignId: Joi.string().allow(null, ''),
    campaignType: Joi.string().allow(null, '').valid('food', 'restaurant'),
    cookingInstruction: Joi.string().allow(null, ''),
  }),
};

const removeCartItemByRestaurantValidation = {
  body: Joi.object().keys({
    trackingId: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const removeCartItemByTrackingValidation = {
  params: Joi.object().keys({
    trackingId: Joi.string().custom(objectId),
  }),
};

const removeFromCartWithUuidValidation = {
  body: Joi.object().keys({
    trackingId: Joi.string().custom(objectId).required(),
    uuid: Joi.string().required(),
    id: Joi.string().custom(objectId).required(),
  }),
};

const removeFromCartWithFoodIdValidation = {
  body: Joi.object().keys({
    trackingId: Joi.string().custom(objectId).required(),
    id: Joi.string().custom(objectId).required(),
  }),
};

const updateFoodQuantityValidation = {
  body: Joi.object().keys({
    trackingId: Joi.string().custom(objectId).required(),
    id: Joi.string().custom(objectId).required(),
    quantity: Joi.number().required(),
  }),
};

const updateFoodVariationQuantityValidation = {
  body: Joi.object().keys({
    trackingId: Joi.string().custom(objectId).required(),
    uuid: Joi.string().required(),
    id: Joi.string().custom(objectId).required(),
    quantity: Joi.number().required(),
  }),
};

module.exports = {
  addItemToCartValidation,
  removeCartItemByRestaurantValidation,
  removeCartItemByTrackingValidation,
  removeFromCartWithUuidValidation,
  removeFromCartWithFoodIdValidation,
  updateFoodQuantityValidation,
  updateFoodVariationQuantityValidation,
};

