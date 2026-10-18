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
 * verify.stores.returns.js — the post-sale cycle.
 *
 * Run: node scripts/verify.stores.returns.js
 *
 * ## What this pins
 *
 *   BR-19  returns run requested -> approved -> picked_up -> received -> refunded, and
 *          a refund cannot be paid before the goods are actually back at the outlet
 *   BR-20  exchanges follow the same ladder but end in `exchanged`, and an exchange with
 *          a price difference demands payment rather than silently absorbing it
 *   BR-25  nothing here deletes; a rejected request stays readable as history
 *   §5.11  the returned units come back into stock under the RETURNED movement type
 *
 * ## The regression this suite exists to stop
 *
 * `processReturnRefund` restocks through `inventoryService.adjustStock({ type: 'RETURNED' })`,
 * but `adjustStock` had no RETURNED case and fell through to
 * `throw Unknown movement type: RETURNED`. Every return refund 500'd at its last step AND
 * the returned units never rejoined inventory — two failures from one missing branch. The
 * "returned units come back" block below is the guard.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const returnService = require('../src/modules/stores/services/stores.return.service');
const inventoryService = require('../src/modules/stores/services/stores.inventory.service');

require('../src/modules/stores/models/store.return.request.model');
require('../src/modules/stores/models/store.exchange.request.model');
require('../src/modules/stores/models/store.outlet.stock.item.model');
require('../src/modules/stores/models/store.stock.reservation.model');
require('../src/modules/stores/models/store.inventory.movement.model');
require('../src/modules/stores/models/chain.product.model');
require('../src/modules/stores/models/chain.product.variant.model');

const StoreReturnRequest = mongoose.model('StoreReturnRequest');
const StoreExchangeRequest = mongoose.model('StoreExchangeRequest');
const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
const StoreInventoryMovement = mongoose.model('StoreInventoryMovement');

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
const VARIANT = new mongoose.Types.ObjectId();
const PRODUCT = new mongoose.Types.ObjectId();

const returnItems = (refundAmount = 100, qty = 1, priceDifference = 0) => [
  {
    product: PRODUCT,
    variant: VARIANT,
    name: 'Returned shirt',
    quantity: qty,
    unitPrice: refundAmount,
    refundAmount,
    priceDifference,
    reason: 'wrong size',
  },
];

const exchangeItem = (priceDifference) => ({
  product: PRODUCT,
  variant: VARIANT,
  name: 'Returned shirt',
  quantity: 1,
  unitPrice: 100,
  refundAmount: 0,
  priceDifference,
  reason: 'wrong size',
  originalProduct: PRODUCT,
  originalVariant: VARIANT,
  originalName: 'Returned shirt',
  exchangeForProduct: PRODUCT,
  exchangeForVariant: VARIANT,
  exchangeForName: 'Replacement shirt',
});

