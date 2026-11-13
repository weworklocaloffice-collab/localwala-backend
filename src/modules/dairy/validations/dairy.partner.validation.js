/*
 * WeWorkLocal
 * Hyperlocal Commerce, Delivery & Service Platform
 *
 * Copyright © 2026 WeWorkLocal.
 * All Rights Reserved.
 *
 * Website: https://localwala.tech
 * Email: weworklocal1@gmail.com
 *
 * Proprietary and Confidential.
 *
 * Unauthorized copying, modification, distribution,
 * publication, resale, reverse engineering, or use of
 * this software without prior written authorization is
 * strictly prohibited.
 */

const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

/**
 * Validations for the partner-facing outlet views.
 *
 * None of these carry a `business` key. The outlet is read from the access token
 * by `resolveOutlet`, so there is nothing legitimate for a client to send and no
 * reason to accept it - a key that is accepted and then ignored teaches the
 * caller that it was filtering something.
 */

const listQuery = {
  limit: Joi.number().integer(),
  page: Joi.number().integer(),
  search: Joi.string().allow('', null),
};

/** Everyone who buys from the outlet. */
const customerListValidation = {
  query: Joi.object().keys(listQuery),
};

/**
 * The outlet's own riders.
 *
 * `status` is a Boolean on the model, so the filter is `true`/`false` rather
 * than the lifecycle words a reader would expect. The driver's availability is
 * a separate `activeStatus` field and is deliberately not filterable here.
 */
const driverListValidation = {
  query: Joi.object().keys({
    ...listQuery,
    status: Joi.string().valid('true', 'false'),
  }),
};

/** A period of trading. Half-open, to match the settlement engine's `[from, to)`. */
const periodQuery = {
  from: Joi.date().allow('', null),
  to: Joi.date().allow('', null),
};

const earningsValidation = {
  query: Joi.object().keys(periodQuery),
};

const settlementListValidation = {
  query: Joi.object().keys({
    ...listQuery,
    status: Joi.string().valid('draft', 'submitted', 'approved', 'paid', 'disputed', 'void'),
  }),
};

const clockTime = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/);
const availabilitySettingsValidation = {
  body: Joi.object().keys({
    acceptingOrders: Joi.boolean(),
    timezone: Joi.string().min(3).max(100),
    operatingHours: Joi.array().length(7).items(Joi.object().keys({
      day: Joi.number().integer().min(0).max(6).required(),
      isOpen: Joi.boolean().required(),
      opensAt: clockTime.when('isOpen', { is: true, then: Joi.required(), otherwise: Joi.optional() }),
      closesAt: clockTime.when('isOpen', { is: true, then: Joi.required(), otherwise: Joi.optional() }),
    })),
    specialHours: Joi.array().max(90).items(Joi.object().keys({
      date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      isClosed: Joi.boolean().required(),
      opensAt: clockTime.when('isClosed', { is: false, then: Joi.required(), otherwise: Joi.optional() }),
      closesAt: clockTime.when('isClosed', { is: false, then: Joi.required(), otherwise: Joi.optional() }),
      orderCutoffTime: clockTime.allow(null),
      label: Joi.string().trim().max(100).allow(''),
    })),
    orderCutoffTime: clockTime.allow('', null),
    serviceableLocalities: Joi.array().items(Joi.string().custom(objectId)).unique(),
  }).min(1),
};

const outletLocationValidation = {
  body: Joi.object().keys({
    address: Joi.string().trim().min(8).max(500).required(),
    // GeoJSON ordering: [longitude, latitude].
    coordinates: Joi.array().length(2).items(Joi.number().required()).custom((value, helpers) => {
      if (value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) {
        return helpers.error('any.invalid');
      }
      return value;
    }).required(),
  }),
};

const franchiseJoiningFeePaymentValidation = {
  body: Joi.object().keys({
    // The platform chooses the enabled online payment configuration. The
    // client cannot alter the agreed fee, franchise id, or payee.
  }),
};

const settlementDetailValidation = {
  params: Joi.object().keys({ settlement: Joi.string().custom(objectId).required() }),
};

module.exports = {
  customerListValidation,
  driverListValidation,
  earningsValidation,
  settlementListValidation,
  availabilitySettingsValidation,
  outletLocationValidation,
  franchiseJoiningFeePaymentValidation,
  settlementDetailValidation,
};
