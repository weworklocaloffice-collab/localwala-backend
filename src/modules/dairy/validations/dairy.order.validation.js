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
const { objectId } = require('../../../validations/custom.validation');

const cartParams = {
  item: Joi.string().custom(objectId).required(),
};

const addToCartValidation = {
  body: Joi.object().keys({
    sku: Joi.string().custom(objectId).required(),
    quantity: Joi.number().integer().min(1).default(1),
  }),
};

const updateCartQuantityValidation = {
  params: Joi.object().keys(cartParams),
  body: Joi.object().keys({
    quantity: Joi.number().integer().min(0).required(),
  }),
};

const cartItemValidation = {
  params: Joi.object().keys(cartParams),
};

const applyPriceChangesValidation = {
  body: Joi.object().keys({
    itemIds: Joi.array().items(Joi.string().custom(objectId)).min(1).required(),
  }),
};

const checkoutValidation = {
  body: Joi.object().keys({
    address: Joi.string().custom(objectId).allow('', null),
    addressRaw: Joi.string().allow('', null),
    receiverName: Joi.string().allow('', null),
    receiverContact: Joi.number().allow('', null),
    coordinates: Joi.array().items(Joi.number()).length(2),
    deliverySlot: Joi.object().keys({
      startTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/),
      endTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
    serviceCharge: Joi.number().min(0).default(0),
    discountAmount: Joi.number().min(0).default(0),
    payment: Joi.string().custom(objectId).allow('', null),
    paymentMode: Joi.string().valid('wallet', 'cod', 'gateway').default('wallet'),
  }),
};

const payValidation = {
  params: Joi.object().keys({ order: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({
    gatewayRef: Joi.string().allow('', null),
  }),
};

const orderDetailValidation = {
  params: Joi.object().keys({ order: Joi.string().custom(objectId).required() }),
  // No `query.user`. Ownership comes from the access token; accepting a user id
  // here only made it look as though the caller could read someone else's order.
};

const orderListValidation = {
  query: Joi.object().keys({
    user: Joi.string().custom(objectId),
    business: Joi.string().custom(objectId),
    status: Joi.string().valid(
      'pending_payments',
      'confirmed',
      'preparing',
      'out_for_delivery',
      'delivered',
      'cancelled',
      'refunded'
    ),
    orderNo: Joi.number().integer(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const orderHistoryValidation = {
  params: Joi.object().keys({ order: Joi.string().custom(objectId).required() }),
  query: Joi.object().keys({ limit: Joi.number().integer() }),
};

/**
 * The caller's own order summary.
 *
 * No `user` and no `business`: both are derived from the token, so there is
 * nothing here to widen the query with.
 */
const orderSummaryValidation = {
  query: Joi.object().keys({
    from: Joi.date().allow('', null),
    to: Joi.date().allow('', null),
  }),
};

const actorBody = {
  actorType: Joi.string().valid('customer', 'partner', 'driver', 'admin', 'system').default('system'),
};

/**
 * `toStatus` comes from the route rather than the body, so a client cannot set an
 * arbitrary status and bypass the transition table.
 */
const statusValidation = {
  params: Joi.object().keys({
    status: Joi.string()
      .valid('confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')
      .required(),
    order: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    reason: Joi.string().allow('', null),
    note: Joi.string().allow('', null),
    location: Joi.string().allow('', null),
    proof: Joi.object().keys({
      photo: Joi.string().allow('', null),
      signature: Joi.string().allow('', null),
    }),
    ...actorBody,
  }),
};

const cancelValidation = {
  params: Joi.object().keys({ order: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({
    reason: Joi.string().allow('', null),
    ...actorBody,
  }),
};

const dispatchValidation = {
  params: Joi.object().keys({ order: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({
    serviceDate: Joi.date().allow('', null),
    slot: Joi.object().keys({
      startTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required(),
      endTime: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).required(),
    }),
  }),
};

const summaryValidation = {
  query: Joi.object().keys({
    from: Joi.date().allow('', null),
    to: Joi.date().allow('', null),
  }),
};

module.exports = {
  addToCartValidation,
  updateCartQuantityValidation,
  cartItemValidation,
  applyPriceChangesValidation,
  checkoutValidation,
  payValidation,
  orderDetailValidation,
  orderListValidation,
  orderHistoryValidation,
  orderSummaryValidation,
  statusValidation,
  cancelValidation,
  dispatchValidation,
  summaryValidation,
};