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
 * jhatka.payment.service.js — Jhatka's side of the shared payment engine.
 *
 * ## Why the 2,573-line controller was NOT touched
 *
 * The implementation plan (§2.1) listed this as its single **High risk** item: "three
 * `paymentFrom` branches in `payment.initiation.controller.js` ... Additive only, in
 * the same commit as the routes". It was never done, and as things stand the order
 * model carries `paymentFrom: 'jhatka_order'` with nothing anywhere that creates a
 * `PaymentInitiation` for it — so a non-COD Jhatka order could be placed, could not be
 * paid, and could not be delivered.
 *
 * That plan is out of date, and following it would have been the expensive option.
 * `src/utils/payment.dispatch.js` already exists and collapses every `paymentFrom`
 * switch into ONE entry point that each gateway calls after verification. Three
 * verticals use it. Adding Jhatka is three lines in that file and a new module here;
 * the controller is not opened at all.
 *
 * That is worth stating plainly because the plan's High-risk item and this file are
 * the same feature, and the risk evaporated because someone else had already paid it.
 *
 * ## The two subjects
 *
 *   `jhatka_order`         a one-off customer order. Paid once, moves
 *                          CREATED -> PAYMENT_PENDING -> PAID.
 *   `jhatka_subscription`  a subscription's payment. Unlike food tiffin, a Jhatka
 *                          subscription is billed per OCCURRENCE and §9.5's rule
 *                          applies: a prepaid occurrence on a variable-weight variant
 *                          charges the CEILING and is not reconciled afterwards. So
 *                          there is no dunning ladder here to copy from stores.
 *
 * ## Idempotency
 *
 * Gateways retry callbacks and webhooks. `routePaidCallback` is replay-safe: an order
 * already `paid` is a no-op, and an occurrence already `paid` is a no-op. Re-running
 * it can never produce a second `PAID` transition, a second `paidAt`, or a second push.
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const notifyService = require('./jhatka.notify.service');
const lifecycleService = require('./jhatka.order-lifecycle.service');

/**
 * The `paymentFrom` values Jhatka owns.
 *
 * A closed list rather than a prefix test, because `payment.dispatch.js` treats an
 * unclaimed subject as a configuration bug and logs it — and a prefix test would
 * quietly claim a subject belonging to a vertical added later.
 */
const JHATKA_PAYMENT_SUBJECTS = Object.freeze(['jhatka_order', 'jhatka_subscription']);

const isJhatkaSubject = (paymentFrom) => JHATKA_PAYMENT_SUBJECTS.includes(paymentFrom);

/**
 * Route a verified gateway callback to its Jhatka side effect.
 *
 * The contract with `payment.dispatch.js`: return `true` when the subject is
 * Jhatka-owned, `false` to let the dispatch continue.
 *
 * @param {object} payment the initiation document, with `jhatkaOrder` /
 *                        `jhatkaOccurrence` populated
 * @returns {Promise<boolean>}
 */
const routePaidCallback = async (payment) => {
  if (!payment || !isJhatkaSubject(payment.paymentFrom)) return false;

  if (payment.paymentFrom === 'jhatka_order') {
    await applyOrderPayment(payment);
    return true;
  }

  await applySubscriptionPayment(payment);
  return true;
};

/**
 * Apply a lifecycle transition, honouring the ONE transition table.
 *
 * `jhatka.order-lifecycle.service` is the owner of §8.2. This used to be a local
 * helper calling `mongoose.model('JhatkaOrder').canTransition`, which reads a
 * DIFFERENT rule set from the one the partner routes enforced — a paid order could be
 * moved backwards by one path and not the other.
 *
 * The table is read from the model, and `patch` is applied in the SAME save as the
 * transition. Splitting them is how an order ends up in `PAID` with no `paidAt`: paid
 * on the dashboard, unpaid in the settlement.
 */
const transitionOrder = async (order, to, patch = {}) => {
  if (!lifecycleService.canTransition(order.lifecycle, to)) return false;
  order.lifecycle = to;
  Object.assign(order, patch);
  await order.save();
  return true;
};

