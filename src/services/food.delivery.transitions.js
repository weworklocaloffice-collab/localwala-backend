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
 * food.delivery.transitions.js — the food vertical's order/rider state machine.
 *
 * ## Why this exists
 *
 * Food order and rider-offer transitions were bare string assignments
 * scattered across `orders.service.js` (16k lines): any status could be
 * written from any other status, so an order could jump `created → delivered`
 * without ever being prepared, and no error would say so. Stores has
 * `DELIVERY_TRANSITIONS` and Jhatka has `assertTransition`; food had neither
 * (plan D-12). This mirrors the stores pattern — a transition table plus an
 * assertion — for the three food-side enums.
 *
 * ## Adoption, deliberately gradual
 *
 * The tables encode the lifecycle every existing writer already follows
 * (verified against the actual writes in `orders.service.js`), so asserting
 * them changes nothing today. New code — the dispatch engine's `driverAssign`
 * writes and `transitionFoodOrderStatus()` — asserts. Legacy writers adopt
 * one function at a time; each adoption turns a silent corruption into a
 * `409 ILLEGAL_FOOD_ORDER_MOVE`.
 *
 * Lives in `services/`, not `kernel/`, for the same reason the dispatch
 * orchestration does (plan §8.3): it names food statuses, so a vertical
 * adopting this copies the pattern, not the file.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../utils/ApiError');

/**
 * `Orders.status`. Read off the actual writers:
 * created (checkout) → preparing (prepareOrder) → ready (orderReady) →
 * handover (restuarantOrderHandoverDriver) → ongoing (driverPickupOrder) →
 * delivered (restaurantOrderHandoverCustomer). Scheduled orders pass through
 * `accepted` first; cancellation/rejection can land from any live state.
 *
 * Operational states loop to themselves: re-preparing an order to swap its
 * rider (the manual-override path) is a retry, not a corruption. Terminal
 * states never loop — a second `delivered` write would re-run wallet
 * settlement, so it stays a 409.
 */
const FOOD_ORDER_TRANSITIONS = Object.freeze({
  pending_payments: Object.freeze(['created', 'cancelled']),
  created: Object.freeze(['accepted', 'preparing', 'cancelled', 'rejected']),
  accepted: Object.freeze(['accepted', 'preparing', 'ready', 'cancelled', 'rejected']),
  preparing: Object.freeze(['preparing', 'ready', 'cancelled']),
  ready: Object.freeze(['ready', 'handover', 'cancelled']),
  handover: Object.freeze(['handover', 'ongoing', 'cancelled']),
  ongoing: Object.freeze(['ongoing', 'delivered', 'cancelled']),
  delivered: Object.freeze(['refunded', 'partially_refunded']),
  cancelled: Object.freeze([]),
  rejected: Object.freeze([]),
  refunded: Object.freeze([]),
  partially_refunded: Object.freeze(['refunded']),
});

/**
 * `Orders.driverAssign`. `notfound` is retryable (the engine or a human may
 * still assign); `hardreject` is terminal (the ladder is out of rungs *and*
 * attempts are spent — plan §8.3). Both are already read together by the
 * operations queues, so nothing downstream distinguishes them yet.
 */
const FOOD_DRIVER_ASSIGN_TRANSITIONS = Object.freeze({
  ideal: Object.freeze(['assign', 'rejected', 'notfound', 'hardreject']),
  assign: Object.freeze(['rejected', 'notfound']),
  rejected: Object.freeze(['ideal', 'assign', 'notfound', 'hardreject']),
  notfound: Object.freeze(['ideal', 'assign', 'hardreject']),
  hardreject: Object.freeze([]),
});

/**
 * `DriverNewOrderStatus.driverOrderStatus`. A rejection never revives a row —
 * re-dispatch creates a *new* offer document — so `rejected` is terminal for
 * the row even though the order itself keeps moving.
 */
const FOOD_OFFER_TRANSITIONS = Object.freeze({
  ideal: Object.freeze(['accepted', 'rejected', 'cancelled', 'accepted_another']),
  accepted: Object.freeze([
    'driver_reached_restaurant',
    'driver_pickpup_order',
    'cancelled',
  ]),
  driver_reached_restaurant: Object.freeze(['driver_pickpup_order', 'cancelled']),
  driver_pickpup_order: Object.freeze(['driver_reached_customer', 'cancelled']),
  driver_reached_customer: Object.freeze(['delivered', 'cancelled']),
  rejected: Object.freeze([]),
  cancelled: Object.freeze([]),
  accepted_another: Object.freeze([]),
  delivered: Object.freeze([]),
});

const assertInTable = (table, code, from, to) => {
  const allowed = table[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `${code}: ${from} -> ${to} is not allowed`);
  }
};

/**
 * @param {string} from current `Orders.status`
 * @param {string} to   desired `Orders.status`
 * @throws {ApiError} 409 ILLEGAL_FOOD_ORDER_MOVE
 */
const assertFoodOrderTransition = (from, to) =>
  assertInTable(FOOD_ORDER_TRANSITIONS, 'ILLEGAL_FOOD_ORDER_MOVE', from, to);

/**
 * @param {string} from current `Orders.driverAssign`
 * @param {string} to   desired `Orders.driverAssign`
 * @throws {ApiError} 409 ILLEGAL_DRIVER_ASSIGN_MOVE
 */
const assertFoodDriverAssignTransition = (from, to) =>
  assertInTable(FOOD_DRIVER_ASSIGN_TRANSITIONS, 'ILLEGAL_DRIVER_ASSIGN_MOVE', from, to);

/**
 * @param {string} from current `DriverNewOrderStatus.driverOrderStatus`
 * @param {string} to   desired status
 * @throws {ApiError} 409 ILLEGAL_OFFER_MOVE
 */
const assertFoodOfferTransition = (from, to) =>
  assertInTable(FOOD_OFFER_TRANSITIONS, 'ILLEGAL_OFFER_MOVE', from, to);

const canFoodOrderTransition = (from, to) => {
  const allowed = FOOD_ORDER_TRANSITIONS[from];
  return !!allowed && allowed.includes(to);
};

const canFoodDriverAssignTransition = (from, to) => {
  const allowed = FOOD_DRIVER_ASSIGN_TRANSITIONS[from];
  return !!allowed && allowed.includes(to);
};

const canFoodOfferTransition = (from, to) => {
  const allowed = FOOD_OFFER_TRANSITIONS[from];
  return !!allowed && allowed.includes(to);
};

/**
 * Load an order, assert the move, write it. The single funnel new code uses
 * to change `Orders.status` — one place to add side effects later (events,
 * timestamps) instead of sixteen.
 *
 * @param {string} orderId
 * @param {string} to
 * @param {object} [extra] extra `$set` fields applied with the transition
 * @returns {Promise<object>} the updated order
 */
const transitionFoodOrderStatus = async (orderId, to, extra = {}) => {
  const { Orders } = require('../models');
  const order = await Orders.findById(orderId, { status: 1 });
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  assertFoodOrderTransition(order.status, to);
  return Orders.findByIdAndUpdate(orderId, { $set: { status: to, ...extra } }, { new: true });
};

module.exports = {
  FOOD_ORDER_TRANSITIONS,
  FOOD_DRIVER_ASSIGN_TRANSITIONS,
  FOOD_OFFER_TRANSITIONS,
  assertFoodOrderTransition,
  assertFoodDriverAssignTransition,
  assertFoodOfferTransition,
  canFoodOrderTransition,
  canFoodDriverAssignTransition,
  canFoodOfferTransition,
  transitionFoodOrderStatus,
};
