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

const saveComplaintValidation = {
  body: Joi.object().keys({
    orders: Joi.string().custom(objectId).required(),
    reason: Joi.string().custom(objectId).allow(null, ''),
    title: Joi.string().required(),
    brief: Joi.string().required(),
    proof: Joi.string().allow(null, ''),
    issueWith: Joi.string().required().allow('customer', 'deliveryman'),
    restaurant: Joi.string().custom(objectId).allow(null, ''),
    driver: Joi.string().custom(objectId).allow(null, ''),
    customer: Joi.string().custom(objectId).allow(null, ''),
    user: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  saveComplaintValidation,
};

