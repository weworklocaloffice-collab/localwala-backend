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
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const recurringBody = {
  body: Joi.object()
    .keys({
      service: objectId.required(),
      provider: objectId.allow(null),
      cadence: Joi.string().valid('daily', 'alternate_days', 'weekly', 'biweekly', 'monthly').required(),
      intervalCount: Joi.number().integer().min(1).default(1),
      startDate: Joi.date().required(),
      endDate: Joi.date().greater(Joi.ref('startDate')).allow(null),
      labourAmount: Joi.number().min(0).required(),
      partsAmount: Joi.number().min(0).default(0),
    })
    .unknown(false),
};

const leadBody = {
  body: Joi.object()
    .keys({
      categoryKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
      serviceKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
      description: Joi.string().max(2000).allow('', null),
    })
    .unknown(false),
};

const planBody = {
  body: Joi.object()
    .keys({
      code: Joi.string().trim().uppercase().max(64).required(),
      name: Joi.string().max(200).required(),
      price: Joi.number().min(0).required(),
      interval: Joi.string().valid('monthly', 'yearly').required(),
      entitlements: Joi.array().items(Joi.string().max(100)),
      status: Joi.string().valid('active', 'inactive'),
    })
    .unknown(false),
};

const featuredBody = {
  body: Joi.object()
    .keys({
      provider: objectId.allow(null),
      service: objectId.allow(null),
      placement: Joi.string().valid('home', 'search', 'category').required(),
      from: Joi.date().required(),
      to: Joi.date().greater(Joi.ref('from')).required(),
      price: Joi.number().min(0).required(),
    })
    .unknown(false),
};

const idParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

module.exports = { recurringBody, leadBody, planBody, featuredBody, idParam };
