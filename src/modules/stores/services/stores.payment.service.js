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
 * stores.payment.service.js — the Local Stores side of the shared payment engine.
 *
 * The plan (§2.1) says: reuse the gateway stack, add `storeOrders` and
 * `storeSubscription` subjects. The gateway stack (`src/controllers/
 * payment.initiation.controller.js`) stays vertical-agnostic: on every paid
 * callback it asks this module FIRST whether the subject is stores-owned, via
 * `routePaidCallback`. That one hook covers all 9 gateways, so the gateway
 * file carries no stores logic beyond the hook line itself.
 *
 * This service writes `PaymentInitiation` rows directly through the shared
 * model instead of requiring the legacy initiation service: the row is the
 * integration point, and `makePayment` (gateway checkout) plus `paymentInfo`
 * already read these rows generically. There is no second payment stack here —
 * initiation, gateway redirect, and capture all run through the shared engine.
 *
 * Idempotency: gateway callbacks and webhooks retry. Both `apply*` functions
 * are safe to run twice — an order that is already `paid`, or a subscription
 * payment row that is already `success`, is a no-op.
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const orderService = require('./stores.order.service');
const subscriptionService = require('./stores.subscription.service');
const notifyService = require('./stores.notify.service');

const STORE_PAYMENT_SUBJECTS = Object.freeze(['storeOrders', 'storeSubscription']);

const isStoreSubject = (paymentFrom) => STORE_PAYMENT_SUBJECTS.includes(paymentFrom);

/**
 * Route a paid gateway callback to the correct stores side effect.
 *
 * @param {object} payment the initiation document (`paymentInfo.payments`), with
 *                         `paymentFrom`, `storeOrder` / `storeSubscriptionPayment`.
 * @returns {Promise<boolean>} true when the subject was stores-owned (and therefore
 *                             handled here); false when the gateway controller
 *                             must continue with its own subject dispatch.
 */
const routePaidCallback = async (payment) => {
  if (!payment || !isStoreSubject(payment.paymentFrom)) return false;
  if (payment.paymentFrom === 'storeOrders') {
    await applyStoreOrderPayment(payment);
    return true;
  }
  await applyStoreSubscriptionPayment(payment);
  return true;
};

const applyStoreOrderPayment = async (payment) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const order = await StoreOrder.findById(payment.storeOrder);
  if (!order) {
    console.error(`storeOrders callback for missing order ${payment.storeOrder}`);
    return;
  }
  // Replay-safe: the second delivery of the same callback changes nothing.
  if (order.paymentStatus === 'paid') return;
  if (order.lifecycle === 'created') {
    await orderService.transitionOrder(order._id, 'payment_pending');
  }
  if ((await StoreOrder.findById(order._id).select('lifecycle').lean()).lifecycle === 'payment_pending') {
    await orderService.transitionOrder(order._id, 'paid');
  }
  await notifyService.notifyStoreEvent(order.customer, 'order_payment_received', {
    orderNo: order.orderNo,
    amount: order.grandTotal,
  });
};

const applyStoreSubscriptionPayment = async (payment) => {
  const StoreSubscriptionPayment = mongoose.model('StoreSubscriptionPayment');
  const StoreSubscription = mongoose.model('StoreSubscription');
  const row = await StoreSubscriptionPayment.findById(payment.storeSubscriptionPayment);
  if (!row) {
    console.error(`storeSubscription callback for missing payment row ${payment.storeSubscriptionPayment}`);
    return;
  }
  if (row.status === 'success') return; // webhook replay

  row.status = 'success';
  row.paidAt = new Date();
  row.gatewayReference = payment.paymentRef || row.gatewayReference;
  await row.save();

  // The paid period restarts from every dunning rung. A subscription that is
  // already `active` (renewal paid early) needs no transition — and `active`
  // has no self-edge, so attempting one would throw.
  const sub = await StoreSubscription.findById(row.subscription);
  if (sub && sub.status !== 'active') {
    const allowed = subscriptionService.SUBSCRIPTION_TRANSITIONS[sub.status] || [];
    if (allowed.includes('active')) {
      await subscriptionService.transitionSubscription(sub._id, 'active', { notes: 'gateway payment received' });
    } else {
      console.error(`storeSubscription ${sub._id} paid while in ${sub.status}; left for admin review`);
    }
  }
  if (sub) {
    const Business = mongoose.model('Business');
    const business = await Business.findById(sub.business).select('owner').lean();
    if (business && business.owner) {
      await notifyService.notifyStoreEvent(business.owner, 'subscription_payment_received', {
        amount: row.amount,
      });
    }
  }
};

/**
 * Create (or reuse) a gateway initiation for a customer's store order.
 *
 * The order moves `created -> payment_pending` at initiation, which is also
 * what arms the unpaid-order auto-cancel: an initiation that is never paid
 * releases its stock and closes the order on the next expiry sweep.
 */