/**
 * A verified gateway payment for a customer order.
 *
 * Order matters and is asserted by the transition table, not by convention:
 *
 *   CREATED -> PAYMENT_PENDING   at INITIATION (see initiateOrderPayment)
 *   PAYMENT_PENDING -> PAID     here, on a VERIFIED gateway callback
 *
 * A callback arriving for an order still in `CREATED` (initiation raced the webhook,
 * which some gateways do) is advanced through `PAYMENT_PENDING` first rather than
 * refused — the money genuinely arrived, and refusing would strand a paid order.
 * This is the same two-step `stores.payment.service.js` performs, and for the same
 * reason.
 */
const applyOrderPayment = async (payment) => {
  const orderId = payment.jhatkaOrder || payment.paymentRef;
  const order = await mongoose.model('JhatkaOrder').findById(orderId);
  if (!order) {
    console.error(`[jhatka.payment] jhatka_order callback for missing order ${orderId}`);
    return;
  }

  // Webhook replay. Everything below is idempotent, but returning here means the
  // customer is not pushed a second "payment received" for one payment.
  if (order.paymentStatus === 'paid' && order.payment && String(order.payment) === String(payment._id)) {
    return;
  }

  if (order.lifecycle === 'CREATED') {
    await transitionOrder(order, 'PAYMENT_PENDING');
  }
  if (order.lifecycle === 'PAYMENT_PENDING') {
    await transitionOrder(order, 'PAID', {
      payment: payment._id,
      paymentRef: payment.paymentRef || order.paymentRef,
      paymentStatus: 'paid',
      paidAt: new Date(),
      paidAmount: order.estimatedTotal,
    });
  }

  await notifyService.notifyCustomer(order.customer, 'order_paid', {
    orderNo: order.orderNo,
    outletName: order.outletSnapshot?.name,
  });

  await notifyService.notifyOutlet(order.outlet, 'order_paid', {
    orderNo: order.orderNo,
    customerName: order.addressSnapshot?.name,
    estimatedTotal: order.estimatedTotal,
  });
};

/**
 * A verified gateway payment for a subscription OCCURRENCE.
 *
 * `JhatkaRecurringOrder` is the thing being paid — one row per `{subscription,
 * occurrenceDate}`, which is §9.2's idempotency anchor and already unique in the
 * database. Payment therefore attaches to an occurrence, never to the subscription:
 * a subscription has many occurrences and a payment does not cover all of them.
 *
 * The amount charged is the occurrence's ceiling, computed when the occurrence was
 * generated (§9.5, BR-16). This function does not recompute it, because the ceiling
 * was frozen against the catalogue price at generation time and recomputing it here
 * would silently re-price a delivery the customer was already told about.
 */
const applySubscriptionPayment = async (payment) => {
  const occurrenceId = payment.jhatkaOccurrence || payment.jhatkaSubscription;
  const occurrence = await mongoose.model('JhatkaRecurringOrder').findById(occurrenceId);
  if (!occurrence) {
    console.error(`[jhatka.payment] jhatka_subscription callback for missing occurrence ${occurrenceId}`);
    return;
  }

  if (occurrence.paymentStatus === 'paid' && occurrence.payment && String(occurrence.payment) === String(payment._id)) {
    return;
  }

  occurrence.paymentStatus = 'paid';
  occurrence.payment = payment._id;
  occurrence.paymentRef = payment.paymentRef || occurrence.paymentRef;
  occurrence.paidAt = new Date();
  // `chargeAmount` is the ceiling frozen at generation (§9.5, BR-16). A getter result
  // is rupees and `paidAmount` is a moneyField whose setter takes rupees — the one
  // correct assignment direction. Never `chargeAmount` raw, which would be paise
  // written into a rupees setter and inflated 100x.
  occurrence.paidAmount = occurrence.chargeAmount ?? occurrence.estimatedAmount;
  await occurrence.save();

  const subscription = await mongoose.model('JhatkaSubscription').findById(occurrence.subscription);
  if (subscription) {
    if (subscription.status === 'pending_payments') {
      subscription.status = 'active';
      subscription.statusReason = 'First payment received';
      await subscription.save();
    }
    await notifyService.notifyCustomer(subscription.customer, 'subscription_active', {
      itemSummary: (subscription.items || []).map((i) => i.nameSnapshot || i.name).filter(Boolean),
      scheduleText: subscription.scheduleType,
      startDate: subscription.startDate,
    });
  }
};

