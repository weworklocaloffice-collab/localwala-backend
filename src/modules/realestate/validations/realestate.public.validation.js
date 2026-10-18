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
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

/**
 * Public Real Estate request validation.
 *
 * ## Why spec filters are `spec_<key>` and not a nested `specs` object
 *
 * A dynamic per-category filter naturally wants to be `?specs[bedrooms]=3`. That
 * depends on the framework's query parser: Express 5 changed the default to 'simple',
 * under which `specs[bedrooms]` arrives as the literal key `"specs[bedrooms]"` rather
 * than a nested object. A filter that works or silently does nothing depending on an
 * app-level parser setting is worse than an explicit one.
 *
 * So the wire format is `?spec_bedrooms=3` and `?spec_carpetArea_min=800`. It is
 * unambiguous in every parser, readable in a URL, and the pattern below is the gate
 * that stops an arbitrary key reaching the Mongo query — the search service narrows it
 * again against each active category's `filterableKeys`.
 */

/**
 * `spec_<key>` or `spec_<key>_min` / `spec_<key>_max`.
 *
 * Anchored, and the key must start with a letter, so `spec_$gt` and `spec___proto__`
 * cannot pass.
 */
const SPEC_FILTER_PATTERN = /^spec_[a-zA-Z][a-zA-Z0-9_]*(_min|_max)?$/;

const READINESS = ['READY_TO_MOVE', 'UNDER_CONSTRUCTION', 'NEW', 'RESALE'];
const TRANSACTION_TYPES = ['BUY', 'RENT'];

/** Commas because a query string carries a list as `amenities=LIFT,GYM`. */
const commaList = Joi.string()
  .allow('', null)
  .custom((value) => {
    if (!value) return undefined;
    const parts = String(value)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  });

const pagination = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
  sortBy: Joi.string().allow('', null),
};

const searchQuery = Joi.object()
  .keys({
    // Location
    locality: Joi.string().custom(objectId),
    city: Joi.string().custom(objectId),
    state: Joi.string().custom(objectId),
    operationalZone: Joi.string().custom(objectId),
    lng: Joi.number().min(-180).max(180),
    lat: Joi.number().min(-90).max(90),
    radiusMeters: Joi.number().integer().min(100).max(50000),

    // Price
    priceMin: Joi.number().min(0),
    priceMax: Joi.number().min(0),

    // Property
    category: Joi.string().custom(objectId),
    categoryKey: Joi.string().uppercase().allow('', null),
    transactionType: Joi.string().valid(...TRANSACTION_TYPES),
    readiness: Joi.string().valid(...READINESS),
    amenities: commaList,
    verified: Joi.boolean(),

    // Free text
    search: Joi.string().allow('', null).max(200),

    ...pagination,
  })
  // The dynamic spec filters. `.unknown(false)` keeps a typo like `?cit=Hyderabad`
  // out of the query rather than having it silently ignored.
  .pattern(SPEC_FILTER_PATTERN, Joi.alternatives().try(Joi.number(), Joi.string().max(100)))
  .unknown(false);

const nearbyQuery = Joi.object()
  .keys({
    lng: Joi.number().min(-180).max(180).required(),
    lat: Joi.number().min(-90).max(90).required(),
    radiusMeters: Joi.number().integer().min(100).max(50000).default(5000),
    category: Joi.string().custom(objectId),
    categoryKey: Joi.string().uppercase().allow('', null),
    transactionType: Joi.string().valid(...TRANSACTION_TYPES),
    priceMin: Joi.number().min(0),
    priceMax: Joi.number().min(0),
    limit: Joi.number().integer().min(1).max(50).default(20),
  })
  .pattern(SPEC_FILTER_PATTERN, Joi.alternatives().try(Joi.number(), Joi.string().max(100)))
  .unknown(false);

const idParams = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const codeParams = {
  params: Joi.object().keys({
    code: Joi.string()
      .pattern(/^RE-[A-Z]{3}-[0-9A-F]{6}$/)
      .required(),
  }),
};

const cityIdParams = {
  params: Joi.object().keys({
    cityId: Joi.string().custom(objectId).required(),
  }),
};

const categoryKeyParams = {
  params: Joi.object().keys({
    key: Joi.string().uppercase().required(),
  }),
};

/**
 * Assemble `specs` from the flat `spec_*` query keys.
 *
 * Kept next to the schema so the two stay in step: the pattern above decides what is
 * allowed, this decides how it is shaped. A `_min` and a `_max` on the same key become
 * a range; a bare key becomes an equality match.
 *
 * @param {object} query a validated query object
 * @returns {object} `{ specs, bare }` — `bare` still holds the non-spec keys
 */
/**
 * Keys that must never become a property of an accumulator object.
 *
 * `specs[field] = value` on a normal `{}` is a prototype-pollution sink: if `field` is
 * `__proto__`, then `specs['__proto__']` resolves to `Object.prototype`, the
 * `typeof === 'object'` guard passes, and `specs['__proto__'][bound] = n` writes onto
 * `Object.prototype` — poisoning every object in the process for the life of the
 * request.
 *
 * The pattern below already refuses a leading underscore, so `__proto__` cannot reach
 * here. This check exists because that defence is one regex edit away from being lost,
 * and the consequence is not a bad query — it is a compromised process.
 */
const FORBIDDEN_SPEC_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const extractSpecFilters = (query = {}) => {
  // Null-prototype accumulators. Even if a key somehow slipped past the check below,
  // there is no prototype to walk into.
  const specs = Object.create(null);
  const bare = Object.create(null);

  Object.entries(query).forEach(([key, value]) => {
    if (!SPEC_FILTER_PATTERN.test(key)) {
      bare[key] = value;
      return;
    }

    let field = key.slice(5); // drop `spec_`
    let bound = null;
    if (field.endsWith('_min')) {
      field = field.slice(0, -4);
      bound = 'min';
    } else if (field.endsWith('_max')) {
      field = field.slice(0, -4);
      bound = 'max';
    }

    // Second line of defence — see FORBIDDEN_SPEC_KEYS.
    if (!field || FORBIDDEN_SPEC_KEYS.has(field) || field.includes('$') || field.includes('.')) {
      return;
    }

    if (bound) {
      if (!specs[field] || typeof specs[field] !== 'object') specs[field] = Object.create(null);
      specs[field][bound] = Number(value);
    } else {
      // A bare value may be numeric (a spec like `bedrooms`) or a string (an enum
      // like `furnishing`). Numbers are coerced only when the string is fully numeric,
      // so `"3BHK"` stays a string.
      const numeric =
        typeof value === 'number' ||
        (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)));
      specs[field] = numeric ? Number(value) : value;
    }
  });

  if (Object.keys(specs).length) bare.specs = specs;
  return bare;
};

module.exports = {
  SPEC_FILTER_PATTERN,
  FORBIDDEN_SPEC_KEYS,
  extractSpecFilters,
  search: { query: searchQuery },
  nearby: { query: nearbyQuery },
  idParams,
  codeParams,
  cityIdParams,
  categoryKeyParams,
};
