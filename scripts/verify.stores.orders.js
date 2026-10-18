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

/**
 * verify.stores.orders.js — the order engine's frozen rules.
 *
 * Run: node scripts/verify.stores.orders.js
 *
 * ## What this pins
 *
 *   BR-28  refunds are component-based — a cancelled line refunds its OWN share,
 *          never the whole order
 *   BR-33  sum of refunds <= grandTotal, and each component refunds at most once
 *   BR-43  invoice numbers are voided on cancellation, never deleted or reused
 *   §5.x   the lifecycle transition table — legal moves accepted, illegal moves
 *          rejected with ILLEGAL_ORDER_MOVE rather than silently applied
 *
 * ## Why orders are built as documents here rather than via createOrder
 *
 * `createOrder` resolves prices through `basketService.resolveBasket`, which needs real
 * StoreOutletProduct rows carrying prices, tax config and a promotion engine. That is the
 * right fixture for a pricing test. These rules are about what happens to an order AFTER it
 * exists, so the suite writes the order directly with known line values and then exercises
 * cancel/refund. `verify.stores.payments.js` uses the same approach and the reasoning is
 * recorded there.
 *
 * Fixtures are synthetic ObjectIds; Mongoose does not enforce ref existence here. Every row
 * created is deleted in the `finally`.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const orderService = require('../src/modules/stores/services/stores.order.service');
const refundService = require('../src/modules/stores/services/stores.refund.service');

// The services resolve models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.order.model');
require('../src/modules/stores/models/store.refund.model');
require('../src/modules/stores/models/store.cancellation.model');
require('../src/modules/stores/models/store.cancellation.attempt.model');
// `transitionOrder` calls the invoice service on `paid` and the inventory service on
// `completed`/`cancelled`, both of which resolve their own models.
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/store.outlet.stock.item.model');
require('../src/modules/stores/models/store.stock.reservation.model');
require('../src/modules/stores/models/store.inventory.movement.model');

const StoreOrder = mongoose.model('StoreOrder');
const StoreRefund = mongoose.model('StoreRefund');
const StoreCancellation = mongoose.model('StoreCancellation');
const StoreCancellationAttempt = mongoose.model('StoreCancellationAttempt');
const StoreOutlet = mongoose.model('StoreOutlet');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const OUTLET = new mongoose.Types.ObjectId();
const CHAIN = new mongoose.Types.ObjectId();
const CUSTOMER = new mongoose.Types.ObjectId();
const STAMP = Date.now();

/**
 * Money note: `StoreOrder` money fields carry the platform getter, so a value assigned in
 * the document is RUPEES and reads back as rupees. These fixtures use small whole-rupee
 * amounts so an arithmetic slip is obvious rather than a rounding artefact.
 */
// orderNo is globally unique, but cleanup deletes by outlet — so a crashed run leaves
// rows no later run can see. A sequential scheme (`base + seq`) then collides with the
// leftovers on the next run. Each order therefore draws its own high-entropy number:
// colliding would need the same 5 random digits twice, not merely two runs in one second.
const nextOrderNo = () => 9500000 + Math.floor(Math.random() * 89999);

const makeOrder = async (overrides = {}) => {
  return StoreOrder.create({
    orderNo: nextOrderNo(),
    customer: CUSTOMER,
    outlet: OUTLET,
    chain: CHAIN,
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        variant: new mongoose.Types.ObjectId(),
        name: 'Line A',
        quantity: 2,
        orderedQuantity: 2,
        fulfilledQuantity: 0,
        cancelledQuantity: 0,
        unitPrice: 100,
        discountAmount: 0,
        lineTotal: 200,
        lineGrand: 236,
        fulfilment: 'pending',
      },
      {
        product: new mongoose.Types.ObjectId(),
        variant: new mongoose.Types.ObjectId(),
        name: 'Line B',
        quantity: 1,
        orderedQuantity: 1,
        fulfilledQuantity: 0,
        cancelledQuantity: 0,
        unitPrice: 300,
        discountAmount: 0,
        lineTotal: 300,
        lineGrand: 354,
        fulfilment: 'pending',
      },
    ],
    itemsSubtotal: 500,
    deliveryFee: 40,
    grandTotal: 670,
    paymentMode: 'gateway',
    paymentStatus: 'paid',
    paidAmount: 670,
    lifecycle: 'paid',
    invoiceStatus: 'issued',
    invoiceNo: 'TEST-' + STAMP + '-' + Math.floor(Math.random() * 100000),
    ...overrides,
  });
};

const cleanup = async () => {
  await StoreRefund.deleteMany({ outlet: OUTLET });
  await StoreCancellationAttempt.deleteMany({ outlet: OUTLET });
  await StoreCancellation.deleteMany({ outlet: OUTLET });
  await mongoose.model('StoreInventoryMovement').deleteMany({ outlet: OUTLET });
  await mongoose.model('StoreStockReservation').deleteMany({ outlet: OUTLET });
  await mongoose.model('StoreOutletStockItem').deleteMany({ outlet: OUTLET });
  await StoreOrder.deleteMany({ outlet: OUTLET });
  await StoreOutlet.deleteMany({ _id: { $in: outletIds } });
};
const outletIds = [];

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== lifecycle transition table ===\n');

  for (const [from, allowed] of Object.entries(orderService.ORDER_TRANSITIONS)) {
    for (const to of allowed) {
      let threw = false;
      try {
        orderService.assertTransition(from, to);
      } catch (e) {
        threw = true;
      }
      if (threw) ck(`${from} -> ${to} is allowed`, false, 'threw ILLEGAL_ORDER_MOVE');
    }
  }
  ck('every transition the table permits is accepted', true);

  const illegal = [
    ['delivered', 'cancelled'],
    ['completed', 'cancelled'],
    ['completed', 'delivered'],
    ['cancelled', 'created'],
    ['rejected', 'accepted'],
    ['out_for_delivery', 'picking'],
    ['ready', 'picked_up'],
    ['created', 'delivered'],
  ];
  for (const [from, to] of illegal) {
    let msg = '';
    try {
      orderService.assertTransition(from, to);
    } catch (e) {
      msg = e.message || '';
    }
    ck(`${from} -> ${to} is rejected`, /ILLEGAL_ORDER_MOVE/.test(msg), msg);
  }

  console.log('\n=== BR-28: a cancelled line refunds its own share ===\n');

  const single = await makeOrder();
  // Flag ONLY line B cancelled — this is the partial-cancellation shape.
  single.items[0].fulfilment = 'pending';
  single.items[0].cancelledQuantity = 0;
  single.items[1].fulfilment = 'cancelled';
  single.items[1].cancelledQuantity = 1;
  await single.save();

  const refunds = await refundService.createOrderRefunds(single._id, { reason: 'customer_cancellation' });
  // This fixture has deliveryFee 40, so a partial cancellation raises the line refund AND
  // the fee component. Count the line components specifically.
  const lineRefunds = refunds.filter((r) => r.componentKey.startsWith('item:'));
  const feeRefunds = refunds.filter((r) => r.componentKey === 'delivery_fee');
  ck('exactly one LINE component refund is raised', lineRefunds.length === 1, `lineCount=${lineRefunds.length}`);
  ck('it is line B, not line A', lineRefunds[0].componentKey === `item:${single.items[1].variant}`, lineRefunds[0].componentKey);
  ck('it refunds line B own share (lineGrand 354)', Number(lineRefunds[0].amount) === 354, lineRefunds[0].amount);
  ck('the whole-order grandTotal is NOT refunded', Number(lineRefunds[0].amount) !== 670, lineRefunds[0].amount);
  ck('the untouched line raises no refund', !lineRefunds.some((r) => r.componentKey === `item:${single.items[0].variant}`));
  ck('the delivery fee is refunded as its own component', feeRefunds.length === 1, `feeCount=${feeRefunds.length}`);

  console.log('\n=== BR-28: the delivery fee is its own component ===\n');

  const withFee = await makeOrder();
  withFee.items.forEach((i) => {
    i.fulfilment = 'cancelled';
    i.cancelledQuantity = i.orderedQuantity;
  });
  await withFee.save();

  const allRefunds = await refundService.createOrderRefunds(withFee._id, { reason: 'store_rejected' });
  const keys = allRefunds.map((r) => r.componentKey).sort();
  ck('both lines plus the fee are raised', allRefunds.length === 3, `count=${allRefunds.length}`);
  ck('one component is the delivery fee', keys.includes('delivery_fee'));
  const feeRefund = allRefunds.find((r) => r.componentKey === 'delivery_fee');
  ck('the fee refund is the fee amount', Number(feeRefund.amount) === 40, feeRefund.amount);

  console.log('\n=== BR-33: each component refunds at most once ===\n');

  let dupBlocked = false;
  try {
    await refundService.createComponentRefund({
      order: single, componentKey: `item:${single.items[1].variant}`, amount: 10, reason: 'other', fundingSource: 'connected_account',
    });
  } catch (e) {
    dupBlocked = e.code === 11000;
  }
  ck('a second refund for the same component key is rejected by the unique index', dupBlocked);
  const dupCount = await StoreRefund.countDocuments({ order: single._id, componentKey: `item:${single.items[1].variant}` });
  ck('only one row exists for that component', dupCount === 1, `count=${dupCount}`);

  // The regression this guards: order items are declared `_id: false`, so a component key
  // built from `item._id` collapses every line onto the literal string "item:undefined" and
  // the second line of a multi-line cancellation dies on the unique index.
  console.log('\n=== two cancelled lines refund independently ===\n');

  const twoLines = await makeOrder();
  twoLines.items.forEach((i) => {
    i.fulfilment = 'cancelled';
    i.cancelledQuantity = i.orderedQuantity;
  });
  await twoLines.save();

  let twoLineErr = null;
  let twoLineRefunds = [];
  try {
    twoLineRefunds = await refundService.createOrderRefunds(twoLines._id, { reason: 'store_rejected' });
  } catch (e) {
    twoLineErr = e;
  }
  ck('a multi-line cancellation does not throw', twoLineErr === null, twoLineErr ? `${twoLineErr.code} ${twoLineErr.message.slice(0, 90)}` : '');
  const twoLineKeys = twoLineRefunds.filter((r) => r.componentKey.startsWith('item:')).map((r) => r.componentKey).sort();
  ck('both lines get their own component key', twoLineKeys.length === 2, `keys=${twoLineKeys.join(' | ')}`);
  ck('the two line keys are distinct', new Set(twoLineKeys).size === 2, `keys=${twoLineKeys.join(' | ')}`);
  ck('no component key is the literal "item:undefined"', !twoLineKeys.includes('item:undefined'), twoLineKeys.join(' | '));

  console.log('\n=== BR-33: refunds never exceed grandTotal ===\n');

  const ceiling = await makeOrder();
  ceiling.items.forEach((i) => {
    i.fulfilment = 'cancelled';
    i.cancelledQuantity = i.orderedQuantity;
  });
  await ceiling.save();
  await refundService.createOrderRefunds(ceiling._id, { reason: 'store_rejected' });

  const summed = await StoreRefund.aggregate([
    { $match: { order: ceiling._id, status: { $ne: 'REVERSED' } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const refundedSoFar = summed.length ? summed[0].total : 0;
  ck('a full cancellation refunds items plus fee', refundedSoFar === 630, `total=${refundedSoFar}`);
  ck('the total is below grandTotal (670)', refundedSoFar <= 670, `total=${refundedSoFar}`);

  let ceilingBlocked = false;
  let ceilingMsg = '';
  try {
    await refundService.createComponentRefund({
      order: ceiling, componentKey: 'packaging_fee', amount: 100, reason: 'other', fundingSource: 'connected_account',
    });
  } catch (e) {
    ceilingBlocked = /REFUND_CEILING_EXCEEDED/.test(e.message || '');
    ceilingMsg = e.message;
  }
  ck('a refund that would breach the ceiling is rejected', ceilingBlocked, ceilingMsg);

  let withinCeiling = false;
  try {
    const r = await refundService.createComponentRefund({
      order: ceiling, componentKey: 'packaging_fee', amount: 40, reason: 'other', fundingSource: 'connected_account',
    });
    withinCeiling = Number(r.amount) === 40;
  } catch (e) {
    withinCeiling = false;
  }
  ck('a refund that exactly fills the ceiling is accepted', withinCeiling);

  console.log('\n=== a REVERSED refund frees its budget ===\n');

  const reversal = await makeOrder();
  reversal.items.forEach((i) => {
    i.fulfilment = 'cancelled';
    i.cancelledQuantity = i.orderedQuantity;
  });
  await reversal.save();
  const revRefunds = await refundService.createOrderRefunds(reversal._id, { reason: 'store_rejected' });
  await refundService.transitionRefund(revRefunds[0]._id, 'PROCESSING');
  await refundService.transitionRefund(revRefunds[0]._id, 'REFUNDED');
  await refundService.transitionRefund(revRefunds[0]._id, 'REVERSED');

  const activeAfter = await StoreRefund.aggregate([
    { $match: { order: reversal._id, status: { $ne: 'REVERSED' } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  ck('a reversed refund is excluded from the ceiling sum', activeAfter.length === 0 || activeAfter[0].total < 630, JSON.stringify(activeAfter));

  console.log('\n=== refund state machine ===\n');

  let illegalRefund = false;
  try {
    await refundService.transitionRefund(revRefunds[0]._id, 'PROCESSING');
  } catch (e) {
    illegalRefund = /ILLEGAL_REFUND_MOVE/.test(e.message || '');
  }
  ck('a REVERSED refund cannot re-enter PROCESSING', illegalRefund);

  const walk = await makeOrder();
  walk.items.forEach((i) => {
    i.fulfilment = 'cancelled';
    i.cancelledQuantity = i.orderedQuantity;
  });
  await walk.save();
  const walkRefunds = await refundService.createOrderRefunds(walk._id, { reason: 'store_rejected' });
  const target = walkRefunds[0];
  await refundService.transitionRefund(target._id, 'PROCESSING');
  const done = await refundService.transitionRefund(target._id, 'REFUNDED');
  ck('PENDING -> PROCESSING -> REFUNDED is accepted', done.status === 'REFUNDED', done.status);
  ck('the timeline records each step', done.timeline.length === 3, `len=${done.timeline.length}`);

  console.log('\n=== lifecycle side effects: paid, completed, cancelled ===\n');

  // `paid` records WHAT was paid and issues the invoice number. Both are money-bearing:
  // the refund gate reads `paidAmount`, and settlement pays out of collected amounts.
  const billable = await StoreOutlet.create({ chain: CHAIN, outletCode: 'ORD-' + STAMP, name: 'orders suite outlet' });
  outletIds.push(billable._id);

  const toPay = await makeOrder({
    outlet: billable._id,
    lifecycle: 'payment_pending',
    paymentStatus: 'pending',
    paidAmount: 0,
    invoiceNo: undefined,
    invoiceStatus: undefined,
  });
  const paidOrder = await orderService.transitionOrder(toPay._id, 'paid');
  ck('paid records paidAmount = grandTotal', Number(paidOrder.paidAmount) === Number(paidOrder.grandTotal),
    `${paidOrder.paidAmount} vs ${paidOrder.grandTotal}`);
  ck('paid sets paymentStatus', paidOrder.paymentStatus === 'paid', paidOrder.paymentStatus);
  ck('paid issues the invoice number (BR-43)', !!paidOrder.invoiceNo, paidOrder.invoiceNo);
  ck('the invoice is marked issued', paidOrder.invoiceStatus === 'issued', paidOrder.invoiceStatus);

  // A retried gateway callback must not consume a second number.
  const secondNo = paidOrder.invoiceNo;
  ck('a re-paid order cannot happen — the ladder has no self-edge',
    (() => { try { orderService.assertTransition('paid', 'paid'); return false; } catch (e) { return true; } })());

  // `cancelled` must hand reserved stock back, or an abandoned order strands inventory.
  const StoreStockReservation = mongoose.model('StoreStockReservation');
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const variantCancel = new mongoose.Types.ObjectId();
  const stockCancel = await StoreOutletStockItem.create({
    outlet: OUTLET, chain: CHAIN, variant: variantCancel, product: new mongoose.Types.ObjectId(),
    onHand: 10, reserved: 4, damaged: 0, availableQty: 6,
  });
  const toAbandon = await makeOrder({
    outlet: OUTLET,
    lifecycle: 'accepted',
    items: [{ product: new mongoose.Types.ObjectId(), variant: variantCancel, name: 'Line', quantity: 4, orderedQuantity: 4, fulfilledQuantity: 0, cancelledQuantity: 0, unitPrice: 10, lineTotal: 40, lineGrand: 40, fulfilment: 'pending' }],
    grandTotal: 40,
    paidAmount: 0,
    paymentStatus: 'pending',
  });
  await StoreStockReservation.create({
    outlet: OUTLET, chain: CHAIN, variant: variantCancel, product: new mongoose.Types.ObjectId(),
    order: toAbandon._id, quantity: 4, status: 'held',
  });
  await orderService.transitionOrder(toAbandon._id, 'cancelled');
  const afterCancelStock = await StoreOutletStockItem.findById(stockCancel._id).lean();
  ck('cancel releases the reservation back to availability', afterCancelStock.reserved === 0, `reserved=${afterCancelStock.reserved}`);
  ck('cancel restores availableQty', afterCancelStock.availableQty === 10, `availableQty=${afterCancelStock.availableQty}`);
  ck('cancel leaves onHand untouched', afterCancelStock.onHand === 10, `onHand=${afterCancelStock.onHand}`);
  ck('the released reservation row is marked released',
    (await StoreStockReservation.findOne({ order: toAbandon._id }).lean()).status === 'released');

  console.log('\n=== BR-43: cancel voids the invoice, never deletes it ===\n');

  const toCancel = await makeOrder();
  const cancelled = await orderService.cancelOrder(toCancel._id, { reason: 'out of stock', cancelledBy: 'store' });
  ck('the order reaches cancelled', cancelled.lifecycle === 'cancelled', cancelled.lifecycle);
  ck('the invoice is void, not removed', cancelled.invoiceStatus === 'void', cancelled.invoiceStatus);
  ck('the invoice number survives cancellation', !!cancelled.invoiceNo, cancelled.invoiceNo);
  const stillThere = await StoreOrder.findById(toCancel._id).select('invoiceNo invoiceStatus').lean();
  ck('the order document itself is never hard-deleted', !!stillThere);

  console.log('\n=== a paid cancellation refunds and records the attempt ===\n');

  const attempts = await StoreCancellationAttempt.countDocuments({ order: toCancel._id });
  ck('the cancellation attempt is logged (G3)', attempts === 1, `count=${attempts}`);
  const cancellation = await StoreCancellation.findOne({ order: toCancel._id }).lean();
  ck('a StoreCancellation record is written', !!cancellation);
  ck('it carries the resolved reason category', cancellation && !!cancellation.reasonCategory, cancellation && cancellation.reasonCategory);

  const cancelRefunds = await StoreRefund.find({ order: toCancel._id }).lean();
  ck('a paid cancellation raises refunds', cancelRefunds.length === 3, `count=${cancelRefunds.length}`);
  const afterCancel = await StoreOrder.findById(toCancel._id).lean();
  ck('the order rolls refundedAmount up', Number(afterCancel.refundedAmount) === 630, afterCancel.refundedAmount);
  ck('paymentStatus becomes refunded', afterCancel.paymentStatus === 'refunded', afterCancel.paymentStatus);
  ck('the refunded total never exceeds grandTotal', Number(afterCancel.refundedAmount) <= Number(afterCancel.grandTotal),
    `${afterCancel.refundedAmount} vs ${afterCancel.grandTotal}`);

  console.log('\n=== cancelling twice is refused ===\n');

  let reCancel = false;
  try {
    await orderService.cancelOrder(toCancel._id, { reason: 'again', cancelledBy: 'store' });
  } catch (e) {
    reCancel = /ILLEGAL_ORDER_MOVE/.test(e.message || '');
  }
  ck('a second cancellation is rejected by the transition table', reCancel);
};

run()
  .catch((e) => {
    failures += 1;
    console.log('\nSUITE ERROR: ' + (e && e.stack ? e.stack : e));
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      /* the run already failed; cleanup errors must not mask it */
    }
    await mongoose.disconnect();
    console.log('\n' + (failures === 0 ? 'ALL STORES ORDER CHECKS PASSED' : failures + ' STORES ORDER CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });