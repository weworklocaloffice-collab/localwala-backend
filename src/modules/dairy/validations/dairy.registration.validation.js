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
const { objectId, password } = require('../../../validations/custom.validation');

/**
 * The self-registerable role allowlist.
 *
 * This is the security boundary for self-registration. `admin`, `accountant`,
 * `cityMaster`, `supportTeam` and `waiter` are deliberately absent — matching
 * the existing allowlist pattern at `validations/auth.validation.js:240`.
 */
const SELF_ROLES = ['dairyPartner', 'dairyDriver'];

const registerPartnerValidation = {
  body: Joi.object().keys({
    firstName: Joi.string().required().trim(),
    lastName: Joi.string().required().trim(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    email: Joi.string().required().email(),
  password: Joi.string().custom(password).required(),
    locale: Joi.string().allow(),

    role: Joi.string().required().valid('dairyPartner'),

    businessName: Joi.string().required().trim(),
    businessModel: Joi.string().valid('direct', 'franchise', 'commission_partner').default('direct'),
    // No `ownDeliveryPartner`. It was a choice between "the platform dispatches my
    // riders" and "I hire my own", and the platform half no longer exists — every
    // dairy rider is employed by an outlet. The field stays on the shared
    // `Business` model because restaurant still branches on it; dairy just always
    // sets it true. Accepting it here would be misleading, so a client that still
    // sends it is rejected rather than quietly ignored.
    shortDescription: Joi.string().allow('', null),
    address: Joi.string().allow('', null),
    logo: Joi.string().allow('', null),
    cover: Joi.string().allow('', null),
    // Location is required. An outlet with no city and locality is invisible to
    // delivery zoning, so it can be created and verified but never dispatched to.
    // The pairing is checked server-side in `registerPartner` - these two being
    // present is necessary, not sufficient.
    city: Joi.string().custom(objectId).required(),
    locality: Joi.string().custom(objectId).required(),
    coordinates: Joi.array().items(Joi.number()).length(2).allow('', null),
    expectedDrivers: Joi.number().integer().min(0).default(0),

    // Compliance — reviewed by an admin after registration, never blocking.
    fssaiLicence: Joi.string().allow('', null),
    fssaiExpiry: Joi.date().allow('', null),
    gstNumber: Joi.string().allow('', null),
    identityProof: Joi.string().allow('', null),
  }),
};

const registerDriverValidation = {
  body: Joi.object().keys({
    firstName: Joi.string().required().trim(),
    lastName: Joi.string().required().trim(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    email: Joi.string().required().email(),
  password: Joi.string().custom(password).required(),
    locale: Joi.string().allow(),

    role: Joi.string().required().valid('dairyDriver'),

// No `invitedBy`. Which outlet this rider joins is decided by a
  // `DairyDriverInvite` matched on their own phone number - the identifier the
  // OTP has proven they hold. Accepting a partner id here let anyone enrol
  // themselves on a rival outlet's fleet by guessing one.

     // Location is never sent by a rider: it is inherited from the inviting outlet,
     // and the service rejects a client that supplies one. Both fields are therefore
     // allowed to be absent here so the rejection is the service's specific message
     // rather than a generic Joi 'not allowed'.
    city: Joi.string().custom(objectId).allow('', null),
    locality: Joi.string().custom(objectId).allow('', null),

    payoutMode: Joi.string().valid('per_litre', 'per_can', 'salary').default('per_can'),
    canCapacity: Joi.number().integer().min(0).default(0),
    vehicleType: Joi.string()
      .valid('cycle', 'bike', 'mini_truck', 'on_foot')
      .default('cycle'),

    identity: Joi.string().allow('', null),
    identityNumber: Joi.string().allow('', null),
    identityProof: Joi.string().allow('', null),
    licence: Joi.string().allow('', null),
    licenceExpiry: Joi.date().allow('', null),
    fssaiLicence: Joi.string().allow('', null),
    age: Joi.number().integer().min(18).allow('', null),
    dob: Joi.date().allow('', null),
  }),
};

const registerOtpValidation = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    role: Joi.string().required().valid('dairyPartner', 'dairyDriver'),
    locale: Joi.string().allow(),
  }),
};

const reviewJoiningRequestValidation = {
    params: Joi.object().keys({
      request: Joi.string().custom(objectId).required(),
      // The admin deciding the review. This is a path segment on
      // `/joining_request/review/:request/:id` and was undeclared, so every review
      // was rejected with `"id" is not allowed` before the controller ran.
      id: Joi.string().custom(objectId).required(),
    }),
    body: Joi.object().keys({
      approve: Joi.boolean().required(),
      reason: Joi.string().allow('', null),
    }),
  };

/**
 * The admin's review queue.
 *
 * `GET /admin/joining-requests` — review was previously reachable only by id, so
 * nothing could show an operator what was waiting for a decision.
 */
const listJoiningRequestsValidation = {
  query: Joi.object().keys({
    status: Joi.string().valid('pending', 'approved', 'rejected'),
    business: Joi.string().custom(objectId),
    search: Joi.string().allow(null, ''),
    limit: Joi.number().integer().min(1).max(100),
    page: Joi.number().integer().min(0),
  }),
};

module.exports = {
  SELF_ROLES,
  registerPartnerValidation,
  registerDriverValidation,
  registerOtpValidation,
  reviewJoiningRequestValidation,
  listJoiningRequestsValidation,
};
