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
 * jhatka.order-fulfilment.service.js — the outlet's order pipeline, minus Express.
 *
 * ## Why this was extracted
 *
 * `jhatka.partner.orders.route.js` owned the whole fulfilment chain inline: receive,
 * accept, reject (+ refund), preparation tickets, stock allocation, packing with the
 * cold-chain gate, ready, and dispatch with the transit guard and delivery creation.
 * The weigh step had already been extracted (every defect the integration suite ever
 * found lived in that block), which left this file as the largest remaining
 * concentration of untestable-except-over-HTTP business rules.
 *
 * ## What is deliberately NOT here
 *
 * Weighing (`jhatka.weigh.service`), payment (`jhatka.payment.service`), refunds
 * (`jhatka.refund.settlement`), and the transition table itself
 * (`jhatka.order-lifecycle.service`). This module CALLS all four; re-declaring any of
 * them here is how the three-copies-of-one-rule problem comes back.
 *
 * ## The response shapes stay with the callers' contract
 *
 * Each function returns exactly what the route used to send, so the route is a
 * pass-through and the API contract is unchanged. Moving response shaping into the
 * service too would make the service depend on what the app screens happen to need
 * today; keeping it here next to the logic that produces the values is the middle
 * ground the other extractions already chose.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const lifecycleService = require('./jhatka.order-lifecycle.service');

/** Hard cap so a list cannot page the whole collection. */
const MAX_PAGE_LIMIT = 100;

/**
 * List an outlet's orders, newest first.
 */
