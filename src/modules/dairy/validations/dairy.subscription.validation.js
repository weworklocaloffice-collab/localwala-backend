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

const SCHEDULE_TYPES = ['daily', 'alternate_days', 'weekly', 'custom_days'];

const subscriptionParams = {
  subscription: Joi.string().custom(objectId).required(),
};

const actorBody = {
  actor: Joi.string().custom(objectId).allow('', null),
  actorType: Joi.string().valid('customer', 'partner', 'admin').default('customer'),
};

const createValidation = {
  body: Joi.object().keys({
    // `user` is deliberately absent. The plan holder is taken from the access
    // token, so accepting one here would only ever contradict the token - and
    // when the two disagreed the deliveries would be billed to the wrong person.
    business: Joi.string().custom(objectId).allow('', null),
    sku: Joi.string().custom(objectId).required(),
    quantity: Joi.number().integer().min(1).required(),
    scheduleType: Joi.string().valid(...SCHEDULE_TYPES).default('daily'),
    // 0 = Sunday … 6 = Saturday, matching Date#getDay which isScheduledFor uses.
    customDays: Joi.array().items(Joi.number().integer().min(0).max(6)).min(1).max(7),
    startDate: Joi.date().required(),
    endDate: Joi.date().allow('', null),
    deliverySlot: Joi.object()
      .keys({
        startTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required(),
        endTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required(),
      })
      .required(),
    address: Joi.string().custom(objectId).allow('', null),
    addressRaw: Joi.string().allow('', null),
    receiverName: Joi.string().allow('', null),
    receiverContact: Joi.number().allow('', null),
    payment: Joi.string().custom(objectId).allow('', null),
    paymentMode: Joi.string().valid('wallet', 'cod', 'gateway').default('wallet'),
    containerAssignment: Joi.string().custom(objectId).allow('', null),
  }),
};

const detailValidation = {
  params: Joi.object().keys(subscriptionParams),
  query: Joi.object().keys({ user: Joi.string().custom(objectId) }),
};

const listValidation = {
  query: Joi.object().keys({
    user: Joi.string().custom(objectId),
    business: Joi.string().custom(objectId),
    sku: Joi.string().custom(objectId),
    status: Joi.string().valid('pending_payments', 'active', 'paused', 'cancelled', 'completed'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

/**
 * Partner list of the outlet's plans.
 *
 * No `business`: the outlet comes from the token. `business` is omitted rather
 * than accepted-and-ignored so a client that sends one is told plainly, instead
 * of quietly believing it filtered something.
 */
const partnerListValidation = {
  query: Joi.object().keys({
    sku: Joi.string().custom(objectId),
    status: Joi.string().valid('pending_payments', 'active', 'paused', 'cancelled', 'completed'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

/**
 * A partner pausing or resuming a plan.
 */
const partnerPauseValidation = {
  params: Joi.object().keys(subscriptionParams),
  body: Joi.object().keys({
    from: Joi.date().allow('', null),
    // Required, like the customer route and like the model: a pause window has to
    // end. "Paused until further notice" is `cancelled`, and the two must not be
    // confusable.
    to: Joi.date().required(),
    reason: Joi.string().allow('', null),
  }),
};

const partnerResumeValidation = {
  params: Joi.object().keys(subscriptionParams),
};

const actorValidation = {
  params: Joi.object().keys(subscriptionParams),
  body: Joi.object().keys(actorBody),
};

const skipValidation = {
  params: Joi.object().keys(subscriptionParams),
  body: Joi.object().keys({
    date: Joi.date().required(),
    reason: Joi.string().allow('', null),
    ...actorBody,
  }),
};

const pauseValidation = {
  params: Joi.object().keys(subscriptionParams),
  body: Joi.object().keys({
    from: Joi.date().allow('', null),
    to: Joi.date().required(),
    reason: Joi.string().allow('', null),
    ...actorBody,
  }),
};

const quantityValidation = {
  params: Joi.object().keys(subscriptionParams),
  body: Joi.object().keys({
    quantity: Joi.number().integer().min(1).required(),
    ...actorBody,
  }),
};

const addressValidation = {
  params: Joi.object().keys(subscriptionParams),
  body: Joi.object().keys({
    address: Joi.string().custom(objectId).allow('', null),
    addressRaw: Joi.string().allow('', null),
    receiverName: Joi.string().allow('', null),
    receiverContact: Joi.number().allow('', null),
    ...actorBody,
  }),
};

const scheduleValidation = {
  params: Joi.object().keys(subscriptionParams),
  body: Joi.object().keys({
    scheduleType: Joi.string().valid(...SCHEDULE_TYPES),
    customDays: Joi.array().items(Joi.number().integer().min(0).max(6)).min(1).max(7),
    deliverySlot: Joi.object().keys({
      startTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/),
      endTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
    startDate: Joi.date(),
    endDate: Joi.date().allow('', null),
    effectiveFrom: Joi.date().allow('', null),
    ...actorBody,
  }),
};

const cancelValidation = {
  params: Joi.object().keys(subscriptionParams),
  body: Joi.object().keys({
    reason: Joi.string().allow('', null),
    ...actorBody,
  }),
};

const eventsValidation = {
  params: Joi.object().keys(subscriptionParams),
  query: Joi.object().keys({ limit: Joi.number().integer() }),
};

const upcomingValidation = {
  params: Joi.object().keys(subscriptionParams),
  query: Joi.object().keys({ days: Joi.number().integer().min(1).max(90) }),
};

const manifestDateValidation = {
  query: Joi.object().keys({
    date: Joi.date().allow('', null),
    daysAhead: Joi.number().integer().min(0).max(14),
  }),
};

module.exports = {
  SCHEDULE_TYPES,
  createValidation,
  detailValidation,
  listValidation,
  partnerListValidation,
  partnerPauseValidation,
  partnerResumeValidation,
  actorValidation,
  skipValidation,
  pauseValidation,
  quantityValidation,
  addressValidation,
  scheduleValidation,
  cancelValidation,
  eventsValidation,
  upcomingValidation,
  manifestDateValidation,
};