const cleanup = async () => {
  await StoreReturnRequest.deleteMany({ outlet: OUTLET });
  await StoreExchangeRequest.deleteMany({ outlet: OUTLET });
  await StoreInventoryMovement.deleteMany({ outlet: OUTLET });
  await StoreOutletStockItem.deleteMany({ outlet: OUTLET });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== the return transition table ===\n');

  let allLegal = true;
  for (const [from, allowed] of Object.entries(returnService.RETURN_TRANSITIONS)) {
    for (const to of allowed) {
      try {
        returnService.assertTransition(from, to, 'return');
      } catch (e) {
        allLegal = false;
        ck(`${from} -> ${to} allowed`, false, e.message);
      }
    }
  }
  ck('every permitted return transition is accepted', allLegal);

  const illegal = [
    ['requested', 'refunded'],
    ['requested', 'received'],
    ['approved', 'refunded'],
    ['received', 'approved'],
    ['refunded', 'received'],
    ['rejected', 'approved'],
  ];
  for (const [from, to] of illegal) {
    let msg = '';
    try {
      returnService.assertTransition(from, to, 'return');
    } catch (e) {
      msg = e.message || '';
    }
    ck(`${from} -> ${to} is rejected`, /ILLEGAL_RETURN_MOVE/.test(msg), msg);
  }

  console.log('\n=== the return happy path (BR-19) ===\n');

  const req = await returnService.createReturnRequest({
    order: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    customer: CUSTOMER,
    items: returnItems(100, 2),
    reason: 'wrong size',
    reasonCategory: 'wrong_item',
  });
  ck('a request starts as requested', req.status === 'requested', req.status);
  ck('the refund total is summed from the items', Number(req.totalRefundAmount) === 100, req.totalRefundAmount);

  const approved = await returnService.transitionReturn(req._id, 'approved', { actor: new mongoose.Types.ObjectId() });
  ck('requested -> approved', approved.status === 'approved', approved.status);
  ck('the approval is stamped', !!approved.approvedAt && !!approved.approvedBy);

  console.log('\n=== a refund cannot be paid before the goods are back ===\n');

  // The request is deliberately left at `approved` here: paying a refund while the
  // customer still holds the goods is the failure this guards.
  let earlyRefund = false;
  try {
    await returnService.processReturnRefund(req._id, { refundReference: 'R-early-' + Date.now() });
  } catch (e) {
    earlyRefund = e.statusCode === 409 && /received before refund/i.test(e.message);
  }
  ck('refunding an approved-but-unreceived return is refused', earlyRefund);

  await returnService.transitionReturn(req._id, 'picked_up');
  const received = await returnService.transitionReturn(req._id, 'received');
  ck('the ladder runs through to received', received.status === 'received', received.status);
  ck('the received timestamp is stamped', !!received.receivedAt);

  console.log('\n=== returned units come back into stock ===\n');

  const stockBefore = await inventoryService.adjustStock({
    outlet: OUTLET, chain: CHAIN, variant: VARIANT, product: PRODUCT, type: 'STOCK_ADDED', quantity: 10,
  });
  ck('the variant has stock to return against', Number(stockBefore.onHand) === 10, stockBefore.onHand);

  const refunded = await returnService.processReturnRefund(req._id, { refundReference: 'R-' + Date.now() });
  ck('the return reaches refunded', refunded.status === 'refunded', refunded.status);

  const after = await StoreOutletStockItem.findOne({ outlet: OUTLET, variant: VARIANT }).lean();
  ck('the returned quantity is back on hand', Number(after.onHand) === 12, `onHand=${after.onHand}`);
  ck('availability rises with it', Number(after.availableQty) === 12, `availableQty=${after.availableQty}`);

  const returnMovements = await StoreInventoryMovement.find({ outlet: OUTLET, type: 'RETURNED' }).lean();
  ck('the ledger records a RETURNED movement', returnMovements.length === 1, `count=${returnMovements.length}`);
  ck('the movement carries the returned quantity', Number(returnMovements[0].qtyDelta) === 2, returnMovements[0].qtyDelta);
  ck('the movement references the return', String(returnMovements[0].referenceId) === String(req._id));
  ck('the movement is typed as a return, not a stock delivery',
    returnMovements[0].referenceType === 'return', returnMovements[0].referenceType);

  console.log('\n=== BR-25: a rejected return is history, not a deletion ===\n');

  const rejected = await returnService.createReturnRequest({
    order: new mongoose.Types.ObjectId(), outlet: OUTLET, chain: CHAIN, customer: CUSTOMER,
    items: returnItems(50), reason: 'changed mind', reasonCategory: 'changed_mind',
  });
  await returnService.transitionReturn(rejected._id, 'rejected', { notes: 'outside the window' });
  const stillReadable = await StoreReturnRequest.findById(rejected._id).lean();
  ck('the rejected return still exists', !!stillReadable);
  ck('it records the rejection reason', stillReadable.rejectionReason === 'outside the window', stillReadable.rejectionReason);
  ck('it is terminal — no moves out of rejected', stillReadable.status === 'rejected');

  console.log('\n=== BR-20: exchanges end in exchanged, not refunded ===\n');

  let allExchangeLegal = true;
  for (const [from, allowed] of Object.entries(returnService.EXCHANGE_TRANSITIONS)) {
    for (const to of allowed) {
      try {
        returnService.assertTransition(from, to, 'exchange');
      } catch (e) {
        allExchangeLegal = false;
        ck(`exchange ${from} -> ${to} allowed`, false, e.message);
      }
    }
  }
  ck('every permitted exchange transition is accepted', allExchangeLegal);

  const samePrice = await returnService.createExchangeRequest({
    order: new mongoose.Types.ObjectId(), outlet: OUTLET, chain: CHAIN, customer: CUSTOMER,
    items: [exchangeItem(0)], reason: 'wrong size', reasonCategory: 'wrong_item',
  });
  ck('an even exchange requires no payment', samePrice.paymentRequired === false, samePrice.paymentRequired);
  ck('and records paymentStatus not_required', samePrice.paymentStatus === 'not_required', samePrice.paymentStatus);

  const pricier = await returnService.createExchangeRequest({
    order: new mongoose.Types.ObjectId(), outlet: OUTLET, chain: CHAIN, customer: CUSTOMER,
    items: [exchangeItem(250)],
    reason: 'upgrading', reasonCategory: 'wrong_item',
  });
  ck('a pricier exchange requires payment', pricier.paymentRequired === true, pricier.paymentRequired);
  ck('the payment amount is the price difference', Number(pricier.paymentAmount) === 250, pricier.paymentAmount);
  ck('payment starts pending', pricier.paymentStatus === 'pending', pricier.paymentStatus);

  await returnService.transitionExchange(pricier._id, 'approved');
  await returnService.transitionExchange(pricier._id, 'picked_up');
  await returnService.transitionExchange(pricier._id, 'received');
  const exchanged = await returnService.transitionExchange(pricier._id, 'exchanged');
  ck('an exchange ends in exchanged', exchanged.status === 'exchanged', exchanged.status);
  ck('an exchange cannot end in refunded', returnService.EXCHANGE_TRANSITIONS.received.includes('refunded') === false);
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
    console.log('\n' + (failures === 0 ? 'ALL STORES RETURN CHECKS PASSED' : failures + ' STORES RETURN CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });
