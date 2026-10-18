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

module.exports = {
  customerListValidation,
  driverListValidation,
  earningsValidation,
  settlementListValidation,
};