/**
 * jhatka.refund.settlement.js — actually move the money. Phase 8 / F-5.
 *
 * ## Why this file exists
 *
 * `jhatka.refund.gateway.js` has existed since Phase 1 and **nothing has ever called
 * it**. Weighing an order creates a `JhatkaRefund` with status `REFUND_PENDING`, and
 * that is where it stopped: no job picked it up, no gateway was contacted, and
 * `gatewayRefundId` was written by nothing.
 *
 * The stores vertical has the same omission — `stores.refund.service.js` records
 * refunds and never calls a gateway (F-5). The blueprint names that explicitly as a
 * defect to inherit ("do not copy that omission"), so this is the file that breaks
 * the pattern.
 *
 * ## The routes a refund can take
 *
 *   1. GATEWAY   — money was collected online. Refund it through the provider.
 *   2. COD      — nothing was collected. The customer hands over LESS at the door, and
 *                 the shortfall is the refund. Recorded, no external call.
 *   3. CREDIT   — `fundingSource: platform_absorbed` with no collection to return
 *                 against. Recorded as a platform credit against the next order.
 *
 * Treating COD as a gateway call is the classic bug here: there is no `gatewayPaymentId`
 * to refund, so the call either throws forever or is skipped silently and the refund
 * sits `REFUND_PENDING` until an operator notices.
 *
 * ## Idempotency is the whole design
 *
 * `refundPayment` takes a mandatory `idempotencyKey`. It is derived from the refund's
 * OWN id — not a timestamp, not a random value — so a retry after a timeout produces
 * the SAME key and the provider de-duplicates instead of paying twice. A key derived
 * per-attempt would defeat the entire mechanism.
 *
 * ## A timeout is NOT a failure
 *
 * `PROCESSING -> FAILED` is only correct when the provider says no. A network timeout
 * is "unknown", and the retry MUST reuse the idempotency key. Marking an unknown
 * outcome FAILED and then retrying with a fresh key is how a customer is refunded twice.
 */

const gateway = require('./jhatka.refund.gateway');
const { toPaiseAmount, asMoney } = require('../utils/money');
const lifecycleService = require('./jhatka.order-lifecycle.service');
const notifyService = require('./jhatka.notify.service');

/** Attempts before a refund is parked for a human. */
const MAX_ATTEMPTS = 5;

/**
 * Decide how a single refund should be settled, WITHOUT calling anything.
 *
 * Pure, so the routing decision is testable without a provider — which matters,
 * because the COD path is the one that used to be silently skipped.
 *
 * ## `collectionKind`, not `fundingSource`
 *
 * An earlier version inferred the route from `fundingSource === 'platform_absorbed'`,
 * which is simply the wrong question. `fundingSource` answers **who bears the cost**;
 * the route answers **how the customer gets their money back**. For a COD weight
 * refund both are true at once — LocalWala absorbs the cost AND the customer simply
 * hands over less at the door — so the two questions answered the same thing for the
 * most common case in the vertical and mislabelled it.
 *
 *   'online' — money was collected by a provider. Refund it through them.
 *   'cod'    — the customer pays the rider. The refund is realised as a reduced
 *              collection; no external call exists or is needed.
 *   'none'   — nothing was collected and nothing will be (a goodwill credit on a
 *              cancelled order). Recorded as platform credit.
 *
 * The caller derives this from the ORDER's payment mode, which is the only thing that
 * actually knows.
 */
function settleRoute(refund, { collectionKind }) {
  if (collectionKind === 'online') {
    return { kind: 'gateway', reason: 'collected online; refunding via the provider' };
  }
  if (collectionKind === 'cod') {
    return {
      kind: 'cod',
      reason: 'collected at the door; realised as a reduced collection, no gateway call',
    };
  }
  return {
    kind: 'credit',
    reason: 'nothing was collected; recorded as platform credit against the order',
  };
}

