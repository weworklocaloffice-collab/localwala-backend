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

const idValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

/**
 * "Today's run" for the signed-in driver.
 *
 * No `:id` on purpose — the driver is the authenticated user, resolved from the
 * token by `todayRun`. This validation used to require an `id` the route path
 * never declared, so `GET /driver/run/today` could never be called successfully.
 */
const driverRunValidation = {
  query: Joi.object().keys({
    serviceDate: Joi.date().allow('', null),
  }),
};

const runDetailValidation = {
  params: Joi.object().keys({
    run: Joi.string().custom(objectId).required(),
  }),
};

const stopValidation = {
  params: Joi.object().keys({
    stop: Joi.string().custom(objectId).required(),
  }),
};

const startRunValidation = {
  params: Joi.object().keys({
    run: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    cansLoaded: Joi.number().integer().min(0).required(),
    cansLoadedForReturn: Joi.number().integer().min(0).default(0),
    location: Joi.string().allow('', null),
  }),
};

const completeRunValidation = {
  params: Joi.object().keys({
    run: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    cansReturned: Joi.number().integer().min(0).required(),
    amountCollected: Joi.number().integer().min(0).default(0),
    adjustmentReason: Joi.string().allow('', null),
    forceClose: Joi.boolean().default(false),
  }),
};

const arriveStopValidation = {
  params: Joi.object().keys({
    stop: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    location: Joi.string().allow('', null),
  }),
};

const deliverStopValidation = {
  params: Joi.object().keys({
    stop: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    cansDelivered: Joi.number().integer().min(0).required(),
    emptyCansCollected: Joi.number().integer().min(0).default(0),
    amountCollected: Joi.number().integer().min(0).default(0),
    clientRef: Joi.string().allow('', null),
    proof: Joi.object().keys({
      photo: Joi.string().allow('', null),
      signature: Joi.string().allow('', null),
      location: Joi.string().allow('', null),
      note: Joi.string().allow('', null),
      capturedAt: Joi.date().allow('', null),
    }),
  }),
};

/**
 * Marking a stop skipped or failed.
 *
 * The route is `/driver/stops/:status/:stop`, so `:status` is a path segment and
 * has to be declared here — it was not, which made every skip and every fail fail
 * validation with `"status" is not allowed` before reaching the controller.
 *
 * The values are the past participles `skipped` and `failed`, matching what the
 * rider app actually sends (see `driverStopSkip` / `driverStopFail`). The older
 * imperatives `skip` and `fail` are accepted too, so an in-flight app build or a
 * hand-written request is not the thing that breaks.
 */
const skipStopValidation = {
  params: Joi.object().keys({
    status: Joi.string().valid('skipped', 'failed', 'skip', 'fail').required(),
    stop: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    reason: Joi.string().required(),
  }),
};

const createRunValidation = {
  body: Joi.object().keys({
    serviceDate: Joi.date().required(),
    slot: Joi.object()
      .keys({
        startTime: Joi.string().required(),
        endTime: Joi.string().required(),
      })
      .required(),
    stops: Joi.array()
      .items(
        Joi.object().keys({
          customer: Joi.string().custom(objectId).required(),
          address: Joi.string().custom(objectId).allow('', null),
          addressRaw: Joi.string().allow('', null),
          receiverName: Joi.string().allow('', null),
          receiverContact: Joi.number().allow('', null),
          location: Joi.object().keys({ type: Joi.string(), coordinates: Joi.array().items(Joi.number()) }),
          order: Joi.string().custom(objectId).allow('', null),
          subscription: Joi.string().custom(objectId).allow('', null),
          cansOut: Joi.number().integer().min(0).default(0),
          amountDue: Joi.number().integer().min(0).default(0),
          paymentMode: Joi.string().valid('prepaid', 'cod').default('cod'),
        })
      )
      .min(1)
      .required(),
  }),
};

const businessRunsValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
    serviceDate: Joi.date().allow('', null),
    status: Joi.string().valid('planned', 'dispatched', 'in_progress', 'completed', 'cancelled'),
  }),
};

/**
 * A driver's own run history.
 *
 * Takes no `:id`: the driver is the signed-in user, so the route resolves their
 * `DairyDriver` record from the token. That is what stops one driver reading
 * another's runs by passing a different id.
 */
const agentRunsValidation = {
  query: Joi.object().keys({
    serviceDate: Joi.date().allow('', null),
    status: Joi.string().valid('planned', 'dispatched', 'in_progress', 'completed', 'cancelled'),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const cancelRunValidation = {
  params: Joi.object().keys({
    run: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    reason: Joi.string().allow('', null),
  }),
};

module.exports = {
  idValidation,
  driverRunValidation,
  agentRunsValidation,
  runDetailValidation,
  stopValidation,
  startRunValidation,
  completeRunValidation,
  arriveStopValidation,
  deliverStopValidation,
  skipStopValidation,
  createRunValidation,
  businessRunsValidation,
  cancelRunValidation,
};