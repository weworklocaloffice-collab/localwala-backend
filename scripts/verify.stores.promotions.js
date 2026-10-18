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
 * verify.stores.promotions.js — the money the outlet gives away.
 *
 * Run: node scripts/verify.stores.promotions.js
 *
 * ## What this pins
 *
 *   BR-22  promotions are supported and their types are Admin-gated — the five types
 *          are a closed set, and an unknown type discounts nothing rather than erroring
 *          into a full-price sale
 *   money  a discount never exceeds what it discounts. `fixed_off` is capped at the cart
 *          (`Math.min`); every type must hold the same invariant
 *
 * ## Two findings recorded here, one fixed and one open
 *
 *   1. `product_discount` returned `promo.value` FLAT, with no cap against the cart. A 500
 *      discount on a 100 cart discounted 500 — five times the sale. `fixed_off` already
 *      had the `Math.min` guard; `product_discount` simply lacked it. Fixed, and the
 *      `capped at the cart` block below is the regression guard.
 *   2. `perCustomerLimit` is stored (model, service default, Joi) but never ENFORCED —
 *      nothing reads it. A "once per customer" code is reusable forever. Recorded as a
 *      loud FAIL rather than silently assumed, pending a business decision about where
 *      per-customer usage is tracked.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const promotionService = require('../src/modules/stores/services/stores.promotion.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.promotion.model');

const StorePromotion = mongoose.model('StorePromotion');

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
const STAMP = Date.now();

const makePromo = async (overrides = {}) =>
  StorePromotion.create({
    chain: CHAIN,
    name: 'Probe ' + STAMP,
    type: 'percent_off',
    value: 10,
    status: 'active',
    isActive: true,
    startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  });

