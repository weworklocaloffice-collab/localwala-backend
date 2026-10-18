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

const createDiningCampaignValidation = {
  body: Joi.object().keys({
    title: Joi.string().required(),
    shortDescription: Joi.string().required(),
    city: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().allow(null, ''),
    image: Joi.string().required(),
    startDate: Joi.date().required(),
    endDate: Joi.date().required(),
    startTime: Joi.string().required(),
    endTime: Joi.string().required(),
    translations: Joi.allow(),
  }),
};

const cityzenCreateDiningCampaignValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    title: Joi.string().required(),
    shortDescription: Joi.string().required(),
    restaurant: Joi.string().allow(null, ''),
    image: Joi.string().required(),
    startDate: Joi.date().required(),
    endDate: Joi.date().required(),
    startTime: Joi.string().required(),
    endTime: Joi.string().required(),
    translations: Joi.allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    campaignId: Joi.string().custom(objectId),
  }),
};

const restaurantIdValidation = {
  params: Joi.object().keys({
    restaurantId: Joi.string().custom(objectId),
  }),
};

const leaveAndJoinCampaignValidation = {
  params: Joi.object().keys({
    campaignId: Joi.string().custom(objectId),
    restaurantId: Joi.string().custom(objectId),
  }),
};

const infoValidation = {
  params: Joi.object().keys({
    campaignId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    campaignId: Joi.string().custom(objectId).required(),
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
    uid: Joi.string().custom(objectId).allow('', null),
  }),
};

const detailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
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
  createDiningCampaignValidation,
  idValidation,
  restaurantIdValidation,
  leaveAndJoinCampaignValidation,
  infoValidation,
  detailValidation,
  cityzenCreateDiningCampaignValidation,
  allValidation,
  exportValidation,
  cityMasterValidation,
};

