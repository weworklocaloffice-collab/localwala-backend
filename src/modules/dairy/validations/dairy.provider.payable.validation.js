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

const payableScopeValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

/**
 * `:id` is the outlet, matching the other `/partner` procurement routes. Still a
 * client-supplied value until partner scoping is settled — see §10 decision 7.
 */
const generateValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    provider: Joi.string().custom(objectId).required(),
    from: Joi.date().required(),
    to: Joi.date().required(),
    label: Joi.string().allow('', null),
    payoutMethod: Joi.string().valid('bank', 'cash').default('bank'),
    notes: Joi.string().allow('', null),
  }),
};

const adjustmentValidation = {
  ...payableScopeValidation,
  body: Joi.object().keys({
    amount: Joi.number().min(0).required(),
    // A deduction with no reason is indistinguishable from a mistake later.
    reason: Joi.string().required().trim(),
  }),
};

const statusValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    status: Joi.string().valid('approved', 'disputed', 'void').required(),
  }),
  body: Joi.object().keys({
    reason: Joi.string().allow('', null),
  }),
};

const payValidation = {
  ...payableScopeValidation,
  body: Joi.object().keys({
    reference: Joi.string().allow('', null),
  }),
};

const listValidation = {
  query: Joi.object().keys({
    provider: Joi.string().custom(objectId),
    status: Joi.string().valid('draft', 'approved', 'paid', 'disputed', 'void'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

module.exports = {
  payableScopeValidation,
  generateValidation,
  adjustmentValidation,
  statusValidation,
  payValidation,
  listValidation,
};
