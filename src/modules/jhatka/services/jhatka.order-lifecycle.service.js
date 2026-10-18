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
 * jhatka.order-lifecycle.service.js — one owner for §8.2.
 *
 * ## The duplication this removes
 *
 * The order state machine was enforced THREE different ways in the same vertical:
 *
 *   1. `partner.orders.route.js` declared `assertTransition` inline — an enum-index
 *      comparison plus terminal/sideways lists — and exported it as a route helper.
 *   2. `jhatka.weigh.service.js` RECEIVED it as an injected parameter, threaded in by
 *      the route on every call.
 *   3. `jhatka.payment.service.js` called the model's `canTransition` static directly,
 *      which reads `ORDER_TRANSITIONS` — a DIFFERENT rule set from (1).
 *
 * Those are not two views of one rule. (1) forbids moving backwards and forbids
 * leaving a terminal state. (3) allows neither check explicitly, because
 * `ORDER_TRANSITIONS[from]` simply does not list the target. They agree today. They
 * would not survive an edit to one of them, and a paid order that could be moved
 * backwards to `PREPARING` is a deliverable-without-payment.
 *
 * ## Which rule is authoritative
 *
 * The model's `ORDER_TRANSITIONS`, because it is the one place §8.2 is written down
 * and the one the verify suite already reads. Everything else here is a PRESENTATION
 * of it:
 *
 *   - `canTransition(from, to)`   the raw table
 *   - `assertTransition(from, to)` the table PLUS the human-facing refusals: a clear
 *     message when the order is already there, and a 409 rather than a 400 when the
 *     order is terminal
 *   - `moveTo(order, to, patch)`  asserts, writes, saves
 *
 * ## Why `PREPARING` and `PICKED_UP` have no `CANCELLED`
 *
 * §8.2's two deliberate absences. The meat is cut in the first case and on the road in
 * the second, so a "cancel" there is a refund with a bin behind it, not a cancellation.
 * This is BR-18 and it is the rule most likely to be argued with; §3.3's refund-only
 * discipline is what makes it defensible, because the customer has already paid the
 * amount that will be refunded. Do not add the edge back to be helpful.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/**
 * Read the table from the model rather than keeping a copy.
 *
 * `JhatkaOrder` is resolved lazily so this module can be required before the models
 * registry has finished loading — which is the case for the routers, which the vertical
 * verifier requires in isolation.
 */
const table = () => {
  const model = require('../models/jhatka.order.model');
  return model.schema.statics.ORDER_TRANSITIONS;
};

const lifecycleStates = () => {
  const model = require('../models/jhatka.order.model');
  return model.schema.statics.LIFECYCLE_STATES;
};

/**
 * Terminal states: no edge leaves them.
 *
 * Read from the table rather than listed, so a new terminal state cannot be added to
 * §8.2 without this noticing. A state with an EMPTY outgoing list is terminal by
 * definition.
 */
const terminalStates = () =>
  Object.entries(table())
    .filter(([, targets]) => Array.isArray(targets) && targets.length === 0)
    .map(([from]) => from);

/**
 * May this order move `from` -> `to`? Pure, so a caller can pre-check without writing.
 *
 * @param {string} from current lifecycle
 * @param {string} to   target lifecycle
 * @returns {boolean}
 */
const canTransition = (from, to) => {
  const allowed = table()[from];
  if (!allowed) return false;
  return allowed.includes(to);
};

/**
 * Assert a transition, throwing a refusal a human can act on.
 *
 * The message is the product here. `assertTransition` is called by the outlet's own
 * staff, on a tablet, mid-service, so "cannot move backwards from PAID to CREATED" is
 * worth more than a 400 with no detail.
 *
 * @throws {ApiError} 400 when already there / unknown state, 409 when terminal or illegal
 * @returns {true}
 */
const assertTransition = (from, to) => {
  if (from === to) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Order is already ${to}`);
  }

  if (terminalStates().includes(from)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Order is ${from} and can no longer change state`,
      true,
      '',
      { lifecycle: from }
    );
  }

  if (!canTransition(from, to)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Cannot move an order from ${from} to ${to}`,
      true,
      '',
      { from, to, allowed: table()[from] || [] }
    );
  }

  return true;
};

/**
 * Assert a transition and apply it.
 *
 * `patch` is applied alongside the transition because most of them move money or a
 * timestamp with the state: `PAID` moves `paidAt` and `paidAmount`, `WEIGHT_CONFIRMED`
 * moves `weightConfirmedAt`. Splitting those into two writes is how they end up
 * disagreeing — an order in `PAID` with no `paidAt` reads as unpaid on the dashboard and
 * as paid in the settlement.
 *
 * @param {object} order a HYDRATED `JhatkaOrder` document
 * @param {string} to    target lifecycle
 * @param {object} [patch] extra fields written with the transition
 * @returns {Promise<object>} the saved order
 */
const moveTo = async (order, to, patch = {}) => {
  assertTransition(order.lifecycle, to);
  order.lifecycle = to;
  Object.assign(order, patch);
  await order.save();
  return order;
};

/**
 * Move an order if the move is legal, and say whether it happened.
 *
 * For idempotent paths — a gateway callback, a replayed cron — where "already done"
 * is a success and throwing would turn a retry into an error. `throwOnIllegal: true`
 * restores the strict behaviour for request handlers.
 *
 * @returns {Promise<{moved: boolean, from: string, to: string}>}
 */
const tryMoveTo = async (order, to, patch = {}, { throwOnIllegal = false } = {}) => {
  const from = order.lifecycle;
  if (from === to) return { moved: false, from, to };

  if (!canTransition(from, to)) {
    if (throwOnIllegal) assertTransition(from, to);
    return { moved: false, from, to };
  }

  order.lifecycle = to;
  Object.assign(order, patch);
  await order.save();
  return { moved: true, from, to };
};

module.exports = {
  table,
  lifecycleStates,
  terminalStates,
  canTransition,
  assertTransition,
  moveTo,
  tryMoveTo,
};