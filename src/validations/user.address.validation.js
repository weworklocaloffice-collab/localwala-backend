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

const saveAddress = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    title: Joi.number().required(),
    receiverName: Joi.string().required(),
    countryCode: Joi.string().required(),
    receiverContact: Joi.string().required(),
    flatHouse: Joi.string().required(),
    locality: Joi.string().required(),
    landmark: Joi.string().allow(null, ''),
    type: Joi.string().required(),
    longitude: Joi.string().required(),
    latitude: Joi.string().required(),
  }),
};

const userIdValidation = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId),
  }),
};

const updateValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    title: Joi.number().required(),
    receiverName: Joi.string().required(),
    countryCode: Joi.string().required(),
    receiverContact: Joi.string().required(),
    flatHouse: Joi.string().required(),
    locality: Joi.string().required(),
    landmark: Joi.string().allow(null, ''),
    type: Joi.string().required(),
    longitude: Joi.string().required(),
    latitude: Joi.string().required(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const myAddressValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
};

const myAddressFromRestaurantValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const posSaveAddressValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    receiverName: Joi.string().required(),
    countryCode: Joi.string().required(),
    receiverContact: Joi.string().required(),
    flatHouse: Joi.string().required(),
    locality: Joi.string().required(),
    landmark: Joi.string().allow(null, ''),
    longitude: Joi.string().required(),
    latitude: Joi.string().required(),
  }),
};

const posUpdateValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    receiverName: Joi.string().required(),
    countryCode: Joi.string().required(),
    receiverContact: Joi.string().required(),
    flatHouse: Joi.string().required(),
    locality: Joi.string().required(),
    landmark: Joi.string().allow(null, ''),
    longitude: Joi.string().required(),
    latitude: Joi.string().required(),
  }),
};

module.exports = {
  saveAddress,
  userIdValidation,
  updateValidation,
  idValidation,
  myAddressValidation,
  myAddressFromRestaurantValidation,
  posSaveAddressValidation,
  posUpdateValidation,
};

