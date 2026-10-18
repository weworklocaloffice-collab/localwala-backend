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
 * jhatka.rider.service.js — the rider's delivery lifecycle, minus Express.
 *
 * ## Why this was extracted
 *
 * `jhatka.driver.route.js` owned every rider transition inline: accept, pickup,
 * out-for-delivery, arrived, fail, POD capture, COD collect, earnings. The deliver
 * and collect-cod paths had already been extracted to `jhatka.delivery.service.js`
 * (the money-critical ones), which left the rest — including the ORDER-side moves
 * (`PICKED_UP`, `OUT_FOR_DELIVERY`) that took three audits to get right — testable
 * only over HTTP against a live database.
 *
 * ## What stays in the route
 *
 * Auth (`riderAuth`), capability (`cap`), validation, `loadOwnDelivery` (tenancy),
 * and the response shape. Everything that decides or persists lives here.
 *
 * ## The two-write rule
 *
 * Every transition that moves the DELIVERY also moves the ORDER, best-effort with a
 * log — never a throw. The delivery is the physical fact (the bag is on the bike);
 * the order is the view of it. Undoing a real-world event because a second document
 * write failed would be worse than recording the fact and logging the view lag.
 * `deliver` itself is the exception: it already lives in `jhatka.delivery.service`
 * and is not re-implemented here.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const lifecycleService = require('./jhatka.order-lifecycle.service');
const { assertStatus } = require('../middlewares/jhatka.delivery');

/** Rider-visible in-hand states. Mirrors the route's `active=true` filter exactly. */
const ACTIVE_DELIVERY_STATUSES = ['assigned', 'accepted', 'picked_up', 'out_for_delivery', 'arrived'];

/** Hard cap so a rider cannot page a year of deliveries. */
const MAX_PAGE_LIMIT = 100;

/**
 * The rider's queue.
 *
 * @returns {Promise<{deliveries: Array, page: number, limit: number}>}
 */
async function listDeliveries({ models, driverUserId, query = {} } = {}) {
  const { JhatkaDelivery } = models;
  const { active, page = 1, limit = 20 } = query;

  const filter = { driver: driverUserId };
  if (active === 'true') {
    filter.status = { $in: ACTIVE_DELIVERY_STATUSES };
  }

  const deliveries = await JhatkaDelivery.find(filter)
    .populate('order', 'orderNo lifecycle estimatedTotal finalTotal codAmount addressSnapshot')
    .populate('outlet', 'name address contact')
    .sort({ assignedAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), MAX_PAGE_LIMIT))
    .lean();

  return {
    deliveries: deliveries.map(toListView),
    page: Number(page),
    limit: Number(limit),
  };
}

/**
 * The list projection. One function so the queue and any future search share it —
 * two projections of the same row is how a rider sees a COD amount on one screen
 * that disagrees with another.
 */
function toListView(d) {
  return {
    id: String(d._id),
    deliveryNo: d.deliveryNo,
    status: d.status,
    codStatus: d.codStatus,
    // FROZEN at weight confirmation. Shown to the rider so there is no
    // argument at the door about how much to collect.
    codCollectionAmount: d.codCollectionAmount,
    assignedAt: d.assignedAt,
    order: d.order
      ? {
          id: String(d.order._id),
          orderNo: d.order.orderNo,
          lifecycle: d.order.lifecycle,
          finalTotal: d.order.finalTotal,
        }
      : null,
    outlet: d.outlet ? { id: String(d.outlet._id), name: d.outlet.name } : null,
    addressSnapshot: d.addressSnapshot,
    receiverName: d.receiverName,
    receiverContact: d.receiverContact,
    coldChain: d.coldChain,
  };
}

/**
 * Full detail: delivery, order lines, outlet, POD.
 */