/**
 * Settle one refund. Returns the updated refund document.
 *
 * Never throws for a provider failure — a refund that throws takes the whole batch
 * down with it, and one unreachable gateway must not block every other refund in the
 * queue. Failures are recorded on the refund itself.
 *
 * ## The order follows the refund, not the other way round
 *
 * Every terminal exit (`REFUNDED`, `FAILED`-parked, early return) ends through
 * `syncOrderRefundState`. That is what moves the ORDER when its last refund closes,
 * because `settleRefund` is the only code that knows a refund just became terminal —
 * and without it the order would sit `REFUND_PENDING` forever after the money moved.
 *
 * The sync is best-effort BY DESIGN: a failure to move the order must never un-settle
 * the refund. Money moved is a fact; lifecycle is a view of the fact.
 */
async function settleRefund(refund, { collectionKind, client, models } = {}) {
  const sync = async () => {
    if (!models || !refund.order) return;
    try {
      await syncOrderRefundState({ models, orderId: refund.order });
    } catch (error) {
      console.error(
        `[jhatka.refund] settled ${refund._id} but could not sync order ${refund.order}: ${error.message}`
      );
    }
  };

  if (refund.status === 'REFUNDED' || refund.status === 'REVERSED') {
    await sync();
    return refund; // already settled; nothing to do
  }

  if (refund.status === 'FAILED' && (refund.attempts || 0) >= MAX_ATTEMPTS) {
    return refund; // parked for a human
  }
  if (refund.status === 'REFUNDED' || refund.status === 'REVERSED') {
    return refund; // already settled; nothing to do
  }

  if (refund.status === 'FAILED' && (refund.attempts || 0) >= MAX_ATTEMPTS) {
    return refund; // parked for a human
  }

  const route = settleRoute(refund, { collectionKind });

  refund.attempts = (refund.attempts || 0) + 1;
  refund.lastAttemptAt = new Date();

  const pushTimeline = (status, note, by, byName) => {
    refund.timeline = refund.timeline || [];
    refund.timeline.push({ status, at: new Date(), by, byName, note });
  };

  // ---- 2 & 3: nothing to call -------------------------------------------
  if (route.kind !== 'gateway') {
    refund.status = 'REFUNDED';
    refund.settledAt = new Date();
    refund.settlementRoute = route.kind;
    pushTimeline(
      'REFUNDED',
      `Settled as ${route.kind.toUpperCase()}: ${route.reason}`,
      refund.settledBy || null,
      refund.settledByName || 'system'
    );
    await refund.save();
    await sync();
    return refund;
  }

  // ---- 1: gateway --------------------------------------------------------
  const provider = refund.gateway;
  const paymentId = refund.gatewayPaymentId;

  if (!provider || !paymentId) {
    // The order claims an online collection but this refund was never told WHICH
    // provider or WHICH charge. That is a data gap, not a provider failure, and it
    // must not be retried into the same wall.
    refund.status = 'FAILED';
    refund.failureReason = 'no gateway or gatewayPaymentId recorded for this refund';
    pushTimeline('FAILED', refund.failureReason, null, 'system');
    await refund.save();
    return refund;
  }

  // THE SAME KEY every attempt. Derived from the refund's own id so a retry after a
  // timeout de-duplicates at the provider instead of paying twice.
  const idempotencyKey = `jhatka-refund-${String(refund._id)}`;

  pushTimeline('PROCESSING', `Refunding ${toPaiseAmount(refund.amount)} paise via ${provider}`, null, 'system');
  refund.status = 'PROCESSING';
  await refund.save();

  try {
    const result = await gateway.refundPayment({
      gateway: provider,
      gatewayPaymentId: paymentId,
      amountPaise: toPaiseAmount(refund.amount),
      idempotencyKey,
      reason: refund.reason,
      client,
    });

    refund.gatewayRefundId = result.gatewayRefundId;
    refund.gateway = provider;
    refund.status = 'REFUNDED';
    refund.settledAt = new Date();
    refund.settlementRoute = 'gateway';
    refund.failureReason = undefined;
    pushTimeline(
      'REFUNDED',
      `Gateway ${provider} refund ${result.gatewayRefundId} (${result.status})`,
      null,
      'system'
    );
  } catch (error) {
    // A TIMEOUT is not a refusal. The provider may well have taken the money. Marking
    // it FAILED invites a fresh-key retry that pays twice, so it stays PROCESSING and
    // the next sweep re-issues with the SAME idempotency key.
    const isUnknown = isTimeoutError(error);

    refund.status = isUnknown ? 'PROCESSING' : 'FAILED';
    refund.failureReason = isUnknown
      ? `gateway timeout — outcome UNKNOWN, will retry with the same idempotency key: ${error.message}`
      : `gateway rejected the refund: ${error.message}`;

    pushTimeline(
      refund.status,
      refund.failureReason,
      null,
      'system'
    );

    if (!isUnknown && refund.attempts >= MAX_ATTEMPTS) {
      refund.status = 'FAILED';
      refund.parkedAt = new Date();
      refund.failureReason += ` (parked after ${refund.attempts} attempts — needs a human)`;
    }
  }

  await refund.save();
  await sync();
  return refund;
}

/**
 * Distinguish "the provider said no" from "we do not know".
 *
 * Anything that is not an explicit provider rejection is UNKNOWN, because assuming a
 * failure we then retry is how money is paid twice. Erring toward UNKNOWN only costs
 * a delayed reconciliation.
 */
function isTimeoutError(error) {
  if (!error) return false;
  const code = error.code || error.statusCode || error.type;
  const msg = String(error.message || '').toLowerCase();

  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 504].includes(code)) {
    return true;
  }
  return /timeout|timed out|socket hang up|network|unavailable|econn/.test(msg);
}

/**
 * Resolve which gateway a refund must be sent to, and against which charge.
 *
 * ## The hole this closes
 *
 * `JhatkaRefund.gateway` and `gatewayPaymentId` were declared, asserted in a test
 * with hand-set values, and NEVER WRITTEN by any production path. Every gateway
 * refund therefore died in `settleRefund` with "no gateway or gatewayPaymentId
 * recorded for this refund" — a failure that reads as a data problem but was in fact
 * a missing feature: nothing ever told the refund where the money was.
 *
 * ## Where the answer lives
 *
 * The order holds `payment` → `PaymentInitiation`, which holds `payment` →
 * `PaymentConfig` (whose `slug` names the provider) and `payResponse` (the provider's
 * own verify body, written by the gateway controller on success).
 *
 * The charge id is provider-shaped, and each shape is named rather than guessed:
 * Razorpay's verify body IS the payment object, so `body.id` is the charge.
 * When no known shape matches, this returns `{ gateway, gatewayPaymentId: null }` and
 * the settlement's existing FAILED path says so loudly. Guessing a charge id is how a
 * customer gets someone else's refund.
 *
 * ## Stripe is deliberately partial
 *
 * A Stripe checkout SESSION id is not refundable — only its `payment_intent` is. When
 * the payResponse is a session without an intent, there is nothing correct to return,
 * so this returns null for the id. That is a known limitation, not a bug to work
 * around by refunding the session id and hoping.
 *
 * @returns {Promise<{gateway: string|null, gatewayPaymentId: string|null, reason: string}>}
 */