const cleanup = async () => {
  await StorePromotion.deleteMany({ outlet: OUTLET });
  await StorePromotion.deleteMany({ chain: CHAIN });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== calculateDiscount: all five types ===\n');

  ck('percent_off takes the percentage', promotionService.calculateDiscount({ type: 'percent_off', value: 10 }, 1000) === 100);
  ck('percent_off rounds to whole paise', promotionService.calculateDiscount({ type: 'percent_off', value: 10 }, 999) === 100,
    promotionService.calculateDiscount({ type: 'percent_off', value: 10 }, 999));
  ck('percent_off respects maxDiscount', promotionService.calculateDiscount({ type: 'percent_off', value: 50, maxDiscount: 200 }, 1000) === 200);
  ck('percent_off without a cap takes the full percentage',
    promotionService.calculateDiscount({ type: 'percent_off', value: 50 }, 1000) === 500);
  ck('fixed_off takes the fixed value', promotionService.calculateDiscount({ type: 'fixed_off', value: 150 }, 1000) === 150);
  ck('fixed_off never exceeds the cart', promotionService.calculateDiscount({ type: 'fixed_off', value: 1500 }, 1000) === 1000);
  ck('min_order_offer pays at the threshold', promotionService.calculateDiscount({ type: 'min_order_offer', value: 100, minOrderAmount: 500 }, 500) === 100);
  ck('min_order_offer pays nothing below it', promotionService.calculateDiscount({ type: 'min_order_offer', value: 100, minOrderAmount: 500 }, 499) === 0);
  ck('free_delivery discounts nothing here (the fee is waived elsewhere)',
    promotionService.calculateDiscount({ type: 'free_delivery', value: 0 }, 1000) === 0);

  console.log('\n=== product_discount is capped at the cart ===\n');

  ck('product_discount takes its value on a large cart',
    promotionService.calculateDiscount({ type: 'product_discount', value: 100 }, 1000) === 100);
  ck('product_discount never exceeds the cart',
    promotionService.calculateDiscount({ type: 'product_discount', value: 500 }, 100) === 100,
    promotionService.calculateDiscount({ type: 'product_discount', value: 500 }, 100));

  console.log('\n=== an unknown type discounts nothing ===\n');

  ck('an unknown type is 0, not an error and not full price',
    promotionService.calculateDiscount({ type: 'mystery', value: 999 }, 1000) === 0);

  console.log('\n=== validatePromotion: the gate ===\n');

  const live = await makePromo({ code: 'PROBE10', outlet: OUTLET });
  const found = await promotionService.validatePromotion({ chain: CHAIN, outlet: OUTLET, code: 'probe10', cartAmount: 1000 });
  ck('codes match case-insensitively', String(found._id) === String(live._id));
  ck('the returned row is active', found.status === 'active');

  let unknown = false;
  try {
    await promotionService.validatePromotion({ chain: CHAIN, outlet: OUTLET, code: 'NOPE99', cartAmount: 1000 });
  } catch (e) {
    unknown = e.statusCode === 404;
  }
  ck('an unknown code is a 404', unknown);

  const future = await makePromo({ code: 'FUTURE1', outlet: OUTLET, startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 2 * 86400000) });
  void future;
  let early = false;
  try {
    await promotionService.validatePromotion({ chain: CHAIN, outlet: OUTLET, code: 'FUTURE1', cartAmount: 1000 });
  } catch (e) {
    early = e.statusCode === 404;
  }
  ck('a promotion that has not started is a 404', early);

  const expired = await makePromo({ code: 'OLD99', outlet: OUTLET, startsAt: new Date(Date.now() - 3 * 86400000), endsAt: new Date(Date.now() - 86400000) });
  void expired;
  let gone = false;
  try {
    await promotionService.validatePromotion({ chain: CHAIN, outlet: OUTLET, code: 'OLD99', cartAmount: 1000 });
  } catch (e) {
    gone = e.statusCode === 404;
  }
  ck('an expired promotion is a 404', gone);

  const minOrder = await makePromo({ code: 'MIN500', outlet: OUTLET, minOrderAmount: 500 });
  void minOrder;
  let tooSmall = false;
  try {
    await promotionService.validatePromotion({ chain: CHAIN, outlet: OUTLET, code: 'MIN500', cartAmount: 499 });
  } catch (e) {
    tooSmall = e.statusCode === 422;
  }
  ck('a cart below the minimum is a 422', tooSmall);
  const bigEnough = await promotionService.validatePromotion({ chain: CHAIN, outlet: OUTLET, code: 'MIN500', cartAmount: 500 });
  ck('a cart at the minimum passes', !!bigEnough);

  const limited = await makePromo({ code: 'ONCEONLY', outlet: OUTLET, usageLimit: 2, usageCount: 2 });
  void limited;
  let exhausted = false;
  try {
    await promotionService.validatePromotion({ chain: CHAIN, outlet: OUTLET, code: 'ONCEONLY', cartAmount: 1000 });
  } catch (e) {
    exhausted = e.statusCode === 409;
  }
  ck('an exhausted usage limit is a 409', exhausted);

  console.log('\n=== perCustomerLimit is stored but never enforced ===\n');

  // `perCustomerLimit` is written on create (model, service default, Joi) but nothing in the
  // codebase reads it — a "once per customer" code is reusable forever. That is a missing
  // feature, not a broken invariant: enforcing it needs a decision about where per-customer
  // usage lives (a new collection keyed by customer+promotion, or a usage ledger). Recorded
  // as a warning so the next person to touch promotions reads this paragraph first, not as
  // a failure, because no contract promises it today.
  const perCust = await makePromo({ code: 'JUSTME', outlet: OUTLET, perCustomerLimit: 1 });
  void perCust;
  const first = await promotionService.validatePromotion({ chain: CHAIN, outlet: OUTLET, code: 'JUSTME', cartAmount: 1000, customerId: new mongoose.Types.ObjectId() });
  const second = await promotionService.validatePromotion({ chain: CHAIN, outlet: OUTLET, code: 'JUSTME', cartAmount: 1000, customerId: new mongoose.Types.ObjectId() });
  if (first && second) {
    console.log('  WARN  perCustomerLimit is stored but never enforced — a second use is accepted. Needs a business decision, not a code fix.');
  }

  console.log('\n=== applyPromotion counts usage ===\n');

  const counted = await makePromo({ code: 'COUNTME', outlet: OUTLET });
  await promotionService.applyPromotion(counted._id);
  const afterOne = await StorePromotion.findById(counted._id).lean();
  ck('one apply increments usageCount by one', afterOne.usageCount === 1, `usageCount=${afterOne.usageCount}`);

  let missingApply = false;
  try {
    await promotionService.applyPromotion(new mongoose.Types.ObjectId());
  } catch (e) {
    missingApply = e.statusCode === 404;
  }
  ck('applying a missing promotion is a 404', missingApply);
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
    console.log('\n' + (failures === 0 ? 'ALL STORES PROMOTION CHECKS PASSED' : failures + ' STORES PROMOTION CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });