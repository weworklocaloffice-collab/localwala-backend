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
 * verify.stores.picking.js — the counter: what was actually put in the bag.
 *
 * Run: node scripts/verify.stores.picking.js
 *
 * ## What this pins
 *
 *   BR-31  no silent substitution — `substituted` demands BOTH the chosen substitute and
 *          a mandatory note, and the service 422s without them
 *   §pick  the pick list is outlet-scoped (a partner never reads another outlet's list),
 *          carries shelf + availability per line, and starts every line at pending
 *   §pick  pickedQuantity can never exceed the ordered quantity (422)
 *   §pick  packing stamps the package record
 *   §pick  partial fulfilment reduces the charge to what was actually fulfilled — and a
 *          basket reduced below the outlet minimum refunds the delivery fee
 *
 * ## One arithmetic worth reading twice
 *
 * `calculatePartialFulfilment` sums `fulfilledQuantity x unitPrice` over non-cancelled
 * lines — pre-tax, pre-discount. That is a business choice about what "the reduced
 * basket" means (the shelf value of what left the store), and this suite pins the exact
 * numbers so nobody changes it thinking it is a bug. If the business instead means
 * "what the customer should have paid for what they got", the tax/discount handling lives
 * here and only here.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const pickingService = require('../src/modules/stores/services/stores.picking.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.order.model');
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/store.outlet.stock.item.model');
require('../src/modules/stores/models/chain.product.model');
require('../src/modules/stores/models/chain.product.variant.model');

const StoreOrder = mongoose.model('StoreOrder');
const StoreOutlet = mongoose.model('StoreOutlet');
const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');

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
const OTHER_OUTLET = new mongoose.Types.ObjectId();
const CHAIN = new mongoose.Types.ObjectId();
const VARIANT_A = new mongoose.Types.ObjectId();
const VARIANT_B = new mongoose.Types.ObjectId();
const STAMP = Date.now();

let orderNoSeq = 0;

const makeOrder = async (overrides = {}) =>
  StoreOrder.create({
    orderNo: 980000 + (orderNoSeq += 1) + (STAMP % 1000),
    customer: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        variant: VARIANT_A,
        name: 'Line A',
        quantity: 3,
        orderedQuantity: 3,
        fulfilledQuantity: 0,
        cancelledQuantity: 0,
        unitPrice: 100,
        discountAmount: 0,
        lineTotal: 300,
        lineGrand: 354,
        fulfilment: 'pending',
      },
      {
        product: new mongoose.Types.ObjectId(),
        variant: VARIANT_B,
        name: 'Line B',
        quantity: 1,
        orderedQuantity: 1,
        fulfilledQuantity: 0,
        cancelledQuantity: 0,
        unitPrice: 200,
        discountAmount: 0,
        lineTotal: 200,
        lineGrand: 236,
        fulfilment: 'pending',
      },
    ],
    itemsSubtotal: 500,
    deliveryFee: 40,
    grandTotal: 630,
    paymentMode: 'gateway',
    paymentStatus: 'paid',
    paidAmount: 630,
    lifecycle: 'accepted',
    ...overrides,
  });

