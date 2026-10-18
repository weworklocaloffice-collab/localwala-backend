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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const Joi = require('joi');
const { objectId } = require('../../../validations/custom.validation');

/**
 * A Mongo id as a Joi schema.
 *
 * `objectId` from `custom.validation` is a *validator function* `(value, helpers) => …`,
 * not a schema, so it composes with `Joi.string().custom(objectId)`. Writing
 * `objectId.required()` — which reads as though it were a schema — throws
 * `objectId.required is not a function` at require time.
 */
const id = Joi.string().custom(objectId);

/**
 * Executive-facing Real Estate request validation.
 *
 * ## The transition table appears here twice, on purpose
 *
 * Doc §0.0 requires it: "State transitions live in a table in the service, are allow-listed
 * a second time in Joi, and the target state is a route parameter." `VISIT_TRANSITIONS` in
 * `realestate.visit.service.js` is the authority; `ALLOWED_NEXT` below is the same shape
 * restated for the request boundary.
 *
 * This is duplication with a purpose. The service copy catches a caller reaching the wrong
 * state through code; this copy rejects the request before it becomes one. They can drift,
 * and `verify.realestate.visits.js` asserts they have not — that is the check that makes the
 * duplication safe rather than merely tolerable.
 *
 * ## Every coordinate is validated, never trusted
 *
 * BR-08 is only as strong as the arithmetic, and `checkIn` computes a haversine distance
 * from whatever arrives. `[0, 0]` is the classic failure: it is a valid pair of numbers,
 * sits in the Atlantic, and would make every visit fail its geofence for reasons that look
 * like a GPS bug. `coordinates` therefore rejects null island and out-of-range values here
 * rather than letting them reach the distance calculation.
 */

const VISIT_STATUS = ['ASSIGNED', 'ACCEPTED', 'CHECK_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const INTEREST_LEVEL = [
  'VERY_INTERESTED',
  'INTERESTED',
  'MAYBE_FOLLOW_UP',
  'NOT_INTERESTED',
  'INTERESTED_IN_OTHER_PROPERTY',
  'PURCHASE_DECISION_PENDING',
];

const INTEREST_REASON = [
  'PRICE',
  'LOCATION',
  'PROPERTY_CONDITION',
  'DOCUMENTATION',
  'NEGOTIATION',
  'ANOTHER_VISIT',
  'LOAN_REQUIRED',
  'OTHER',
];

const FOLLOWUP_MODE = ['CALL', 'WHATSAPP', 'SMS', 'EMAIL', 'IN_PERSON'];

/**
 * `[lng, lat]`, exactly two finite numbers in range, and not null island.
 *
 * F-13 applies to executive check-ins for the same reason it applies to properties: a
 * defaulted or unchecked geometry is a search that silently matches everywhere, or nowhere.
 */
const coordinates = Joi.array()
  .length(2)
  .items(Joi.number().min(-180).max(180).required())
  .required()
  .messages({
    'array.length': '{{#label}} needs exactly 2 values: [longitude, latitude]',
  })
  .custom((value, helpers) => {
    const [lng, lat] = value;
    if (lng === 0 && lat === 0) {
      return helpers.error('any.invalid');
    }
    return value;
  })
  .messages({
    'any.invalid': '{{#label}} [0, 0] is null island and is rejected',
  });

/**
 * The named target-state routes.
 *
 * Keyed by target state so the route path carries it — `POST /visits/:id/:status` — and
 * only the transitions in `VISIT_TRANSITIONS` have an entry. A status with no entry cannot
 * be requested, which is how "the target state is a route parameter" stops being a way to
 * smuggle an arbitrary string into the service.
 *
 * This is the *inverse* of the service table: it maps a target to the states that may
 * reach it. `verify.realestate.executive.js` inverts the service table and compares the two,
 * so an entry missing here fails the build rather than silently narrowing the API.
 */
const ALLOWED_NEXT = {
  ACCEPTED: ['ASSIGNED'],
  CHECK_IN: ['ACCEPTED'],
  IN_PROGRESS: ['CHECK_IN'],
  COMPLETED: ['CHECK_IN', 'IN_PROGRESS'],
  CANCELLED: ['ASSIGNED', 'ACCEPTED', 'CHECK_IN', 'IN_PROGRESS'],
};

// ------------------------------------------------------------------ route params

const visitIdParam = Joi.object({
  id: id.required(),
});

const visitTransitionParam = Joi.object({
  id: id.required(),
  status: Joi.string()
    .valid(...Object.keys(ALLOWED_NEXT))
    .required()
    .messages({
      'any.only': '{{#label}} must be one of: {{#valids}}',
    }),
});

const visitIdWithReason = Joi.object({
  id: id.required(),
  reason: Joi.string().trim().min(3).max(500).required(),
});

// Cancel takes the visit from the path and the reason from the body —
// validating `visitIdWithReason` against params alone rejects every
// request, because `reason` never travels in the URL.
const visitCancelBody = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required(),
}).unknown(false);

const followUpIdParam = Joi.object({
  id: id.required(),
});

const leadIdParam = Joi.object({
  leadId: id.required(),
});