/**
 * Route a FAILED or ABANDONED payment to its Jhatka side effect.
 *
 * ## The difference from the success path, and why it is smaller
 *
 * Success moves the order FORWARD and records what was paid. Failure records that
 * nothing was paid and stops. There is no refund to raise (no money moved), no stock
 * to release (a gateway order reserves nothing before `start-preparation`, which a
 * never-paid order cannot reach), and no payout to adjust.
 *
 * The order goes to `PAYMENT_FAILED` and STOPS there. That is deliberate:
 * `PAYMENT_FAILED: ['PAYMENT_PENDING', 'CANCELLED']` exists so the customer can retry,
 * and an order that jumped straight to `CANCELLED` would close the door on the one
 * case where retrying is exactly right — a card that was declined and can be replaced.
 *
 * The abandoned case (customer walked away, no callback at all) is `closeAbandonedOrder`
 * in the sweep, which does go on to `CANCELLED`. Different situations, different ends:
 * someone who might come back gets a door left open, someone who never will does not.
 *
 * @param {object} payment the initiation document
 * @param {string} [reason] human-readable, stored on the order
 * @returns {Promise<boolean>} true when the subject was Jhatka-owned
 */
const routeFailedCallback = async (payment, reason) => {
  if (!payment || !isJhatkaSubject(payment.paymentFrom)) return false;

  const orderId = payment.jhatkaOrder;
  if (!orderId) {
    // A subscription occurrence carries its own failure semantics and is handled by
    // the billing sweep, which owns the ceiling and the credit rules. Failing one here
    // would need to decide between "retry", "skip" and "credit", and that decision is
    // §9.6's, not this function's.
    console.error(
      `[jhatka.payment] ${payment.paymentFrom} failure with no jhatkaOrder — left to the billing sweep`
    );
    return true;
  }

  const order = await mongoose.model('JhatkaOrder').findById(orderId);
  if (!order) {
    console.error(`[jhatka.payment] failure callback for missing order ${orderId}`);
    return true;
  }

  if (order.lifecycle !== 'PAYMENT_PENDING') {
    // A late failure after a success — some gateways confirm then decline on a second
    // webhook. Refusing here is correct: moving a PAID order to PAYMENT_FAILED would
    // stop a delivered order being settled.
    console.error(
      `[jhatka.payment] failure for order ${orderNo(order)} already at ${order.lifecycle}; ignored`
    );
    return true;
  }

  await lifecycleService.moveTo(order, 'PAYMENT_FAILED', {
    paymentStatus: 'failed',
  });

  await notifyService.notifyCustomer(order.customer, 'order_payment_failed', {
    orderNo: order.orderNo,
    reason: reason || 'The payment was not completed.',
  });

  return true;
};

const orderNo = (order) => (order && order.orderNo) || String(order && order._id);

/**
 * Create (or reuse) a gateway initiation for a customer's Jhatka order.
 *
 * ## The amount is read from the order, never from the request
 *
 * `estimatedTotal` is frozen at checkout and BR-06 guarantees it can only ever fall,
 * never rise. Reading it here rather than accepting `req.body.amount` means a client
 * cannot pay ₹1 for a ₹900 order and a client cannot pay more than they owe. That is
 * the same rule `stores.payment.service.js` states for `grandTotal`, and it is the
 * reason the money fields are `moneyField` at all.
 *
 * Moving the order to `PAYMENT_PENDING` here is not decoration: it is what arms the
 * unpaid-order sweep, and it is what makes a `PAYMENT_FAILED` callback legal
 * (`PAYMENT_PENDING: ['PAID', 'PAYMENT_FAILED', 'CANCELLED']`).
 *
 * @param {object}  args
 * @param {string}  args.orderId
 * @param {string}  args.customerId
 * @param {string}  args.paymentConfigId
 * @param {string} [args.paymentRef]
 * @returns {Promise<object>} the PaymentInitiation document
 */
const initiateOrderPayment = async ({ orderId, customerId, paymentConfigId, paymentRef }) => {
  const JhatkaOrder = mongoose.model('JhatkaOrder');
  const PaymentInitiation = mongoose.model('PaymentInitiation');
  const PaymentConfig = mongoose.model('PaymentConfig');

  const order = await JhatkaOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (String(order.customer) !== String(customerId)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'ORDER_NOT_OWNED: this order belongs to another customer');
  }
  if (order.paymentMode !== 'gateway') {
    throw new ApiError(httpStatus.CONFLICT, 'Jhatka_ORDER_NOT_GATEWAY: this order is not a gateway order');
  }
  if (order.paymentStatus === 'paid') {
    throw new ApiError(httpStatus.CONFLICT, 'JHATKA_ORDER_ALREADY_PAID');
  }
  if (!['CREATED', 'PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(order.lifecycle)) {
    throw new ApiError(httpStatus.CONFLICT, `JHATKA_ORDER_NOT_PAYABLE: lifecycle is ${order.lifecycle}`);
  }

  const config = await PaymentConfig.findById(paymentConfigId);
  if (!config || config.status === false) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment gateway not available');
  }

  // One open initiation per order. A customer who taps Pay twice, or whose app
  // retries, gets the same row back rather than a second charge at the gateway.
  const open = await PaymentInitiation.findOne({
    jhatkaOrder: order._id,
    paymentFrom: 'jhatka_order',
    status: 'initiated',
  }).sort({ createdAt: -1 });
  if (open) return open;

  if (order.lifecycle !== 'PAYMENT_PENDING') {
    order.lifecycle = 'PAYMENT_PENDING';
    await order.save();
  }

  return PaymentInitiation.create({
    user: customerId,
    payment: config._id,
    jhatkaOrder: order._id,
    // estimatedTotal is what the customer owes. `paidAmount` is written from this
    // same field when the callback lands, so the two can never disagree.
    amount: order.estimatedTotal,
    paymentRef: paymentRef || `JHATKA-ORDER-${order.orderNo}`,
    paymentFrom: 'jhatka_order',
  });
};

/**
 * Create (or reuse) a gateway initiation for a subscription occurrence.
 *
 * @param {object}  args
 * @param {string}  args.occurrenceId
 * @param {string}  args.customerId
 * @param {string}  args.paymentConfigId
 * @param {string} [args.paymentRef]
 * @returns {Promise<object>} the PaymentInitiation document
 */
const initiateSubscriptionPayment = async ({ occurrenceId, customerId, paymentConfigId, paymentRef }) => {
  const JhatkaRecurringOrder = mongoose.model('JhatkaRecurringOrder');
  const PaymentInitiation = mongoose.model('PaymentInitiation');
  const PaymentConfig = mongoose.model('PaymentConfig');

  const occurrence = await JhatkaRecurringOrder.findById(occurrenceId);
  if (!occurrence) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription occurrence not found');
  if (occurrence.paymentStatus === 'paid') {
    throw new ApiError(httpStatus.CONFLICT, 'JHATKA_OCCURRENCE_ALREADY_PAID');
  }

  const subscription = await mongoose.model('JhatkaSubscription').findById(occurrence.subscription);
  if (!subscription) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
  if (String(subscription.customer) !== String(customerId)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'SUBSCRIPTION_NOT_OWNED: this subscription belongs to another customer');
  }
  if (subscription.paymentMode !== 'gateway') {
    throw new ApiError(httpStatus.CONFLICT, 'SUBSCRIPTION_NOT_GATEWAY: this subscription is not prepaid online');
  }

  // No config id means "whichever gateway the outlet uses". Resolved here rather
  // than refused, because subscriptions have no quote endpoint to discover one
  // through (unlike orders, which resolve via checkoutQuote) — and refusing would
  // make pay-occurrence unreachable from any client that does not already know a
  // config id. Mirrors the billing sweep's pickPaymentConfig, same precedence.
  let config = null;
  if (paymentConfigId) {
    config = await PaymentConfig.findById(paymentConfigId);
  }
  if (!config) {
    config = await PaymentConfig.findOne({ status: true, isDefault: true }).lean()
      || await PaymentConfig.findOne({ status: true }).lean();
  }
  if (!config || config.status === false) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment gateway not available');
  }

  const open = await PaymentInitiation.findOne({
    jhatkaOccurrence: occurrence._id,
    paymentFrom: 'jhatka_subscription',
    status: 'initiated',
  }).sort({ createdAt: -1 });
  if (open) return open;

  // §9.5: the CEILING, frozen when the occurrence was generated. Never recomputed.
  const amount = occurrence.chargeAmount ?? occurrence.estimatedAmount;

  return PaymentInitiation.create({
    user: customerId,
    payment: config._id,
    jhatkaOccurrence: occurrence._id,
    jhatkaSubscription: subscription._id,
    amount,
    paymentRef: paymentRef || `JHATKA-SUB-${String(occurrence._id).slice(-8).toUpperCase()}`,
    paymentFrom: 'jhatka_subscription',
  });
};

