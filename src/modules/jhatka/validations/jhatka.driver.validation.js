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

/**
 * jhatka.driver.validation.js — Joi schemas for the rider surface.
 *
 * `clientRef` is required on every POD write: it is the idempotency key, and a
 * POD without one can be duplicated by a lift retry.
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const deliveryParam = {
  params: Joi.object().keys({
    delivery: objectId.required(),
  }),
};

const locationShape = Joi.object()
  .keys({
    coordinates: Joi.array().items(Joi.number()).length(2),
  })
  .unknown(true);

const deliverBody = {
  body: Joi.object()
    .keys({
      clientRef: Joi.string().required(),
      deliveredTempC: Joi.number(),
      photo: Joi.string(),
      signature: Joi.string(),
      location: locationShape,
      // STRING only, never number. `alternatives().try(number, string)` coerced
      // "012345" to 12345 and back to "12345" — a different code — so roughly
      // one handover in ten failed for no reason anyone could see. An OTP is a
      // string of digits, not a quantity; leading zeros are significant. A client
      // sending a JSON number still validates (Joi coerces number→string, which
      // loses nothing a JSON number could carry).
      otp: Joi.string().pattern(/^[0-9]+$/),
      receiverName: Joi.string(),
      codCollected: Joi.number().min(0),
      note: Joi.string(),
    })
    .unknown(true),
};

const podBody = {
  body: Joi.object()
    .keys({
      delivery: objectId.required(),
      clientRef: Joi.string().required(),
      deliveredTempC: Joi.number(),
      photo: Joi.string(),
      signature: Joi.string(),
      location: locationShape,
      // Same as deliverBody above: string-only, leading zeros significant.
      otp: Joi.string().pattern(/^[0-9]+$/),
      receiverName: Joi.string(),
      codCollected: Joi.number().min(0),
      note: Joi.string(),
    })
    .unknown(true),
};

const collectCodBody = {
  body: Joi.object()
    .keys({
      amountPaise: Joi.number().integer().min(0).required(),
      receiptPhoto: Joi.string(),
    })
    .unknown(true),
};

const failBody = {
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(3).required(),
    })
    .unknown(true),
};

module.exports = {
  deliveryParam,
  deliverBody,
  podBody,
  collectCodBody,
  failBody,
};