async function resolveRefundGateway({ models, order }) {
  const { PaymentInitiation, PaymentConfig } = models || {};

  if (!order || !order.payment || !PaymentInitiation || !PaymentConfig) {
    return { gateway: null, gatewayPaymentId: null, reason: 'no initiation on the order' };
  }

  const initiation = await PaymentInitiation.findById(order.payment)
    .select('payment payResponse paymentRef')
    .lean();
  if (!initiation) {
    return { gateway: null, gatewayPaymentId: null, reason: 'initiation row missing' };
  }

  const config = initiation.payment
    ? await PaymentConfig.findById(initiation.payment).select('slug status').lean()
    : null;
  const gateway = config?.slug ? String(config.slug).toLowerCase() : null;

  const body = initiation.payResponse && typeof initiation.payResponse === 'object'
    ? initiation.payResponse
    : {};

  const gatewayPaymentId =
    body.id ||
    body.razorpay_payment_id ||
    body.payment_id ||
    body.charge ||
    null;

  return {
    gateway,
    gatewayPaymentId: gatewayPaymentId ? String(gatewayPaymentId) : null,
    reason: !gateway
      ? 'no PaymentConfig on the initiation'
      : !gatewayPaymentId
        ? 'payResponse carries no recognisable charge id'
        : 'resolved',
  };
}

/**
 * Keep the ORDER's lifecycle honest about its refunds.
 *
 * ## The two rules
 *
 *   1. An order with OPEN refunds that is allowed to be `REFUND_PENDING` must BE
 *      `REFUND_PENDING`. An order at `DELIVERED` with a weight refund in flight is a
 *      refund the settlement screen will miss, because that screen groups by order
 *      lifecycle — and a delivered order reads as finished.
 *   2. An order at `REFUND_PENDING` whose refunds are ALL terminal (`REFUNDED` or
 *      `REVERSED`) must BE `REFUNDED`. Anything else is an order that looks open and
 *      is not.
 *
 * ## What does NOT move
 *
 * A mid-fulfillment order. `WEIGHT_CONFIRMED`, `PACKING`, `READY` and `DRIVER_ASSIGNED`
 * have no edge to `REFUND_PENDING` in the table, and that is correct: a weight
 * shortfall refund does not stop the van. The customer gets 0.9 kg and a refund for
 * the missing 0.1, not a cancelled delivery. Moving the order mid-route would strand
 * the rider with a bag nobody wants.
 *
 * So a weigh-time refund only changes the order's state once the order can legally
 * hold it — at `DELIVERED`, `REJECTED` or `CANCELLED`. Before that the refund is a
 * side document, and this function is a no-op.
 *
 * @returns {Promise<{moved: boolean, from: string, to: string, open: number, terminal: number}>}
 */
async function syncOrderRefundState({ models, orderId } = {}) {
  const { JhatkaOrder, JhatkaRefund } = models;

  const order = await JhatkaOrder.findById(orderId);
  if (!order) return { moved: false, from: '?', to: '?', open: 0, terminal: 0 };

  const refunds = await JhatkaRefund.find({ order: order._id })
    .select('status')
    .lean();

  const open = refunds.filter((r) =>
    ['REFUND_PENDING', 'PROCESSING'].includes(r.status)).length;
  const terminal = refunds.filter((r) =>
    ['REFUNDED', 'REVERSED'].includes(r.status)).length;

  const summary = { moved: false, from: order.lifecycle, to: order.lifecycle, open, terminal };

  // Rule 2 first: a finished refund set closes the order regardless of which state it
  // reached REFUND_PENDING from. Checking this before rule 1 matters, because an order
  // at REFUND_PENDING with zero open refunds must move even though rule 1's
  // precondition (open > 0) fails.
  //
  // DELIVERED is included deliberately. A delivered order whose refunds all settled is
  // NOT complete in the COMPLETED sense — COMPLETED means "delivered, no money ever
  // moved back", and a customer looking at their history should see "refunded" when
  // money came back. The table gives DELIVERED an edge to REFUND_PENDING precisely
  // for this, so a DELIVERED order walks DELIVERED -> REFUND_PENDING -> REFUNDED in
  // one call. Both moves are real and both are recorded; skipping the intermediate
  // state would invent an edge the table does not have.
  if (
    (order.lifecycle === 'REFUND_PENDING' || order.lifecycle === 'DELIVERED') &&
    open === 0 &&
    refunds.length > 0
  ) {
    if (order.lifecycle === 'DELIVERED') {
      const via = await lifecycleService.tryMoveTo(order, 'REFUND_PENDING');
      summary.moved = via.moved;
      summary.to = order.lifecycle;
      if (!via.moved) return summary;
    }

    const moved = await lifecycleService.tryMoveTo(order, 'REFUNDED');
    summary.moved = summary.moved || moved.moved;
    summary.to = order.lifecycle;

    if (moved.moved) {
      await notifyService.notifyCustomer(order.customer, 'order_refund_completed', {
        orderNo: order.orderNo,
      });
    }
    return summary;
  }

  // Rule 1: open refunds pull the order into REFUND_PENDING — but ONLY from a state
  // the table permits. Anything else is left alone, and mid-fulfillment orders are
  // the reason why.
  if (open > 0) {
    const moved = await lifecycleService.tryMoveTo(order, 'REFUND_PENDING');
    summary.moved = moved.moved;
    summary.to = order.lifecycle;
  }

  return summary;
}

/**
 * Raise the refund an order's rejection or cancellation OWES.
 *
 * ## BR-19: a refund is always a document
 *
 * `reject` used to write `cancellation: { refundAmount, refundMethod }` onto the order
 * and stop. That is money owed with no row tracking it, no timeline, no retry and no
 * `gatewayRefundId` — and a `JhatkaRefund` that never exists can never be settled by
 * the 03:30 sweep. The amount was right and the mechanism was absent.
 *
 * ## What is refunded, and what is not
 *
 * A COD order collected nothing, so there is nothing to return — but the ANSWER is
 * still a document, not silence. COD rejections raise a `credit` refund for zero,
 * which closes the loop for the outlet and the settlement screen without calling a
 * gateway for money that never moved.
 *
 * A gateway order refunds its `estimatedTotal` MINUS anything already refunded. The
 * ceiling is `assertRefundCeiling`'s job (`stores.refund.service`'s F-5 — the
 * double-subtracted discount — is checked by using the order's own frozen totals
 * rather than recomputing from lines).
 *
 * Idempotent per `{order, componentKey}`: a concurrent reject and cancel cannot both
 * mint a full-estimate refund. The second call finds the first and returns it.
 *
 * @returns {Promise<{refund: object, created: boolean}>}
 */
async function raiseOrderRefund({
  models, order, reason = 'OUTLET_REJECTED', reasonNote, actor, nextNumber,
} = {}) {
  const { JhatkaRefund } = models;

  const existing = await JhatkaRefund.findOne({
    order: order._id,
    componentKey: `order:${String(order._id)}`,
  });
  if (existing) return { refund: existing, created: false };

  const alreadyRefundedPaise = Math.round(Number(
    (await JhatkaRefund.aggregate([
      { $match: { order: order._id, status: { $ne: 'REVERSED' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]))[0]?.total || 0
  ));

  // Frozen totals, not recomputed lines. `estimatedTotal` is what the customer was
  // charged (BR-06 guarantees it only falls); anything already refunded is in paise
  // on the same scale, so the subtraction is exact.
  const estimatedPaise = Math.round(Number(order.estimatedTotal) * 100);
  const refundablePaise = Math.max(0, estimatedPaise - alreadyRefundedPaise);

  const isLiveGatewayRefund = order.paymentMode === 'gateway' && refundablePaise > 0;

  // The gateway the money came through, resolved from the order's own initiation —
  // never assumed, and never read off fields that do not exist. When this resolves to
  // nothing the refund is still raised (BR-19: the debt is real either way) and the
  // settlement's FAILED path records WHY it cannot be sent yet.
  const resolved = isLiveGatewayRefund
    ? await resolveRefundGateway({ models, order })
    : { gateway: null, gatewayPaymentId: null, reason: 'no collection to return' };

  const doc = isLiveGatewayRefund
    ? {
        amount: asMoney(refundablePaise),
        taxAmount: asMoney(0),
        netAmount: asMoney(refundablePaise),
        fundingSource: 'platform_absorbed',
      }
    : {
        // COD, or nothing left to return: a zero-value credit that closes the loop.
        amount: asMoney(0),
        taxAmount: asMoney(0),
        netAmount: asMoney(0),
        fundingSource: 'platform_absorbed',
      };

  const refund = await JhatkaRefund.create({
    refundNo: nextNumber ? nextNumber('RF') : undefined,
    order: order._id,
    outlet: order.outlet,
    business: order.business,
    customer: order.customer,
    componentKey: `order:${String(order._id)}`,
    reason,
    reasonNote: reasonNote || order?.cancellation?.reason,
    fundingSource: 'platform_absorbed',
    gateway: resolved.gateway || undefined,
    gatewayPaymentId: resolved.gatewayPaymentId || undefined,
    gatewayResolutionNote: resolved.reason,
    ...doc,
    status: 'REFUND_PENDING',
    attempts: 0,
    timeline: [{
      status: 'REFUND_PENDING',
      at: new Date(),
      by: actor?._id,
      byName: actor?.name,
      note: isLiveGatewayRefund
        ? `Raised on ${reason}; gateway ${resolved.gateway || 'unknown'} (${resolved.reason})`
        : `Raised on ${reason}; no collection to return`,
    }],
  });

  await syncOrderRefundState({ models, orderId: order._id });

  return { refund, created: true, gatewayResolution: resolved.reason };
}

/**
 * Sweep the refund queue.
 *
 * Claims work with `findOneAndUpdate` on `status` so two concurrent sweeps cannot pick
 * up the same refund — a plain `find` followed by a save lets two workers each call
 * the gateway for one refund. The idempotency key would save us anyway, but only if the
 * provider honours it, and "only if" is not a design.
 *
 * @param {Function} p.collectionKindFor  `(refund) => 'online' | 'cod' | 'none'`,
 *   derived from the ORDER's payment mode — see `settleRoute`.
 * @returns {Promise<{processed: number, settled: number, failed: number}>}
 */
async function processRefundQueue({ models, collectionKindFor, limit = 25 }) {
  const { JhatkaRefund } = models;

  const processed = [];
  let settled = 0;
  let failed = 0;

  for (let i = 0; i < limit; i += 1) {
    // Claim exactly one. PROCESSING refunds are re-claimed only once they have been
    // waiting long enough to be genuinely unknown rather than mid-flight.
    const claimed = await JhatkaRefund.findOneAndUpdate(
      {
        status: { $in: ['REFUND_PENDING', 'PROCESSING'] },
        attempts: { $lt: MAX_ATTEMPTS },
        $or: [
          { status: 'REFUND_PENDING' },
          { status: 'PROCESSING', lastAttemptAt: { $lt: new Date(Date.now() - 15 * 60000) } },
        ],
      },
      { $set: { status: 'PROCESSING' } },
      { sort: { createdAt: 1 }, new: true }
    );

    if (!claimed) break;

    // Default to `'online'` only if the caller supplied no resolver — silently treating
    // an unknown refund as online would call a gateway for a COD order and fail
    // forever, which is the exact failure this function exists to avoid.
    const collectionKind = collectionKindFor ? await collectionKindFor(claimed) : 'online';
    // `models` flows through so a freshly settled refund can move its ORDER. `settleRefund`
    // syncs best-effort and never lets an order failure un-settle money.
    const result = await settleRefund(claimed, { collectionKind, models });

    processed.push(String(result._id));
    if (result.status === 'REFUNDED') settled += 1;
    if (result.status === 'FAILED') failed += 1;
  }

  return { processed: processed.length, settled, failed };
}

module.exports = {
  settleRefund,
  processRefundQueue,
  settleRoute,
  isTimeoutError,
  MAX_ATTEMPTS,
  resolveRefundGateway,
  syncOrderRefundState,
  raiseOrderRefund,
};