const propertyIdParam = Joi.object({
  id: id.required(),
});

// --------------------------------------------------------------------- bodies

/**
 * Geofenced check-in.
 *
 * The radius is NOT accepted from the client. It is frozen on the visit at scheduling time
 * precisely so that widening the geofence is an act of policy on the server; a body field
 * here would let the caller define its own tolerance.
 */
const checkInBody = Joi.object({
  coordinates,
}).unknown(false);

const acceptBody = Joi.object({}).unknown(false).default({});

const completeBody = Joi.object({
  notes: Joi.string().trim().max(2000).allow(''),
}).unknown(false);

/**
 * BR-09 structured interest.
 *
 * `level` and `reason` are closed enums — free-text opinion is not interest. `reasonText`
 * is the single free-text field and is required only for `reason: 'OTHER'`, which is the
 * point of having a reason code at all: "OTHER" is a visible flag that someone declined to
 * categorise, rather than a hole that swallows everything.
 *
 * `reason` is **required**, not optional. BR-09 says interest carries "a reason code from
 * a closed enum", so `reasonText` alone is rejected — otherwise the free-text field becomes
 * a way to record interest with no category at all, which is precisely what the rule
 * forbids. An earlier version here used `.or('reason', 'reasonText')`, which let exactly
 * that through; `verify.realestate.executive.js` check [6] now asserts it is refused.
 */
const interestBody = Joi.object({
  level: Joi.string()
    .valid(...INTEREST_LEVEL)
    .required(),
  reason: Joi.string()
    .valid(...INTEREST_REASON)
    .required(),
  reasonText: Joi.string().trim().max(1000),
})
  .custom((value, helpers) => {
    if (value.reason === 'OTHER' && !value.reasonText) {
      return helpers.message({
        custom: 'reasonText is required when reason is OTHER',
      });
    }
    return value;
  })
  .unknown(false);

const followUpBody = Joi.object({
  // `Date.now()` called — passing `Date.now` bare hands Joi a function reference and
  // throws "date must have a valid date format or reference" at require time.
  nextFollowUpAt: Joi.date().min(Date.now()).required(),
  mode: Joi.string()
    .valid(...FOLLOWUP_MODE)
    .required(),
  notes: Joi.string().trim().max(2000).allow(''),
}).unknown(false);

const locationBody = Joi.object({
  coordinates,
}).unknown(false);

// -------------------------------------------------------------------- queries

/**
 * Visit list filters.
 *
 * `executive` is absent deliberately — the executive is always the token holder. Accepting
 * it from the query string would make the scoping a client decision, which is the exact
 * mistake the tenant middleware exists to prevent.
 */
const listVisitsQuery = Joi.object({
  status: Joi.string().valid(...VISIT_STATUS),
  lead: id,
  property: id,
  from: Joi.date().iso(),
  to: Joi.date().iso(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

const dashboardQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
}).unknown(true);

/**
 * ## The export shape — this was silently broken
 *
 * `src/middlewares/validate.js` does `pick(schema, ['params', 'query', 'body'])` and returns
 * `next()` immediately when nothing matched. Every export below was originally a **bare**
 * Joi schema, so `validate(V.checkInBody)` selected nothing and **every executive route ran
 * with no validation at all** — 16 routes, including the BR-08 check-in.
 *
 * That mattered most on `/visits/:id/check_in`: the null-island rejection in `coordinates`
 * was unit-tested and green, but never reached a request, so a client could post
 * `{ "coordinates": [0, 0] }` to start a visit from the Atlantic. The unit test on the
 * schema said "rejected"; the route said "accepted". Only wiring the wrapper up, and then
 * asserting the wrapper, closes that gap.
 *
 * So each export is `{ params }` / `{ body }` / `{ query }`, matching
 * `realestate.public.validation.js`.
 */
module.exports = {
  VISIT_STATUS,
  INTEREST_LEVEL,
  INTEREST_REASON,
  FOLLOWUP_MODE,
  ALLOWED_NEXT,
  coordinates,

  // Raw schemas, for unit testing the shape itself.
  raw: {
    checkInBody,
    acceptBody,
    completeBody,
    interestBody,
    followUpBody,
    locationBody,
    listVisitsQuery,
    dashboardQuery,
    visitIdParam,
    visitTransitionParam,
    visitIdWithReason,
    visitCancelBody,
    followUpIdParam,
    leadIdParam,
    propertyIdParam,
  },

  // Wired shapes, for `validate()`.
  dashboard: { query: dashboardQuery },
  location: { body: locationBody },
  visits: { query: listVisitsQuery },
  visitParams: { params: visitIdParam },
  visitTransitionParams: { params: visitTransitionParam },
  visitCancelParams: { params: visitIdParam, body: visitCancelBody },
  followUpParams: { params: followUpIdParam },
  leadParams: { params: leadIdParam },
  propertyParams: { params: propertyIdParam },
  accept: { body: acceptBody },
  checkIn: { body: checkInBody },
  complete: { body: completeBody },
  notes: { body: completeBody },
  interest: { body: interestBody },
  followUp: { params: leadIdParam, body: followUpBody },
};