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

const LIFECYCLE_ACTIONS = [
  'send_to_wash',
  'washed',
  'inspect_ok',
  'inspect_fail',
  'refill',
  'scrap',
];

/**
 * Enrols a customer into a two-bottle rotation.
 *
 * Refused server-side when the SKU's `reusableContainer` is false — packaged
 * dairy never rotates, so the gate does not trust the client.
 */
const assignContainerValidation = {
  body: Joi.object().keys({
    customer: Joi.string().custom(objectId).required(),
    subscription: Joi.string().custom(objectId).allow('', null),
    sku: Joi.string().custom(objectId).required(),
  }),
};

/** Plans the swap for one delivery: what to collect, what to hand over. */
const planSwapValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    customer: Joi.string().custom(objectId).required(),
    subscription: Joi.string().custom(objectId).allow('', null),
  }),
};

const completeSwapValidation = {
  params: Joi.object().keys({
    assignment: Joi.string().custom(objectId).required(),
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    deliveredCan: Joi.string().custom(objectId).required(),
    collectedCan: Joi.string().custom(objectId).allow('', null),
    run: Joi.string().custom(objectId).allow('', null),
    stop: Joi.string().custom(objectId).allow('', null),
    agent: Joi.string().custom(objectId).allow('', null),
  }),
};

const releaseContainerValidation = {
  params: Joi.object().keys({
    assignment: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    reason: Joi.string().allow('', null),
  }),
};

/**
 * Advances one can through the wash / inspect / refill pipeline.
 *
 * `action` comes from the route rather than the body so a client cannot smuggle
 * an arbitrary transition past the state machine.
 */
const lifecycleValidation = {
  params: Joi.object().keys({
    action: Joi.string().valid(...LIFECYCLE_ACTIONS).required(),
    can: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    note: Joi.string().allow('', null),
  }),
};

const rotationViewValidation = {
  query: Joi.object().keys({
    customer: Joi.string().custom(objectId).required(),
  }),
};

const lifecycleSummaryValidation = {
  params: Joi.object().keys({
  }),
};

module.exports = {
  LIFECYCLE_ACTIONS,
  assignContainerValidation,
  planSwapValidation,
  completeSwapValidation,
  releaseContainerValidation,
  lifecycleValidation,
  rotationViewValidation,
  lifecycleSummaryValidation,
};