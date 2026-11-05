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
 * jhatka.customer.validation.js — Joi schemas for the customer surface.
 *
 * Bodies carry evolving client fields, so known fields are typed and the
 * remainder is allowed: params and query stay strict.
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const outletParam = {
  params: Joi.object().keys({
    outlet: objectId.required(),
  }),
};

const productParam = {
  params: Joi.object().keys({
    product: objectId.required(),
  }),
};

const orderIdParam = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};

const orderParam = {
  params: Joi.object().keys({
    order: objectId.required(),
  }),
};

const cartItemParam = {
  params: Joi.object().keys({
    item: objectId.required(),
  }),
};

/**
 * Gateway payment initiation.
 *
 * `amount` is deliberately ABSENT and the schema is `.unknown(false)` rather than
 * `.unknown(true)`, which is the opposite of every other body in this file. Those
 * bodies tolerate unknown keys because clients grow; this one must not, because its
 * whole purpose is to refuse a client-supplied number. The amount is read from
 * `JhatkaOrder.estimatedTotal` in `jhatka.payment.service.initiateOrderPayment` and
 * BR-06 guarantees that value can only ever fall. Anything resembling an amount here
 * is rejected rather than ignored.
 *
 * `payment` is the PaymentConfig id — which gateway to charge through, not how much.
 */
const payBody = {
  body: Joi.object()
    .keys({
      payment: objectId.required(),
      paymentRef: Joi.string().trim().max(120),
    })
    .unknown(false),
};

const subscriptionParam = {
  params: Joi.object().keys({
    subscription: objectId.required(),
  }),
};

/**
 * A subscription occurrence. Both ids are required because the service resolves the
 * occurrence and then checks it belongs to THIS subscription — a mismatched pair must
 * be a 400 rather than an occurrence quietly charged to a subscription the caller
 * does not own.
 */
const subscriptionOccurrenceParams = {
  params: Joi.object().keys({
    subscription: objectId.required(),
    occurrence: objectId.required(),
  }),
};

const quantityShape = Joi.object()
  .keys({
    value: Joi.number().positive().required(),
    unit: Joi.string().required(),
  })
  .unknown(true);

const cartAddBody = {
  body: Joi.object()
    .keys({
      variant: objectId.required(),
      quantity: quantityShape.required(),
    })
    .unknown(true),
};

const cartUpdateBody = {
  body: Joi.object()
    .keys({
      quantity: quantityShape.required(),
    })
    .unknown(true),
};

const checkoutQuoteBody = {
  body: Joi.object()
    .keys({
      outlet: objectId.required(),
      // The SAVED-address id, so the quote can price the delivery band
      // (free ring vs paid ring) for this address. Optional: without it the
      // quote still prices, with deliveryFee 0 and no band promise.
      address: objectId,
    })
    .unknown(true),
};

const orderCreateBody = {
  body: Joi.object()
    .keys({
      outlet: objectId.required(),
      items: Joi.array().min(1).required(),
      paymentMode: Joi.string().valid('gateway', 'cod'),
      // OD-12: allow-listed a second time here even though `.unknown(true)`
      // would pass it through — the checkout contract deserves to be explicit.
      fulfilmentMode: Joi.string().valid('delivery', 'pickup'),
      // The SAVED-address id, not an inline object: the service resolves it
      // against UserAddress scoped by the token's user. Used to be typed
      // Joi.object(), which rejected every real request — invisible because the
      // delivery path was never exercised (the suite placed pickup orders).
      address: objectId,
      // Optional cart id. The order route empties this cart after a successful
      // placement, filtered by customer + outlet, so a foreign id clears nothing.
      cart: objectId,
    })
    .unknown(true),
};

const cancelBody = {
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(3).required(),
    })
    .unknown(true),
};

const complaintBody = {
  body: Joi.object()
    .keys({
      order: objectId,
      subject: Joi.string().required(),
      description: Joi.string().required(),
      category: Joi.string(),
    })
    .unknown(true),
};

const reviewBody = {
  body: Joi.object()
    .keys({
      order: objectId,
      outlet: objectId,
      rating: Joi.number().integer().min(1).max(5).required(),
      comment: Joi.string(),
    })
    .unknown(true),
};

const subscriptionCreateBody = {
  body: Joi.object()
    .keys({
      outlet: objectId.required(),
      items: Joi.array().min(1).required(),
      scheduleType: Joi.string().valid('daily', 'alternate_days', 'weekly', 'custom_days').required(),
      startDate: Joi.date().required(),
    })
    .unknown(true),
};

const subscriptionUpdateBody = {
  body: Joi.object()
    .keys({
      action: Joi.string().valid('pause', 'resume', 'skip', 'cancel', 'quantity', 'schedule'),
      reason: Joi.string(),
    })
    .unknown(true),
};

module.exports = {
  outletParam,
  productParam,
  orderIdParam,
  orderParam,
  cartItemParam,
  subscriptionParam,
  subscriptionOccurrenceParams,
  cartAddBody,
  cartUpdateBody,
  checkoutQuoteBody,
  orderCreateBody,
  cancelBody,
  complaintBody,
  reviewBody,
  subscriptionCreateBody,
  subscriptionUpdateBody,
  payBody,
};
