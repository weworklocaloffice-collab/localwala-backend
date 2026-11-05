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
const { objectId } = require('../../../validations/custom.validation');

const { ORDER_STATUSES, RUN_STATUSES } = require('../services/dairy.operations.service');

/**
 * Read-only admin monitoring. Statuses are validated against the model enums
 * so a typo in a filter cannot silently return an empty list that looks like
 * "no orders today".
 */

const orderListValidation = {
  query: Joi.object().keys({
    status: Joi.string().valid(...ORDER_STATUSES),
    business: Joi.string().custom(objectId),
    search: Joi.string().allow(null, ''),
    from: Joi.date().allow(null, ''),
    to: Joi.date().allow(null, ''),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const orderDetailValidation = {
  params: Joi.object().keys({ order: Joi.string().custom(objectId).required() }),
};

const runListValidation = {
  query: Joi.object().keys({
    status: Joi.string().valid(...RUN_STATUSES),
    business: Joi.string().custom(objectId),
    from: Joi.date().allow(null, ''),
    to: Joi.date().allow(null, ''),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const runDetailValidation = {
  params: Joi.object().keys({ run: Joi.string().custom(objectId).required() }),
};

const driverListValidation = {
  query: Joi.object().keys({
    business: Joi.string().custom(objectId),
    blocked: Joi.boolean(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

module.exports = {
  orderListValidation,
  orderDetailValidation,
  runListValidation,
  runDetailValidation,
  driverListValidation,
};
