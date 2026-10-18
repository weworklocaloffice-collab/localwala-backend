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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const inventoryService = require('./stores.inventory.service');
const basketService = require('./stores.basket.service');
const promotionService = require('./stores.promotion.service');
const invoiceService = require('./stores.invoice.service');
// BR-28 / BR-33. Required by `cancelOrder`, which is the only place a whole order is
// refunded. Left out previously, which is why cancelling a paid order wrote no refund.
const refundService = require('./stores.refund.service');
const StoreCancellation = mongoose.model('StoreCancellation');
const StoreCancellationAttempt = mongoose.model('StoreCancellationAttempt');

const ORDER_TRANSITIONS = {
  created: ['payment_pending', 'cancelled'],
  payment_pending: ['paid', 'payment_failed', 'cancelled'],
  paid: ['store_received', 'cancelled'],
  store_received: ['accepted', 'cancelled'],
  accepted: ['picking', 'cancelled'],
  picking: ['packing', 'cancelled'],
  packing: ['ready', 'cancelled'],
  ready: ['driver_assigned', 'cancelled'],
  driver_assigned: ['picked_up', 'cancelled'],
  picked_up: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
  payment_failed: ['payment_pending', 'cancelled'],
};

const assertTransition = (from, to) => {
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_ORDER_MOVE: ${from} -> ${to} is not allowed. Allowed: ${allowed?.join(', ') || 'none'}`);
  }
};

const generateOrderNo = async () => {
  const StoreOrder = mongoose.model('StoreOrder');
  const last = await StoreOrder.findOne().sort({ orderNo: -1 }).select('orderNo').lean();
  return (last?.orderNo || 100000) + 1;
};

const createOrder = async ({ customer, outlet, chain, items, address, addressSnapshot, paymentMode, promo, coupon, promoCode, couponCode, instructions }) => {
  const StoreOrder = mongoose.model('StoreOrder');

  const orderNo = await generateOrderNo();

  // §8.4: totals are recomputed server-side — client totals are never trusted.
  // Price comes from the (variant × outlet) row, the promo discount from the
  // promotion engine, tax from the GST helper. The request contributes only
  // product + variant + quantity per line (plus display-only name/image).
  const basket = await basketService.resolveBasket({
    outlet,
    chain,
    items,
    promoCode: promoCode || (promo && promo.code),
    customerId: customer,
    paymentMode,
  });
  const t = basket.totals;

  const order = await StoreOrder.create({
    orderNo,
    customer,
    outlet,
    chain,
    items: basket.lines.map((line) => ({
      ...line,
      fulfilledQuantity: 0,
      cancelledQuantity: 0,
      refundedQuantity: 0,
      refundedAmount: 0,
    })),
    address,
    addressSnapshot,
    itemsSubtotal: t.itemsSubtotal,
    itemDiscountTotal: t.itemDiscountTotal,
    taxTotal: t.taxTotal,
    cgstTotal: basket.taxSummary.cgst,
    sgstTotal: basket.taxSummary.sgst,
    igstTotal: basket.taxSummary.igst,
    placeOfSupply: basket.placeOfSupply,
    deliveryFee: t.deliveryFee,
    deliveryTax: t.deliveryTax,
    packagingFee: t.packagingFee,
    serviceFee: t.serviceFee,
    deliveryTip: t.deliveryTip,
    discountTotal: t.discountTotal,
    grandTotal: t.grandTotal,
    // COD is cash at the door: the full total stays outstanding until the
    // driver collects it. Nothing is paid at creation, in any mode — the
    // gateway callback (or the COD collection) records payment, never the
    // order write. A born-"paid" order would defeat the refund gate (BR-28).
    codAmount: paymentMode === 'cod' ? t.grandTotal : 0,
    paidAmount: 0,
    paymentMode,
    paymentStatus: 'pending',
    promo: basket.promo,
    coupon,
    instructions,
    lifecycle: 'created',
    totalItems: basket.lines.length,
    totalQuantity: t.totalQuantity,
  });

  // The promo is consumed by the order, not the quote: a summary that fails
  // validation — or an order that fails creation — must not burn usage.
  if (basket.promoDoc) {
    try {
      await promotionService.applyPromotion(basket.promoDoc._id);
    } catch (applyError) {
      console.error(`Promo ${basket.promoDoc.code} validated but usage could not be recorded:`, applyError.message);
    }
  }

  // Partial-failure compensation (BR-30): ...
  //
  // COD reservations use the outlet's `codAcceptanceTimeoutMinutes`; online
  // orders get the fixed 30-minute payment window.
  const reservationTtlMs =
    paymentMode === 'cod'
      ? (basket.outlet.deliveryConfig?.codAcceptanceTimeoutMinutes || 60) * 60000
      : 30 * 60000;
  try {
    for (const line of basket.lines) {
      await inventoryService.reserveStock({
        outlet, chain, variant: line.variant, product: line.product,
        order: order._id, quantity: line.quantity,
        expiresAt: new Date(Date.now() + reservationTtlMs),
      });
    }
  } catch (reserveError) {
    try {
      await transitionOrder(order._id, 'cancelled');
    } catch (cancelError) {
      console.error(`Order ${order._id} failed to reserve and then failed to cancel:`, cancelError.message);
    }
    throw reserveError;
  }

  return order;
};

const transitionOrder = async (orderId, to, { actor, notes } = {}) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const order = await StoreOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  assertTransition(order.lifecycle, to);

  const from = order.lifecycle;
  order.lifecycle = to;

  const now = new Date();
  if (to === 'paid') {
    order.paidAt = now;
    order.paymentStatus = 'paid';
    // Record WHAT was paid. The transition used to set only `paymentStatus`, leaving
    // `paidAmount` at whatever `createOrder` put there — 0 for COD.
    //
    // That silently breaks two money paths that both read `paidAmount`:
    //   - the BR-28/BR-33 refund gate (`paidAmount > 0`), so a cancelled paid order
    //     refunded nothing;
    //   - settlement, which pays the store out of collected amounts and would pay 0.
    //
    // `grandTotal` is already net of discounts and includes tax and fees, so it is the
    // amount actually charged. Re-entering `paid` is not possible (the ladder has no
    // self-edge), so there is no double-count to guard against.
    order.paidAmount = order.grandTotal;
    // The COD amount was collected in cash at the door, so it is no longer outstanding.
    order.codAmount = 0;
    // BR-43: the order becomes billable here, so the invoice number is issued
    // here — not at creation. `!order.invoiceNo` makes a retried callback
    // reuse the existing number instead of consuming a second one.
    if (!order.invoiceNo) {
      const { invoiceNo } = await invoiceService.issueInvoiceNumber(order.outlet);
      order.invoiceNo = invoiceNo;
      order.invoiceStatus = 'issued';
    }
  }
  if (to === 'store_received') order.acceptedAt = now;
  if (to === 'accepted') order.acceptedAt = now;
  if (to === 'picking') order.picking = { ...order.picking, startedAt: now };
  if (to === 'packing') order.packing = { ...order.packing, completedAt: now };
  if (to === 'ready') order.readyAt = now;
  if (to === 'picked_up') order.pickedUpAt = now;
  if (to === 'delivered') order.deliveredAt = now;
  if (to === 'completed') order.completedAt = now;

  // BR-30, the COMMIT half of reserve -> commit/release.
  //
  // `commitReservation` was written and exported but had NO CALLER anywhere in the
  // codebase, so the stock lifecycle stopped at "held". Nothing ever decremented `onHand`,
  // meaning every completed order left its stock permanently reserved and unavailable to
  // sell — the shop's inventory slowly drains to zero and never recovers.
  //
  // It belongs on `completed`, not `delivered`: the goods physically left the store at
  // handover, but the sale is only final once the order closes. Committing at `delivered`
  // would decrement stock for an order a customer could still cancel or dispute.
  //
  // Only fulfilled lines commit. An unavailable or cancelled line released its reservation
  // already (see the `cancelled` branch below) and must NOT be decremented a second time.
  if (to === 'completed') {
    for (const item of order.items) {
      const fulfilledQty = item.fulfilledQuantity || 0;
      if (fulfilledQty > 0) {
        await inventoryService.commitReservation({
          order: order._id,
          variant: item.variant,
          quantity: fulfilledQty,
        });
      }
    }
  }

  if (to === 'cancelled') {
    for (const item of order.items) {
      await inventoryService.releaseReservation({ order: order._id, variant: item.variant, quantity: item.quantity, reason: 'order_cancelled' });
    }
  }

  await order.save();
  return order;
};

const getOrder = async (orderId) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const order = await StoreOrder.findById(orderId)
    .populate('customer', 'name mobile email')
    .populate('outlet', 'name outletCode')
    .populate('items.product', 'name slug images')
    .populate('items.variant', 'name sku')
    .lean();
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  return order;
};

const listOrders = async ({ outlet, customer, lifecycle, page = 1, limit = 20 }) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (customer) filter.customer = customer;
  if (lifecycle) filter.lifecycle = lifecycle;

  const [items, total] = await Promise.all([
    StoreOrder.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreOrder.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

/**
 * ## BR-28 / BR-33 — cancelling a PAID order must refund it, per line
 *
 * ## What was wrong
 *
 * `cancelOrder` called `transitionOrder(... 'cancelled')`, which released the stock
 * reservations and stopped there. No `StoreRefund` row was ever written. So a customer who
 * paid for two items and cancelled got their money back from nobody — the order flipped to
 * `cancelled`, the stock went back on the shelf, and the payment stayed captured. Free
 * goods, and the store eats both the stock and the payout.
 *
 * ## Why it is per-COMPONENT and not one lump sum
 *
 * BR-28/BR-33 refund the *components* actually paid for, and this is where that matters:
 *
 *   - Each line refunds its own `lineGrand`, never `order.grandTotal`. The grand total
 *     also contains the delivery fee, discounts and tax adjustments, so refunding it
 *     would hand back money for things that were never charged per line.
 *   - The delivery fee is its OWN refund, because a cancelled order never gets delivered
 *     and so was never earned.
 *   - Partial cancellations refund only the cancelled lines, which is what the order's
 *     `cancelledQuantity` per item records.
 *
 * ## Only what was actually CAPTURED
 *
 * A COD order, or a gateway order whose webhook has not landed, must NOT create refunds —
 * there is no captured payment to give back, and a refund row for it would later be picked
 * up by settlement as a payout that was never collected.
 *
 * The gate is deliberately TWO conditions, not one:
 *
 *   `paidAmount > 0`            -> some money is attributed to the order
 *   `paymentStatus === 'paid'`  -> and it has actually been CAPTURED
 *
 * `createOrder` sets `paidAmount = grandTotal` for a gateway order while `paymentStatus` is
 * still `pending`, so `paidAmount` alone would refund money that was never taken. Both
 * together mean the money is real.
 */
/**
 * Maps a cancellation to the controlled `StoreRefund.reason` vocabulary.
 *
 * ## Why this mapping exists
 *
 * `StoreRefund.reason` is an enum about WHY money went back, and it is consumed by
 * settlement and by the finance team to group refunds. A customer's "changed mind" is free
 * text and is not in that vocabulary — passing it straight through failed Mongoose with
 * `` `changed mind` is not a valid enum value for path `reason` ``, which surfaced as an
 * opaque 400 on the customer's own cancel request AND left the reservation released with
 * no refund, because the save failed partway through the transition.
 *
 * So: the enum says WHY, and the customer's actual words are preserved on the ORDER's
 * cancellation note (via `transitionOrder` notes) and appended to the refund note for the
 * human who later reads the finance report. Nothing is lost, and the enum stays
 * aggregatable.
 *
 * Fallback is `'other'` rather than a throw: an unmapped reason must never be able to
 * block a customer's refund.
 */
const REFUND_REASON_BY_CANCELLER = {
  customer: 'customer_cancellation',
  store: 'store_rejected',
  admin: 'store_rejected',
  system: 'other',
};

const CANCELLATION_REASON_BY_CANCELLER = {
  customer: 'customer_request',
  store: 'store_closed',
  admin: 'store_closed',
  system: 'other',
};

const refundReasonFor = (cancelledBy, reason) => {
  const refundMapped = REFUND_REASON_BY_CANCELLER[cancelledBy] || 'other';
  const cancellationMapped = CANCELLATION_REASON_BY_CANCELLER[cancelledBy] || 'other';
  const note = reason ? ` Customer said: ${reason}` : '';
  return { refundReason: refundMapped, cancellationReason: cancellationMapped, note };
};

const cancelOrder = async (orderId, { reason, cancelledBy, cancelledByUserId }) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const order = await StoreOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  // Mark every line cancelled BEFORE the transition.
  //
  // `createOrderRefunds` refunds a line only when it is flagged cancelled, which is what
  // makes it correct for a PARTIAL cancellation too: flag only the lines being cancelled
  // and only those refund. Setting `cancelledQuantity = orderedQuantity` keeps the
  // per-line quantity accounting honest, and `fulfilment` is the doc's own vocabulary.
  for (const item of order.items) {
    item.cancelledQuantity = item.orderedQuantity || item.quantity;
    item.fulfilment = 'cancelled';
  }
  order.refundedAmount = order.refundedAmount || 0;
  await order.save();

  const mapped = refundReasonFor(cancelledBy, reason);

  // Create StoreCancellationAttempt record (G3: track every cancellation attempt)
  const attempt = await StoreCancellationAttempt.create({
    order: order._id,
    outlet: order.outlet,
    customer: order.customer,
    reason,
    reasonCategory: mapped.cancellationReason,
    requestedBy: cancelledBy,
    status: 'pending',
  });

  const cancelled = await transitionOrder(orderId, 'cancelled', {
    actor: cancelledByUserId,
    notes: reason,
  });

  // Update attempt to approved since we're proceeding
  attempt.status = 'approved';
  attempt.resolution = 'approved';
  attempt.resolvedAt = new Date();
  attempt.resolvedBy = cancelledByUserId;
  await attempt.save();

  // BR-43: a paid order's invoice is voided, never deleted or reused. An order
  // cancelled before payment never held a number, so there is nothing to void.
  if (cancelled.invoiceStatus === 'issued') {
    cancelled.invoiceStatus = 'void';
    await cancelled.save();
  }

  let totalRefund = 0;
  if ((cancelled.paidAmount || 0) > 0 && cancelled.paymentStatus === 'paid') {
    const refunds = await refundService.createOrderRefunds(orderId, {
      reason: mapped.refundReason,
      fundingSource: 'connected_account',
    });

    // Roll the refunded total onto the order so the settlement ledger and the customer's
    // order view agree without re-summing every refund row. The refund service enforces
    // the per-order ceiling, so this cannot exceed what was paid.
    const total = refunds.reduce((sum, r) => sum + (r.amount || 0), 0);
    if (total > 0) {
      cancelled.refundedAmount = (cancelled.refundedAmount || 0) + total;
      cancelled.paymentStatus = 'refunded';
      totalRefund = total;
      await cancelled.save();
    }
  }

  // Create StoreCancellation record
  const items = order.items.map(item => ({
    product: item.product,
    variant: item.variant,
    name: item.name,
    quantity: item.cancelledQuantity || item.quantity,
    unitPrice: item.unitPrice,
    refundAmount: (item.refundedAmount || 0) + (item.quantity > 0 ? ((item.lineGrand || item.unitPrice * item.quantity) * (totalRefund / order.grandTotal)) : 0),
    taxAmount: item.taxAmount || 0,
  }));

  await StoreCancellation.create({
    order: order._id,
    outlet: order.outlet,
    chain: order.chain,
    customer: order.customer,
    reason,
    reasonCategory: mapped.cancellationReason,
    cancelledBy,
    cancelledByUserId,
    items,
    totalRefundAmount: totalRefund,
    refundMethod: totalRefund > 0 ? 'original_payment' : undefined,
    refundedAt: totalRefund > 0 ? new Date() : undefined,
    status: totalRefund > 0 ? 'refunded' : 'cancelled',
    notes: reason,
  });

  return cancelled;
};

module.exports = {
  createOrder,
  transitionOrder,
  getOrder,
  listOrders,
  cancelOrder,
  assertTransition,
  ORDER_TRANSITIONS,
};