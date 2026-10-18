/*
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
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

/**
 * Fleet management: inviting, approving and paying a rider.
 *
 * None of these carry a `business` key. The outlet is read from the access token
 * by `resolveOutlet`, so there is nothing legitimate for a client to send.
 */

const driverParams = {
  driver: Joi.string().custom(objectId).required(),
};

/** Inviting a rider by phone. */
const driverInviteValidation = {
  body: Joi.object().keys({
    mobile: Joi.number().required(),
    countryCode: Joi.string().trim().default('+91'),
  }),
};

const driverInviteListValidation = {
  params: Joi.object().keys({}),
};

const driverInviteRevokeValidation = {
  params: Joi.object().keys({
    invite: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    reason: Joi.string().allow('', null).trim(),
  }),
};

/**
 * Approve or block a rider.
 *
 * `approve` is required rather than defaulted: forgetting it should be an error,
 * not an accidental unblock.
 */
const driverApprovalValidation = {
  params: Joi.object().keys(driverParams),
  body: Joi.object().keys({
    approve: Joi.boolean().required(),
    reason: Joi.string().allow('', null).trim(),
  }),
};

const driverRemoveValidation = {
  params: Joi.object().keys(driverParams),
  body: Joi.object().keys({
    reason: Joi.string().allow('', null).trim(),
  }),
};

/**
 * A payout.
 *
 * `amount` is required even though the rider has a `payoutRate`: a partner paying
 * early or paying a bonus is a real case, and silently substituting the rate
 * would make the two indistinguishable in the ledger.
 */
const driverPayoutValidation = {
  params: Joi.object().keys(driverParams),
  body: Joi.object().keys({
    amount: Joi.number().positive().required(),
    reference: Joi.string().allow('', null).trim(),
  }),
};

// //// Rider-side views ////

const driverPeriodValidation = {
  query: Joi.object().keys({
    from: Joi.date().allow('', null),
    to: Joi.date().allow('', null),
  }),
};

const cashDepositValidation = {
  body: Joi.object().keys({
    amount: Joi.number().positive().required(),
    reference: Joi.string().allow('', null).trim(),
  }),
};

module.exports = {
  driverInviteValidation,
  driverInviteListValidation,
  driverInviteRevokeValidation,
  driverApprovalValidation,
  driverRemoveValidation,
  driverPayoutValidation,
  driverPeriodValidation,
  cashDepositValidation,
};