/**
 * How long an order may sit in `PAYMENT_PENDING` before the sweep gives up on it.
 *
 * ## Why this number is generous
 *
 * The dominant abandonment is not a decline — it is a customer who tapped Pay, put the
 * phone down to find a wallet, and came back. Too short and you cancel an order whose
 * payment is thirty seconds from succeeding, which is the worst possible outcome: the
 * customer pays and the order is gone.
 *
 * Twenty minutes covers that comfortably. It also has to exceed the time a customer
 * might spend on a bank 3-D Secure challenge, which on some Indian banks is slow
 * enough to be uncomfortable.
 *
 * Fresh meat sharpens the problem in both directions: the stock is perishable, so a
 * held order is a wasted order, and a customer with a live payment page open is a
 * customer who will pay.
 *
 * Overridable per outlet, because a busy counter may want longer and a single-person
 * shop may want to free the stock sooner.
 */
const DEFAULT_PAYMENT_TIMEOUT_MINUTES = 20;

/**
 * Close out payments that were started and never finished.
 *
 * ## What this is for
 *
 * `PaymentInitiation.status` is only ever written `paid` or left at `initiated`. A
 * customer who abandons checkout leaves an order sitting at `PAYMENT_PENDING` with no
 * way out: the order is not cancellable by the outlet (`PAID`'s successors all require
 * `OUTLET_RECEIVED`, which a gateway order cannot reach until it is paid), so it
 * occupies the customer's attention and the outlet's queue indefinitely.
 *
 * ## What it does, in order
 *
 *   1. claims the initiation row with a guarded conditional update, so two overlapping
 *      sweeps cannot both close it;
 *   2. moves the order `PAYMENT_PENDING -> PAYMENT_FAILED -> CANCELLED` through the
 *      lifecycle service, so the history shows WHY it ended rather than just that it
 *      did;
 *   3. tells the customer.
 *
 * ## Why it goes all the way to CANCELLED rather than stopping at PAYMENT_FAILED
 *
 * `PAYMENT_FAILED` exists so a customer can RETRY (`PAYMENT_FAILED: ['PAYMENT_PENDING',
 * ...]`). An order nobody came back for is not a retry, it is a corpse. Leaving it at
 * `PAYMENT_FAILED` would leave a live-looking order in the outlet's queue forever and
 * `PAYMENT_FAILED` would stop meaning "retryable".
 *
 * ## Why no stock is released
 *
 * A single customer order reserves NOTHING at placement. `JhatkaInventoryItem.reserved`
 * is only touched by the subscription path (§9.4) and by `start-preparation`, which is
 * unreachable from a gateway order that was never paid. Verified by reading the order
 * creation service, which writes the order and nothing else. If that ever changes,
 * this function must release — and the comment above is the place to notice.
 *
 * @returns {Promise<{scanned: number, cancelled: number, failures: Array}>}
 */