const initiateStoreOrderPayment = async ({ orderId, customerId, paymentConfigId, paymentRef }) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const PaymentInitiation = mongoose.model('PaymentInitiation');
  const PaymentConfig = mongoose.model('PaymentConfig');

  const order = await StoreOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Store order not found');
  if (String(order.customer) !== String(customerId)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'ORDER_NOT_OWNED: this order belongs to another customer');
  }
  if (order.paymentMode !== 'gateway') {
    throw new ApiError(httpStatus.CONFLICT, 'STORE_ORDER_NOT_GATEWAY: this order is not a gateway order');
  }
  if (order.paymentStatus === 'paid') {
    throw new ApiError(httpStatus.CONFLICT, 'STORE_ORDER_ALREADY_PAID');
  }
  if (order.lifecycle !== 'created' && order.lifecycle !== 'payment_pending') {
    throw new ApiError(httpStatus.CONFLICT, `STORE_ORDER_NOT_PAYABLE: lifecycle is ${order.lifecycle}`);
  }
  const config = await PaymentConfig.findById(paymentConfigId);
  if (!config || config.status === false) throw new ApiError(httpStatus.NOT_FOUND, 'Payment gateway not available');

  const open = await PaymentInitiation.findOne({
    storeOrder: order._id,
    paymentFrom: 'storeOrders',
    status: 'initiated',
  }).sort({ createdAt: -1 });
  if (open) return open;

  if (order.lifecycle === 'created') {
    await orderService.transitionOrder(order._id, 'payment_pending');
  }

  return PaymentInitiation.create({
    user: customerId,
    payment: config._id,
    storeOrder: order._id,
    amount: order.grandTotal,
    paymentRef: paymentRef || `STORE-ORDER-${order.orderNo}`,
    paymentFrom: 'storeOrders',
  });
};

/**
 * Create (or reuse) a gateway initiation for a chain's subscription payment.
 *
 * The pending `StoreSubscriptionPayment` row is the thing being paid: the
 * renewal sweeps write those rows, and a first payment writes attempt 1 here.
 * Re-paying the same pending row reuses its open initiation instead of
 * minting a second attempt.
 */
const initiateStoreSubscriptionPayment = async ({ subscriptionId, chainId, payerId, paymentConfigId, paymentMethod, paymentRef }) => {
  const StoreSubscription = mongoose.model('StoreSubscription');
  const StoreSubscriptionPayment = mongoose.model('StoreSubscriptionPayment');
  const PaymentInitiation = mongoose.model('PaymentInitiation');
  const PaymentConfig = mongoose.model('PaymentConfig');

  const sub = await StoreSubscription.findById(subscriptionId);
  if (!sub || String(sub.chain) !== String(chainId)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found for this chain');
  }
  const config = await PaymentConfig.findById(paymentConfigId);
  if (!config || config.status === false) throw new ApiError(httpStatus.NOT_FOUND, 'Payment gateway not available');

  const latest = await StoreSubscriptionPayment.findOne({ subscription: sub._id }).sort({ attemptNo: -1 });
  if (latest && latest.status === 'success') {
    throw new ApiError(httpStatus.CONFLICT, 'SUBSCRIPTION_ALREADY_PAID: the latest attempt succeeded');
  }

  let row = latest && latest.status === 'pending' ? latest : null;
  if (!row) {
    try {
      row = await StoreSubscriptionPayment.create({
        subscription: sub._id,
        chain: sub.chain,
        attemptNo: (latest ? latest.attemptNo : 0) + 1,
        amount: sub.totalAmount || sub.amount || 0,
        status: 'pending',
        paymentMethod,
        retryOf: latest ? latest._id : undefined,
      });
    } catch (e) {
      // A parallel initiation won the next attempt number; reuse that row.
      if (e.code === 11000) {
        row = await StoreSubscriptionPayment.findOne({ subscription: sub._id }).sort({ attemptNo: -1 });
      } else {
        throw e;
      }
    }
  }

  const open = await PaymentInitiation.findOne({
    storeSubscriptionPayment: row._id,
    paymentFrom: 'storeSubscription',
    status: 'initiated',
  }).sort({ createdAt: -1 });
  if (open) return open;

  return PaymentInitiation.create({
    user: payerId,
    payment: config._id,
    storeSubscriptionPayment: row._id,
    amount: row.amount,
    paymentRef: paymentRef || `STORE-SUB-${String(sub._id).slice(-6).toUpperCase()}-A${row.attemptNo}`,
    paymentFrom: 'storeSubscription',
  });
};

module.exports = {
  STORE_PAYMENT_SUBJECTS,
  isStoreSubject,
  routePaidCallback,
  applyStoreOrderPayment,
  applyStoreSubscriptionPayment,
  initiateStoreOrderPayment,
  initiateStoreSubscriptionPayment,
};
