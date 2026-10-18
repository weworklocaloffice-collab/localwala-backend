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

const createSubscription = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    price: Joi.number().required(),
    shortDescriptions: Joi.string().required(),
    validity: Joi.number().required(),
    haveTrial: Joi.bool().required(),
    trialValidity: Joi.number().required(),
    icon: Joi.string().required(),
    pos: Joi.boolean().required(),
    ownDriver: Joi.boolean().required(),
    promote: Joi.boolean().required(),
    customCategory: Joi.boolean().required(),
    multiOutlet: Joi.boolean().required(),
    preBooking: Joi.boolean().required(),
    tableOrder: Joi.boolean().required(),
    tiffinSubscription: Joi.boolean().required(),
    ownWaiter: Joi.boolean().required(),
    ownKitchen: Joi.boolean().required(),
    orderLimit: Joi.number().required(),
    productLimit: Joi.number().required(),
    commission: Joi.number().required(),
    translations: Joi.allow(),
    discount: Joi.allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    subscriptionId: Joi.string().custom(objectId),
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

module.exports = {
  createSubscription,
  idValidation,
  allValidation,
  exportValidation,
};