async function sweepAbandonedPayments({ models, minutes, actor } = {}) {
  const { JhatkaOrder, JhatkaOutlet } = models;

  const cutoff = new Date(Date.now() - (minutes ?? DEFAULT_PAYMENT_TIMEOUT_MINUTES) * 60000);

  const stale = await JhatkaOrder.find({
    lifecycle: 'PAYMENT_PENDING',
    paymentMode: 'gateway',
    createdAt: { $lte: cutoff },
  })
    .select('orderNo customer outlet paymentMode lifecycle createdAt')
    .lean();

  const result = { scanned: stale.length, cancelled: 0, failures: [] };

  for (const order of stale) {
    // Per-outlet override, read once per order rather than per outlet, because this
    // runs hourly over every stale order in the system.
    let effectiveMinutes = minutes ?? DEFAULT_PAYMENT_TIMEOUT_MINUTES;
    if (!minutes && order.outlet) {
      const outlet = await JhatkaOutlet.findById(order.outlet)
        .select('orderConfig.paymentTimeoutMinutes')
        .lean();
      const override = outlet?.orderConfig?.paymentTimeoutMinutes;
      if (Number.isFinite(override) && override > 0) effectiveMinutes = override;
    }

    if (new Date(order.createdAt).getTime() > Date.now() - effectiveMinutes * 60000) {
      continue; // an outlet with a longer window; not actually stale
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      await closeAbandonedOrder({ models, orderId: order._id, actor });
      result.cancelled += 1;
    } catch (error) {
      result.failures.push({ order: String(order._id), message: error.message });
    }
  }

  return result;
}

/**
 * Close one abandoned order. Exported so the sweep and a manual admin action share it.
 *
 * Idempotent: an order already moved on is a no-op rather than a throw, because the
 * sweep will see it again on the next run until it leaves `PAYMENT_PENDING`.
 */
async function closeAbandonedOrder({ models, orderId, actor } = {}) {
  const { JhatkaOrder, PaymentInitiation } = models;

  const order = await JhatkaOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (order.lifecycle !== 'PAYMENT_PENDING') {
    return { order, closed: false, reason: `already ${order.lifecycle}` };
  }

  // Close the initiation first, guarded. Two concurrent sweeps both reading
  // `initiated` and both writing `cancelled` would double-count the closure; the
  // conditional update makes the second one a no-op.
  if (PaymentInitiation) {
    await PaymentInitiation.updateMany(
      { jhatkaOrder: order._id, status: 'initiated' },
      { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: actor || null } }
    );
  }

  await lifecycleService.moveTo(order, 'PAYMENT_FAILED', {
    paymentStatus: 'failed',
    hold: undefined,
  });
  await lifecycleService.moveTo(order, 'CANCELLED', {
    cancellation: {
      cancelledAt: new Date(),
      cancelledBy: 'system',
      cancelledByUserId: actor?._id ?? null,
      reason: 'Payment was never completed and the order expired',
      reasonCategory: 'payment_timeout',
      stage: 'PAYMENT_PENDING',
      // Nothing was ever collected, so there is nothing to return. Stating zero is
      // not the same as leaving it null: a null here reads as "unknown" to the
      // settlement job.
      refundAmount: 0,
      refundMethod: 'none',
    },
  });

  await notifyService.notifyCustomer(order.customer, 'order_cancelled', {
    orderNo: order.orderNo,
    refundNote: 'Nothing was charged — you were not charged for this order.',
  });

  return { order, closed: true, reason: 'payment_timeout' };
}

module.exports = {
  JHATKA_PAYMENT_SUBJECTS,
  isJhatkaSubject,
  routePaidCallback,
  applyOrderPayment,
  applySubscriptionPayment,
  initiateOrderPayment,
  initiateSubscriptionPayment,
  sweepAbandonedPayments,
  closeAbandonedOrder,
  routeFailedCallback,
  DEFAULT_PAYMENT_TIMEOUT_MINUTES,
};