const cleanup = async () => {
  await StoreOrder.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
  await StoreOutletStockItem.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
  await StoreOutlet.deleteMany({ _id: { $in: [OUTLET, OTHER_OUTLET] } });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== the pick list is outlet-scoped ===\n');

  await StoreOutlet.create({ _id: OUTLET, chain: CHAIN, outletCode: 'PICK-' + STAMP, name: 'pick suite' });
  const order = await makeOrder();
  await StoreOutletStockItem.create({
    outlet: OUTLET, chain: CHAIN, variant: VARIANT_A, product: new mongoose.Types.ObjectId(),
    onHand: 50, reserved: 0, damaged: 0, availableQty: 50, shelfLocation: 'A-01',
  });

  const list = await pickingService.getPickList(order._id, { outlet: OUTLET });
  ck('the pick list has one row per line', list.length === 2, `rows=${list.length}`);
  ck('every row starts pending', list.every((r) => r.status === 'pending'));
  const rowA = list.find((r) => String(r.variant) === String(VARIANT_A));
  ck('a row carries the shelf location', rowA.shelfLocation === 'A-01', rowA.shelfLocation);
  ck('a row carries live availability', rowA.availableQty === 50, rowA.availableQty);
  ck('a row without stock reports zero, not null',
    list.find((r) => String(r.variant) === String(VARIANT_B)).availableQty === 0);

  let crossOutlet = false;
  try {
    await pickingService.getPickList(order._id, { outlet: OTHER_OUTLET });
  } catch (e) {
    crossOutlet = e.statusCode === 404;
  }
  ck('another outlet cannot read this pick list', crossOutlet);

  let missing = false;
  try {
    await pickingService.getPickList(new mongoose.Types.ObjectId(), { outlet: OUTLET });
  } catch (e) {
    missing = e.statusCode === 404;
  }
  ck('a missing order is a 404', missing);

  console.log('\n=== pickItem records the decision ===\n');

  const picked = await pickingService.pickItem({
    orderId: order._id, outlet: OUTLET, variant: VARIANT_A, pickedQuantity: 3, status: 'picked',
  });
  const lineA = picked.items.find((i) => String(i.variant) === String(VARIANT_A));
  ck('a full pick records fulfilledQuantity', lineA.fulfilledQuantity === 3, lineA.fulfilledQuantity);
  ck('a full pick marks the line picked', lineA.fulfilment === 'picked', lineA.fulfilment);
  ck('the pick is journalled onto the order', (picked.picking.items || []).length === 1);
  ck('the journal carries the variant and quantity',
    picked.picking.items[0].pickedQuantity === 3 && String(picked.picking.items[0].item) === String(VARIANT_A));

  const partial = await pickingService.pickItem({
    orderId: order._id, outlet: OUTLET, variant: VARIANT_B, pickedQuantity: 0, status: 'unavailable',
    resolution: 'remove',
  });
  const lineB = partial.items.find((i) => String(i.variant) === String(VARIANT_B));
  ck('an unavailable line records zero fulfilled', lineB.fulfilledQuantity === 0);
  ck('an unavailable line is marked unavailable', lineB.fulfilment === 'unavailable', lineB.fulfilment);

  console.log('\n=== the guards ===\n');

  let tooMany = false;
  try {
    await pickingService.pickItem({ orderId: order._id, outlet: OUTLET, variant: VARIANT_A, pickedQuantity: 99, status: 'picked' });
  } catch (e) {
    tooMany = e.statusCode === 422 && /PICKED_QUANTITY_EXCEEDS_ORDER/.test(e.message);
  }
  ck('picking more than ordered is a 422', tooMany);

  let noLine = false;
  try {
    await pickingService.pickItem({ orderId: order._id, outlet: OUTLET, variant: new mongoose.Types.ObjectId(), pickedQuantity: 1, status: 'picked' });
  } catch (e) {
    noLine = e.statusCode === 404;
  }
  ck('picking a variant not on the order is a 404', noLine);

  let crossPick = false;
  try {
    await pickingService.pickItem({ orderId: order._id, outlet: OTHER_OUTLET, variant: VARIANT_A, pickedQuantity: 1, status: 'picked' });
  } catch (e) {
    crossPick = e.statusCode === 404;
  }
  ck('picking through another outlet is a 404', crossPick);

  console.log('\n=== BR-31: substitution is recorded or refused ===\n');

  const subVariant = new mongoose.Types.ObjectId();
  let bare = false;
  try {
    await pickingService.pickItem({ orderId: order._id, outlet: OUTLET, variant: VARIANT_A, pickedQuantity: 3, status: 'substituted' });
  } catch (e) {
    bare = e.statusCode === 422 && /SUBSTITUTION_REQUIRES_VARIANT_AND_NOTE/.test(e.message);
  }
  ck('a substitution without variant and note is refused', bare);

  let halfBare = false;
  try {
    await pickingService.pickItem({
      orderId: order._id, outlet: OUTLET, variant: VARIANT_A, pickedQuantity: 3,
      status: 'substituted', substituteVariant: subVariant,
    });
  } catch (e) {
    halfBare = e.statusCode === 422;
  }
  ck('a substitution with a variant but no note is refused', halfBare);

  const subbed = await pickingService.pickItem({
    orderId: order._id, outlet: OUTLET, variant: VARIANT_A, pickedQuantity: 3,
    status: 'substituted', substituteVariant: subVariant, note: 'M out of stock, customer accepted L on call',
  });
  const subLine = subbed.items.find((i) => String(i.variant) === String(VARIANT_A));
  ck('a documented substitution is accepted', subLine.fulfilment === 'substituted', subLine.fulfilment);
  ck('the substitute variant is recorded', String(subLine.substituteVariant) === String(subVariant));
  ck('the note is recorded', !!subLine.resolutionNote);

  console.log('\n=== completePacking stamps the package ===\n');

  const packed = await pickingService.completePacking({
    orderId: order._id, outlet: OUTLET, packageCount: 2, totalWeightGrams: 1500, fragile: true,
    specialHandling: 'this side up', note: 'two boxes',
  });
  ck('packing records the package count', packed.packing.packageCount === 2, packed.packing.packageCount);
  ck('packing records the weight', packed.packing.totalWeightGrams === 1500);
  ck('packing records fragility', packed.packing.fragile === true);
  ck('packing is timestamped', !!packed.packing.completedAt);

  console.log('\n=== partial fulfilment economics ===\n');

  // Line A: 3 x 100 fulfilled. Line B: unavailable. Reduced basket = 300, above any minimum.
  const full = await pickingService.calculatePartialFulfilment(order._id, { outlet: OUTLET });
  ck('a fulfilled basket charges in full plus the fee', full.action === 'charge_full' && full.amount === 340,
    `${full.action} ${full.amount}`);

  const cancelledLine = await StoreOrder.findById(order._id);
  cancelledLine.items.find((i) => String(i.variant) === String(VARIANT_B)).fulfilment = 'cancelled';
  await cancelledLine.save();
  const stillFull = await pickingService.calculatePartialFulfilment(order._id, { outlet: OUTLET });
  ck('a cancelled line contributes nothing', stillFull.amount === 340, stillFull.amount);

  // Drop the outlet minimum above the reduced basket: fee comes back.
  await StoreOutlet.updateOne({ _id: OUTLET }, { 'deliveryConfig.minimumOrder': 10000 });
  const belowMin = await pickingService.calculatePartialFulfilment(order._id, { outlet: OUTLET });
  ck('below the outlet minimum the delivery fee is refunded', belowMin.action === 'charge_only' && belowMin.deliveryFeeRefunded === true,
    `${belowMin.action} ${belowMin.amount}`);
  ck('and the customer is charged only the reduced basket', belowMin.amount === 300, belowMin.amount);

  const empty = await makeOrder({ outlet: OTHER_OUTLET });
  await StoreOutlet.create({ _id: OTHER_OUTLET, chain: CHAIN, outletCode: 'PICK2-' + STAMP, name: 'empty' });
  const nothingDone = await StoreOrder.findByIdAndUpdate(empty._id,
    { $set: { 'items.$[].fulfilledQuantity': 0, 'items.$[].fulfilment': 'cancelled' } }, { new: true });
  void nothingDone;
  const cancelAction = await pickingService.calculatePartialFulfilment(empty._id, { outlet: OTHER_OUTLET });
  ck('nothing fulfilled means cancel, not charge', cancelAction.action === 'cancel', cancelAction.action);
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
    console.log('\n' + (failures === 0 ? 'ALL STORES PICKING CHECKS PASSED' : failures + ' STORES PICKING CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });