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

const paymentInitiationValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    payment: Joi.string().custom(objectId).required(),
    orders: Joi.string().custom(objectId).allow(null, ''),
    tiffinSubscription: Joi.string().custom(objectId).allow(null, ''),
    ref: Joi.string().allow(null, ''),
    amount: Joi.number().required(),
    from: Joi.string().required().allow('order', 'wallet'),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const getUserOrderTransactionsValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).required(),
  }),
};

const getUserDiningransactionsValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).required(),
  }),
};

const getUserFoodSubscriptionTransactionsValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  paymentInitiationValidation,
  idValidation,
  getUserOrderTransactionsValidation,
  getUserDiningransactionsValidation,
  getUserFoodSubscriptionTransactionsValidation,
};

