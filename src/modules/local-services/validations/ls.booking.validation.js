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
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const createBookingBody = {
  body: Joi.object()
    .keys({
      categoryKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
      subcategoryKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
      serviceKey: Joi.string().trim().lowercase().max(64).allow(null, ''),
      bookingMode: Joi.string().valid('INSTANT', 'SLOT', 'REQUEST', 'DATE_RANGE', 'RECURRING').required(),
      scheduledAt: Joi.date(),
      startAt: Joi.date(),
      endAt: Joi.date().greater(Joi.ref('startAt')),
      address: objectId.allow(null),
      labourAmount: Joi.number().min(0).max(10000000).required(),
      partsAmount: Joi.number().min(0).max(10000000).default(0),
      resource: objectId.allow(null),
      paymentMode: Joi.string().valid('gateway', 'wallet', 'cod', 'direct'),
      // Optional server-side pricing: when present the backend builds items[]
      // from mode+rates (never trusts client totals).
      pricing: Joi.object()
        .keys({
          pricingMode: Joi.string().valid('FIXED', 'VARIANT', 'HOURLY', 'UNIT_BASED', 'DATE_BASED').required(),
          basePrice: Joi.number().min(0),
          variantPrice: Joi.number().min(0),
          hourlyRate: Joi.number().min(0),
          hours: Joi.number().min(0),
          unitRate: Joi.number().min(0),
          quantity: Joi.number().min(0),
          nightlyRate: Joi.number().min(0),
          nights: Joi.number().min(0),
          addons: Joi.array().items(Joi.object().keys({ label: Joi.string().required(), price: Joi.number().min(0).required(), quantity: Joi.number().min(0).default(1) })),
          discountAmount: Joi.number().min(0).default(0),
          taxPercent: Joi.number().min(0).max(100).default(0),
          inspection: Joi.object().keys({
            fee: Joi.number().min(0).required(),
            treatment: Joi.string().valid('additional', 'credited').required(),
          }),
        })
        .unknown(false),
    })
    .unknown(false),
};

const bookingIdParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

const transitionParam = {
  params: Joi.object().keys({ id: objectId.required(), status: Joi.string().required() }),
};

const quoteBody = {
  body: Joi.object()
    .keys({
      labourAmount: Joi.number().min(0).required(),
      partsAmount: Joi.number().min(0).required(),
      scopeOfWork: Joi.string().max(2000).allow(''),
      expiresAt: Joi.date().required(),
    })
    .unknown(false),
};

const rescheduleBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      scheduledAt: Joi.date(),
      startAt: Joi.date(),
      endAt: Joi.date(),
      reason: Joi.string().max(500).allow(''),
    })
    .or('scheduledAt', 'startAt')
    .unknown(false),
};

const disputeBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys({ reason: Joi.string().max(1000).allow('') }).unknown(false),
};

const reviewBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      rating: Joi.number().integer().min(1).max(5).required(),
      comment: Joi.string().max(2000).allow(''),
    })
    .unknown(false),
};

const assignBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({ staff: objectId.allow(null), resource: objectId.allow(null) })
    .unknown(false),
};

const complaintBody = {
  body: Joi.object()
    .keys({
      booking: objectId.allow(null),
      reason: Joi.string().max(1000).required(),
    })
    .unknown(false),
};

const refundDecisionBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      decision: Joi.string().valid('approved', 'rejected').required(),
      gatewayRefundReference: Joi.string().max(200).allow('', null),
    })
    .unknown(false),
};

module.exports = { createBookingBody, bookingIdParam, transitionParam, quoteBody, rescheduleBody, disputeBody, reviewBody, assignBody, complaintBody, refundDecisionBody };
