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
 * jhatka.partner.validation.js — Joi schemas for session/scope/dashboard.
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const sessionOutletBody = {
  body: Joi.object()
    .keys({
      outletId: objectId.required(),
    })
    .unknown(true),
};

const analyticsQuery = {
  query: Joi.object().keys({
    from: Joi.date(),
    to: Joi.date(),
  }),
};

const deliveryParam = {
  params: Joi.object().keys({
    delivery: objectId.required(),
  }),
};

const driverParam = {
  params: Joi.object().keys({
    driver: objectId.required(),
  }),
};

const driverUpdateBody = {
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(2),
      mobile: Joi.number().integer(),
      vehicle: Joi.object().unknown(true),
    })
    .unknown(true),
};

const driverStatusBody = {
  body: Joi.object()
    .keys({
      status: Joi.string().valid('active', 'inactive', 'suspended').required(),
      reason: Joi.string(),
    })
    .unknown(true),
};

const overrideParam = {
  params: Joi.object().keys({
    override: objectId.required(),
  }),
};

const overrideBody = {
  body: Joi.object()
    .keys({
      variant: objectId.required(),
      pricePerUnit: Joi.number().min(0).required(),
      priceBasis: Joi.string().valid('per_kg', 'per_g', 'per_piece', 'per_dozen', 'per_pack', 'per_tier'),
      minQuantity: Joi.number().min(0),
      maxQuantity: Joi.number().min(0),
      effectiveFrom: Joi.date().required(),
      effectiveTo: Joi.date().required(),
      reason: Joi.string().trim().min(10).required(),
    })
    .unknown(true),
};

const revokeBody = {
  body: Joi.object()
    .keys({
      revokeReason: Joi.string().trim().min(3).required(),
    })
    .unknown(true),
};

const deliveryListQuery = {
  query: Joi.object().keys({
    active: Joi.string().valid('true', 'false'),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }),
};

/**
 * Customer search. `q` floor is enforced in the handler too (defense in depth —
 * Joi rejects the shape, the handler rejects the intent), because an empty query
 * against this endpoint is a user dump, not a search.
 */
const customerSearchQuery = {
  query: Joi.object().keys({
    q: Joi.string().trim().min(1).max(40).required(),
  }),
};

module.exports = {
  sessionOutletBody,
  analyticsQuery,
  deliveryParam,
  deliveryListQuery,
  customerSearchQuery,
  driverParam,
  driverUpdateBody,
  driverStatusBody,
  overrideParam,
  overrideBody,
  revokeBody,
};