async function deliveryDetail({ models, delivery } = {}) {
  const { JhatkaOrder, JhatkaOutlet, JhatkaDeliveryPOD } = models;

  const [order, outlet, pod] = await Promise.all([
    JhatkaOrder.findById(delivery.order)
      .select('orderNo lifecycle items estimatedTotal finalTotal codAmount addressSnapshot recipientNote promisedDeliveryAt')
      .lean(),
    JhatkaOutlet.findById(delivery.outlet)
      .select('name address contact')
      .lean(),
    JhatkaDeliveryPOD.findOne({ delivery: delivery._id }).lean(),
  ]);

  return {
    delivery: {
      id: String(delivery._id),
      deliveryNo: delivery.deliveryNo,
      status: delivery.status,
      codStatus: delivery.codStatus,
      codAmount: delivery.codAmount,
      codCollectionAmount: delivery.codCollectionAmount,
      codCollectedAmount: delivery.codCollectedAmount,
      addressSnapshot: delivery.addressSnapshot,
      receiverName: delivery.receiverName,
      receiverContact: delivery.receiverContact,
      coldChain: delivery.coldChain,
      attempts: delivery.attempts,
      maxAttempts: delivery.maxAttempts,
      assignedAt: delivery.assignedAt,
    },
    order: order
      ? {
          id: String(order._id),
          orderNo: order.orderNo,
          lifecycle: order.lifecycle,
          items: (order.items || []).map((i) => ({
            sku: i.sku,
            name: i.name,
            unitLabel: i.unitLabel,
            requestedQuantity: i.requestedQuantity,
            actualQuantity: i.actualQuantity,
            packingNote: i.packingNote,
            specialHandling: i.fulfilment,
          })),
        }
      : null,
    outlet: outlet ? { id: String(outlet._id), name: outlet.name } : null,
    pod: pod
      ? {
          id: String(pod._id),
          clientRef: pod.clientRef,
          deliveredTempC: pod.deliveredTempC,
          coldChainBreached: pod.coldChainBreached,
          codCollected: pod.codCollected,
          capturedAt: pod.capturedAt,
        }
      : null,
  };
}

/**
 * Accept an assigned delivery. Marks the rider unavailable — one bag at a time is
 * the operating model, and an "available" rider with an open delivery gets
 * double-dispatched.
 */
async function acceptDelivery({ models, delivery, driverUserId } = {}) {
  const { JhatkaDriver } = models;

  assertStatus(delivery, ['assigned']);

  delivery.status = 'accepted';
  await delivery.save();

  await JhatkaDriver.findOneAndUpdate({ user: driverUserId }, { available: false });

  return { delivery: { id: String(delivery._id), status: delivery.status } };
}

/**
 * Pick up: records the cold-chain reading at handover and moves the ORDER.
 *
 * The transit temperature question can only be answered if the reading at the
 * moment of pickup was kept — `pickedUpTempC` is the baseline every later breach
 * calculation compares against.
 */
async function pickupDelivery({ models, delivery, body = {} } = {}) {
  const { JhatkaOrder } = models;
  assertStatus(delivery, ['accepted']);

  const { pickedUpTempC } = body;

  delivery.status = 'picked_up';
  if (delivery.coldChain) {
    delivery.coldChain.pickedUpTempC = pickedUpTempC === undefined ? undefined : Number(pickedUpTempC);
    delivery.coldChain.pickedUpAt = new Date();
  }
  await delivery.save();

  await moveOrderBestEffort({
    models: { JhatkaOrder },
    delivery,
    to: 'PICKED_UP',
    patch: { pickedUpAt: delivery.coldChain?.pickedUpAt || new Date() },
  });

  return {
    delivery: {
      id: String(delivery._id),
      status: delivery.status,
      pickedUpAt: delivery.coldChain?.pickedUpAt,
      pickedUpTempC: delivery.coldChain?.pickedUpTempC,
    },
  };
}

/**
 * Out for delivery: stamps transit time and moves the ORDER.
 *
 * `maxTransitMinutes` defaults here rather than in the model so an old delivery row
 * written before the field existed still gets a sane band instead of comparing
 * against undefined.
 */
async function markOutForDelivery({ models, delivery, now = new Date() } = {}) {
  const { JhatkaOrder } = models;
  assertStatus(delivery, ['picked_up']);

  delivery.status = 'out_for_delivery';
  if (delivery.coldChain) {
    const since = delivery.coldChain.pickedUpAt || delivery.assignedAt || now;
    delivery.coldChain.transitMinutes = Math.round((now - new Date(since)) / 60000);
    delivery.coldChain.maxTransitMinutes = delivery.coldChain.maxTransitMinutes ?? 120;
    delivery.coldChain.deliveredAt = undefined;
  }
  await delivery.save();

  await moveOrderBestEffort({ models: { JhatkaOrder }, delivery, to: 'OUT_FOR_DELIVERY' });

  return {
    delivery: {
      id: String(delivery._id),
      status: delivery.status,
      transitMinutes: delivery.coldChain?.transitMinutes,
      maxTransitMinutes: delivery.coldChain?.maxTransitMinutes,
      // Advisory only: the dispatch guard already blocked a late dispatch. This
      // warns the rider rather than refusing, because a rider mid-transit cannot
      // un-deliver.
      exceedsTransit:
        (delivery.coldChain?.transitMinutes || 0) > (delivery.coldChain?.maxTransitMinutes || 120),
    },
  };
}

/**
 * Arrived: records where the rider is standing. Status does NOT advance —
 * 'arrived' is not in the enum, and the nearest legal state is out_for_delivery,
 * which is what "I am standing outside" means until the POD is captured.
 */
async function markArrived({ delivery, body = {} } = {}) {
  assertStatus(delivery, ['out_for_delivery']);

  const { location } = body;
  if (location && Array.isArray(location.coordinates)) {
    delivery.location = { type: 'Point', coordinates: location.coordinates };
  }
  await delivery.save();

  return {
    delivery: { id: String(delivery._id), status: delivery.status },
    note: 'arrival is evidenced by the POD; status stays out_for_delivery until delivery',
  };
}

/**
 * Standalone POD capture. Evidence only — does NOT mark the delivery delivered.
 * That is `/deliver`, and conflating the two lets a rider close a COD order by
 * photographing it.
 *
 * Idempotent on `{delivery, clientRef}`: a retry returns the original, because two
 * proofs of one delivery means a reconciliation that never balances.
 */
async function capturePod({ models, delivery, body = {}, actor } = {}) {
  const { JhatkaDeliveryPOD } = models;
  const { clientRef } = body;
  if (!clientRef) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'clientRef is required (idempotency key)');
  }

  const existing = await JhatkaDeliveryPOD.findOne({ delivery: delivery._id, clientRef });
  if (existing) {
    return {
      pod: {
        id: String(existing._id),
        clientRef: existing.clientRef,
        capturedAt: existing.capturedAt,
      },
      idempotentReplay: true,
    };
  }

  const pod = new JhatkaDeliveryPOD({
    delivery: delivery._id,
    order: delivery.order,
    clientRef,
    photo: body.photo,
    signature: body.signature,
    deliveredTempC:
      body.deliveredTempC === undefined ? undefined : Number(body.deliveredTempC),
    receiverName: body.receiverName,
    note: body.note,
    capturedBy: actor._id,
    capturedByName: actor.name,
    capturedAt: new Date(),
  });

  const podError = pod.validateSync();
  if (podError) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'POD failed validation', true, '', {
      fields: Object.keys(podError.errors),
    });
  }
  await pod.save();

  delivery.proofOfDelivery = pod._id;
  await delivery.save();

  return {
    pod: { id: String(pod._id), clientRef: pod.clientRef, capturedAt: pod.capturedAt },
    deliveryStatusUnchanged: delivery.status,
  };
}

/**
 * Fail a delivery. A first-class outcome, not an error to swallow.
 *
 * REQUIRES a reason — it is what the outlet reads — and sets COD to `failed`
 * rather than leaving it pending, because the money question has to reach somebody.
 * A failure with money unaccounted for is a reconciliation that never closes.
 */
async function failDelivery({ models, delivery, body = {}, actor } = {}) {
  const { JhatkaDriver } = models;

  assertStatus(delivery, ['assigned', 'accepted', 'picked_up', 'out_for_delivery']);

  const { reason, note, codCollected } = body;
  if (!reason) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'reason is required to fail a delivery — it is what the outlet reads'
    );
  }

  delivery.status = 'failed';
  delivery.failedAt = new Date();
  delivery.failureReason = reason;
  delivery.failureNote = note;
  delivery.attempts = (delivery.attempts || 0) + 1;

  if (delivery.codStatus === 'pending') {
    const collected = Number(codCollected || 0);
    delivery.codStatus = collected > 0 ? 'collected' : 'failed';
    delivery.codCollectedAmount = collected;
    if (collected > 0) {
      delivery.codCollectedAt = new Date();
      delivery.codCollectedBy = actor._id;
    }
  }
  await delivery.save();

  await JhatkaDriver.findOneAndUpdate({ user: actor._id }, { available: true });

  return {
    delivery: {
      id: String(delivery._id),
      status: delivery.status,
      failureReason: delivery.failureReason,
      codStatus: delivery.codStatus,
      codCollectedAmount: delivery.codCollectedAmount,
    },
  };
}

/**
 * The rider's own settlements. Read-only: payout state lives on
 * `JhatkaDeliverySettlement` and only an owner or manager may mark one paid, so a
 * rider can see their own period but cannot move it.
 */
async function riderEarnings({ models, driverUserId, query = {} } = {}) {
  const { JhatkaDriver, JhatkaDeliverySettlement } = models;
  const { from, to, page = 1, limit = 50 } = query;

  const driver = await JhatkaDriver.findOne({ user: driverUserId }).select('_id outlet').lean();
  if (!driver) throw new ApiError(httpStatus.NOT_FOUND, 'Driver record not found');

  const filter = { driver: driver._id };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const settlements = await JhatkaDeliverySettlement.find(filter)
    .sort({ createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), MAX_PAGE_LIMIT))
    .lean();

  return {
    settlements: settlements.map((s) => ({
      id: String(s._id),
      settlementNo: s.settlementNo,
      period: s.period,
      totals: s.totals,
      status: s.status,
      paidAt: s.paidAt,
      paymentReference: s.paymentReference,
    })),
    // Stated, not inferred: Jhatka riders are outlet-owned (§13.2, OD-06), so the
    // outlet pays them directly and there is no platform pool to reconcile against.
    payoutMode: 'business_pays',
    note: 'Jhatka riders are outlet-owned; the outlet pays them directly.',
  };
}

/**
 * Move the ORDER to match a delivery transition that already happened.
 *
 * Best-effort with a log, never a throw — see the module header. Exported so the
 * failure paths (fail, deliver) and any future transition share the one rule.
 */
async function moveOrderBestEffort({ models, delivery, to, patch = {} } = {}) {
  const { JhatkaOrder } = models;
  try {
    const order = await JhatkaOrder.findById(delivery.order);
    if (order) {
      await lifecycleService.tryMoveTo(order, to, patch);
    }
  } catch (error) {
    console.error(
      `[jhatka.rider] ${delivery._id} moved but could not move order ${delivery.order} to ${to}: ${error.message}`
    );
  }
}

module.exports = {
  listDeliveries,
  toListView,
  deliveryDetail,
  acceptDelivery,
  pickupDelivery,
  markOutForDelivery,
  markArrived,
  capturePod,
  failDelivery,
  riderEarnings,
  moveOrderBestEffort,
  ACTIVE_DELIVERY_STATUSES,
  MAX_PAGE_LIMIT,
};