async function listOrders({ models, outletId, query = {} } = {}) {
  const { JhatkaOrder } = models;
  const { lifecycle, from, to, page = 1, limit = 50 } = query;

  const filter = { outlet: outletId };
  if (lifecycle) {
    if (!lifecycleService.lifecycleStates().includes(lifecycle)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Unknown lifecycle '${lifecycle}'`);
    }
    filter.lifecycle = lifecycle;
  }
  if (from || to) {
    filter.placedAt = {};
    if (from) filter.placedAt.$gte = new Date(from);
    if (to) filter.placedAt.$lte = new Date(to);
  }

  const orders = await JhatkaOrder.find(filter)
    .sort({ placedAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), MAX_PAGE_LIMIT))
    .lean();

  return {
    orders: orders.map((o) => ({
      id: String(o._id),
      orderNo: o.orderNo,
      lifecycle: o.lifecycle,
      businessModel: o.businessModel,
      fulfilmentMode: o.fulfilmentMode,
      paymentMode: o.paymentMode,
      paymentStatus: o.paymentStatus,
      estimatedTotal: o.estimatedTotal,
      finalTotal: o.finalTotal,
      codAmount: o.codAmount,
      totalItems: o.totalItems,
      promisedWeightGrams: o.promisedWeightGrams,
      placedAt: o.placedAt,
      promisedDeliveryAt: o.promisedDeliveryAt,
    })),
    page: Number(page),
    limit: Number(limit),
  };
}

/**
 * Full order detail with preparation tickets and weight confirmations.
 */
async function orderDetail({ models, order } = {}) {
  const { JhatkaPreparationTicket, JhatkaWeightConfirmation } = models;

  const [tickets, confirmations] = await Promise.all([
    JhatkaPreparationTicket.find({ order: order._id, isCurrent: true }).lean(),
    JhatkaWeightConfirmation.find({ order: order._id })
      .sort({ weighedAt: -1 })
      .lean(),
  ]);

  return {
    order: {
      id: String(order._id),
      orderNo: order.orderNo,
      lifecycle: order.lifecycle,
      customer: order.customer
        ? { id: String(order.customer._id), name: order.customer.name, phone: order.customer.phone }
        : null,
      itemsSubtotal: order.itemsSubtotal,
      taxTotal: order.taxTotal,
      estimatedTotal: order.estimatedTotal,
      finalTotal: order.finalTotal,
      weightAdjustmentTotal: order.weightAdjustmentTotal,
      absorbedOverchargeTotal: order.absorbedOverchargeTotal,
      codAmount: order.codAmount,
      codCollectionAmount: order.codCollectionAmount,
      refundedAmount: order.refundedAmount,
      promisedWeightGrams: order.promisedWeightGrams,
      instructions: order.instructions,
      addressSnapshot: order.addressSnapshot,
      items: (order.items || []).map((i) => ({
        id: String(i._id),
        sku: i.sku,
        name: i.name,
        variantName: i.variantName,
        unitLabel: i.unitLabel,
        isVariableWeight: i.isVariableWeight,
        measurementMode: i.measurementMode,
        requestedQuantity: i.requestedQuantity,
        actualQuantity: i.actualQuantity,
        estimatedAmount: i.estimatedAmount,
        finalAmount: i.finalAmount,
        deltaAmount: i.deltaAmount,
        adjustmentDirection: i.adjustmentDirection,
        absorbedAmount: i.absorbedAmount,
        refundedAmount: i.refundedAmount,
        variancePct: i.variancePct,
        withinTolerance: i.withinTolerance,
        allocations: i.allocations || [],
      })),
      preparationTickets: tickets.map((t) => ({
        id: String(t._id),
        ticketNo: t.ticketNo,
        status: t.status,
        lines: t.lines,
        coldChain: t.coldChain,
      })),
      weightConfirmations: confirmations.map((c) => ({
        id: String(c._id),
        confirmationNo: c.confirmationNo,
        orderItem: String(c.orderItem),
        attempt: c.attempt,
        isCurrent: c.isCurrent,
        requestedQuantity: c.requestedQuantity,
        actualQuantity: c.actualQuantity,
        estimatedAmountPaise: c.estimatedAmountPaise,
        finalAmountPaise: c.finalAmountPaise,
        deltaPaise: c.deltaPaise,
        refundablePaise: c.refundablePaise,
        direction: c.direction,
        variancePct: c.variancePct,
        withinTolerance: c.withinTolerance,
        policy: c.policy,
        override: c.override?.at ? c.override : null,
        weighedByName: c.weighedByName,
        weighedAt: c.weighedAt,
      })),
    },
  };
}

/**
 * Receive: the outlet acknowledges the order is on its screen.
 *
 * Where an outlet's SLA clock starts. COD orders arrive from CREATED, gateway
 * orders from PAID — the table, not this function, decides which.
 */
async function receiveOrder({ order } = {}) {
  await lifecycleService.moveTo(order, 'OUTLET_RECEIVED');
  return { order: { id: String(order._id), lifecycle: order.lifecycle } };
}

/**
 * Accept: the outlet commits to fulfilling.
 */
async function acceptOrder({ order } = {}) {
  await lifecycleService.moveTo(order, 'ACCEPTED', { acceptedAt: new Date() });
  return {
    order: { id: String(order._id), lifecycle: order.lifecycle, acceptedAt: order.acceptedAt },
  };
}

/**
 * Reject: refuse the order and raise what it owes as a document.
 *
 * The refund is raised through `jhatka.refund.settlement.raiseOrderRefund`, never
 * constructed here: BR-19 says a refund is always a document, and the settlement
 * module owns what that document contains (gateway resolution, ceiling, idempotency).
 * A rejection that records `cancellation.refundAmount` without minting the row is
 * money owed that the 03:30 sweep can never settle.
 */
async function rejectOrder({
  models, order, body = {}, actor, nextNumber, refundSettlement,
} = {}) {
  const { reason, reasonCategory } = body;
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required to reject an order');

  await lifecycleService.moveTo(order, 'REJECTED', {
    cancellation: {
      cancelledAt: new Date(),
      cancelledBy: 'outlet',
      reason,
      reasonCategory,
      stage: 'REJECTED',
      // A rejection before acceptance has collected nothing and consumed nothing,
      // so the refund is the full estimate for a prepaid order and zero for COD.
      // `original_payment`, not `gateway`: the ORDER records which direction the
      // money goes, and the `JhatkaRefund` raised below resolves WHICH provider.
      refundAmount: order.paymentMode === 'gateway' ? order.estimatedTotal : 0,
      refundMethod: order.paymentMode === 'gateway' ? 'original_payment' : 'none',
    },
  });

  const { refund, created } = await refundSettlement.raiseOrderRefund({
    models,
    order,
    reason: 'OUTLET_REJECTED',
    reasonNote: reason,
    actor,
    nextNumber,
  });

  return {
    order: { id: String(order._id), lifecycle: order.lifecycle, cancellation: order.cancellation },
    refund: {
      id: String(refund._id),
      refundNo: refund.refundNo,
      amount: refund.amount,
      status: refund.status,
      gatewayResolution: refund.gatewayResolutionNote,
      created,
    },
  };
}

/**
 * Start preparation: supersede old tickets, write a new one, allocate real stock.
 *
 * §5.4/BR-10 — allocate real stock to each line NOW, not later. Nothing did this
 * before: a ticket was created, the order moved, and every line claimed to come from
 * no batch at all. §11's recall queries `{batch: 1}`, so an unallocated pack is a
 * pack that cannot be traced back to the meat it came from.
 *
 * Refused BEFORE anything persists when stock falls short, so an unfulfillable order
 * never enters PREPARING with stock neither claimed nor available. A ticket that says
 * "cut this" when there is nothing to cut from is how stock gets quietly substituted.
 */
async function startPreparation({
  models, order, outletId, body = {}, actor, nextNumber, reservationService, entryReason,
} = {}) {
  const { JhatkaPreparationTicket } = models;
  const { items, coldChain } = body;

  if (!Array.isArray(items) || !items.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'items is required');
  }

  lifecycleService.assertTransition(order.lifecycle, 'PREPARING');

  // Supersede any open ticket: a re-weigh creates a NEW ticket so the old one is
  // retained as history rather than mutated. Preparation tickets are evidence.
  await JhatkaPreparationTicket.updateMany(
    { order: order._id, status: { $in: ['open', 'weighing'] } },
    { status: 'cancelled' }
  );

  const attempt =
    (await JhatkaPreparationTicket.countDocuments({ order: order._id })) + 1;

  const lines = [];
  for (const entry of items) {
    const item = order.items.id(entry.orderItem || entry.itemId);
    if (!item) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Item ${entry.orderItem || entry.itemId} not on this order`);
    }
    lines.push({
      orderItem: item._id,
      product: item.product,
      sku: item.sku,
      requestedQty: item.requestedQuantity,
      batch: entry.batch,
      allocatedQty: entry.allocatedQty,
      status: entry.batch ? 'allocated' : 'pending',
      note: entry.note,
    });
  }

  const ticket = new JhatkaPreparationTicket({
    ticketNo: nextNumber('PT'),
    order: order._id,
    outlet: order.outlet,
    business: order.business,
    attempt,
    isCurrent: true,
    reason: entryReason(body?.reason) || 'initial',
    lines,
    status: 'open',
    coldChain: coldChain
      ? {
          tempC: coldChain.tempC,
          at: coldChain.at || new Date(),
          by: actor._id,
          byName: actor.name,
          withinBand: coldChain.withinBand,
          breachReason: coldChain.breachReason,
        }
      : undefined,
  });

  const ticketError = ticket.validateSync();
  if (ticketError) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Preparation ticket failed validation', true, '', {
      fields: Object.keys(ticketError.errors),
    });
  }
  await ticket.save();

  // A line may be filled from SEVERAL batches; each becomes its own allocation.
  const shortfalls = [];
  for (const item of order.items) {
    const res = await reservationService.allocateOrderItem({
      order,
      item,
      outlet: outletId,
      models,
      actor,
    });

    if (res.shortfall > 0) {
      shortfalls.push({ sku: item.sku, wanted: item.requestedQuantity?.value, short: res.shortfall });
    }
  }

  if (shortfalls.length) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Not enough raw stock to prepare: ${shortfalls
        .map((s) => `${s.sku} short by ${s.short}`)
        .join('; ')}`,
      true,
      '',
      { code: 'INSUFFICIENT_RAW_STOCK', shortfalls }
    );
  }

  await lifecycleService.moveTo(order, 'PREPARING', {
    preparation: {
      startedAt: order.preparation?.startedAt || new Date(),
      startedBy: actor._id,
      ticketRefs: [{ ticket: ticket._id }],
    },
  });

  return {
    ticket: { id: String(ticket._id), ticketNo: ticket.ticketNo, attempt, status: ticket.status, lines: ticket.lines },
    order: { id: String(order._id), lifecycle: order.lifecycle },
  };
}

/**
 * Pack: requires every weight line confirmed first (§16.2 VW-08, in code not UI).
 *
 * BR-12: `withinBand: false` at packing BLOCKS dispatch. Fresh meat above 4°C is
 * unsafe, and packing is the last point at which it is still fixable.
 */
async function packOrder({ order, body = {}, actor } = {}) {
  const weightLines = order.items.filter((i) => i.measurementMode === 'WEIGHT');
  const unconfirmed = weightLines.filter((i) => !i.actualQuantity);
  if (unconfirmed.length) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Every variable-weight line must be weighed before packing',
      true,
      '',
      { code: 'WEIGHT_NOT_CONFIRMED', skus: unconfirmed.map((i) => i.sku) }
    );
  }

  const { packageCount, totalWeightGrams, coldChain, fragile, note } = body;
  const withinBand = coldChain?.withinBand !== false;

  await lifecycleService.moveTo(order, 'PACKING', {
    packing: {
      completedAt: new Date(),
      completedBy: actor._id,
      packageCount: Number(packageCount ?? 1),
      totalWeightGrams: Number(totalWeightGrams ?? order.promisedWeightGrams ?? 0),
      coldChain: coldChain
        ? {
            packingTempC: Number(coldChain.tempC),
            at: coldChain.at || new Date(),
            by: actor._id,
            withinBand,
            breachReason: coldChain.breachReason,
          }
        : undefined,
      fragile: !!fragile,
      note,
    },
  });

  return {
    order: {
      id: String(order._id),
      lifecycle: order.lifecycle,
      packing: order.packing,
      canDispatch: withinBand,
    },
  };
}

/**
 * Ready: a packing breach must not be laundered into READY.
 */
async function markReady({ order } = {}) {
  if (order.packing?.coldChain && order.packing.coldChain.withinBand === false) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'This order failed the cold-chain band at packing and cannot be marked ready',
      true,
      '',
      { code: 'COLD_CHAIN_BREACH', breachReason: order.packing.coldChain.breachReason }
    );
  }

  await lifecycleService.moveTo(order, 'READY', { readyAt: new Date() });

  return { order: { id: String(order._id), lifecycle: order.lifecycle, readyAt: order.readyAt } };
}

/**
 * Dispatch: assign an outlet-owned rider and open the delivery.
 *
 * §13.2: Jhatka has NO platform pool. Every rider is outlet-owned, so a driver from
 * another outlet is not a warning — it is a refusal. `agentMode` is set EXPLICITLY
 * rather than leaning on the model default, so a dispatch can never land on
 * `platform_pool` via a future default change.
 *
 * The transit guard runs here, not at pickup: an order that has sat READY past the
 * cold-chain limit cannot be dispatched, full stop.
 */
async function dispatchOrder({
  models, order, outletId, body = {}, actor, nextNumber, settingsService,
} = {}) {
  const { JhatkaDriver, JhatkaOutlet, JhatkaDelivery } = models;
  const { driver: driverId } = body;

  if (!driverId) throw new ApiError(httpStatus.BAD_REQUEST, 'driver is required');

  lifecycleService.assertTransition(order.lifecycle, 'DRIVER_ASSIGNED');

  const driver = await JhatkaDriver.findById(driverId);
  if (!driver) throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found');

  if (String(driver.outlet) !== String(outletId)) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      'This driver does not belong to this outlet',
      true,
      '',
      { driverOutlet: String(driver.outlet), orderOutlet: String(outletId) }
    );
  }
  if (driver.status !== 'active' || driver.isBlocked) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      `Driver is ${driver.isBlocked ? 'blocked' : driver.status}`,
      true,
      '',
      { status: driver.status, blockReason: driver.blockReason }
    );
  }

  const outlet = await JhatkaOutlet.findById(outletId).lean();
  const maxTransitMinutes = outlet?.qualityPolicy?.maxTransitMinutes
    ?? (await settingsService.getMaxTransitMinutes());

  const transitMinutes = order.readyAt
    ? Math.round((Date.now() - new Date(order.readyAt).getTime()) / 60000)
    : 0;
  if (transitMinutes > maxTransitMinutes) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Order has been ready for ${transitMinutes} minutes, beyond the ${maxTransitMinutes}-minute transit limit`,
      true,
      '',
      { code: 'MAX_TRANSIT_EXCEEDED', transitMinutes, maxTransitMinutes }
    );
  }

  const delivery = new JhatkaDelivery({
    deliveryNo: nextNumber('DL'),
    order: order._id,
    outlet: order.outlet,
    customer: order.customer,
    driver: driver._id,
    status: 'assigned',
    addressSnapshot: order.deliveryAddressSnapshot || order.addressSnapshot,
    address: order.address,
    agentMode: 'own_fleet',
    coldChain: {
      packingTempC: order.packing?.coldChain?.packingTempC,
      packingAt: order.packing?.coldChain?.at,
      maxTransitMinutes,
      transitMinutes,
      blockedReason:
        order.packing?.coldChain?.withinBand === false ? order.packing.coldChain.breachReason : undefined,
    },
    codStatus: order.paymentMode === 'cod' ? 'pending' : 'not_applicable',
    // Frozen at weight confirmation so the rider's ceiling cannot drift later.
    codAmount: order.codAmount,
    codCollectionAmount: order.codAmount,
    estimatedDistanceKm: body?.estimatedDistanceKm,
    assignedAt: new Date(),
    assignedBy: actor._id,
  });
  await delivery.save();

  await lifecycleService.moveTo(order, 'DRIVER_ASSIGNED', { delivery: delivery._id });

  return {
    delivery: {
      id: String(delivery._id),
      deliveryNo: delivery.deliveryNo,
      driver: { id: String(driver._id), name: driver.name, mobile: driver.mobile },
      status: delivery.status,
      codCollectionAmount: delivery.codCollectionAmount,
    },
    order: { id: String(order._id), lifecycle: order.lifecycle },
  };
}

module.exports = {
  listOrders,
  orderDetail,
  receiveOrder,
  acceptOrder,
  rejectOrder,
  startPreparation,
  packOrder,
  markReady,
  dispatchOrder,
  MAX_PAGE_LIMIT,
};