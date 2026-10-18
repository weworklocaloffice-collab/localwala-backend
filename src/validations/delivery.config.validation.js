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
 * delivery.config.validation.js — Joi schemas for `Restaurant.deliveryConfig`.
 *
 * Every field is optional and every bound mirrors the sanitizer in
 * `utils/delivery.policy.js`, so validation and persistence can never
 * disagree about what a legal config looks like. The admin route that accepts
 * this payload is a follow-up; until then `updateDeliveryConfig()` applies a
 * patch validated by `deliveryConfigPatch`.
 */

const Joi = require('joi');
const { objectId } = require('./custom.validation');

const rungSchema = Joi.object().keys({
  radiusMeters: Joi.number().integer().min(100).max(50000).allow(null),
  batchSize: Joi.number().integer().min(1).max(20).allow(null),
  ttlSeconds: Joi.number().integer().min(10).max(600).allow(null),
});

const zoneSchema = Joi.object().keys({
  name: Joi.string().max(120).allow('', null),
  // RING, POLYGON or MULTIPOLYGON — shape checked at read time by the kernel
  // classifier, not here (see `utils/delivery.policy.js`).
  geometry: Joi.array().required(),
  enabled: Joi.boolean().allow(null),
});

const peakWindowSchema = Joi.object().keys({
  startHour: Joi.number().integer().min(0).max(23).required(),
  endHour: Joi.number().integer().min(0).max(23).required(),
  multiplier: Joi.number().min(1).max(5).required(),
});

const surgeSchema = Joi.object().keys({
  enabled: Joi.boolean().allow(null),
  demandThreshold: Joi.number().min(0.5).max(100).allow(null),
  multiplierCap: Joi.number().min(1).max(5).allow(null),
  peakHours: Joi.array().items(peakWindowSchema).max(12).allow(null),
});

const deliveryConfigBodyKeys = {
  deliveryRadiusMeters: Joi.number().integer().min(100).max(50000).allow(null),
  fleetFirst: Joi.boolean().allow(null),
  batchSizes: Joi.array().items(Joi.number().integer().min(1).max(20)).max(8).allow(null),
  offerTtlSeconds: Joi.array().items(Joi.number().integer().min(10).max(600)).max(8).allow(null),
  escalationLadder: Joi.array().items(rungSchema).max(8).allow(null),
  maxDispatchAttempts: Joi.number().integer().min(1).max(10).allow(null),
  zones: Joi.array().items(zoneSchema).max(20).allow(null),
  localities: Joi.array().items(Joi.string().custom(objectId)).max(100).allow(null),
  surge: surgeSchema.allow(null),
  clearKeys: Joi.array()
    .items(
      Joi.string().valid(
        'deliveryRadiusMeters',
        'fleetFirst',
        'batchSizes',
        'offerTtlSeconds',
        'escalationLadder',
        'maxDispatchAttempts',
        'zones',
        'localities',
        'surge'
      )
    )
    .allow(null),
};

const deliveryConfigPatch = {
  params: Joi.object().keys({
    restaurantId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys(deliveryConfigBodyKeys),
};

// City-master routes carry `:master` alongside `:restaurantId`. The validate
// middleware rejects unknown params, so this variant declares both — same
// body, same handler.
const cityzenDeliveryConfigPatch = {
  params: Joi.object().keys({
    restaurantId: Joi.string().custom(objectId).required(),
    master: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys(deliveryConfigBodyKeys),
};

// Vendor self-narrowing (Batch D-2): shrink-only subset. No clearKeys —
// resetting to inheritance can widen, so even resets go through the master.
const vendorDeliveryConfigNarrow = {
  body: Joi.object().keys({
    deliveryRadiusMeters: Joi.number().integer().min(100).max(50000).allow(null),
    localities: Joi.array().items(Joi.string().custom(objectId)).max(100).allow(null),
  }),
};

module.exports = {
  rungSchema,
  zoneSchema,
  peakWindowSchema,
  surgeSchema,
  deliveryConfigPatch,
  cityzenDeliveryConfigPatch,
  vendorDeliveryConfigNarrow,
  deliveryConfigParams: {
    params: Joi.object().keys({
      restaurantId: Joi.string().custom(objectId).required(),
    }),
  },
};
