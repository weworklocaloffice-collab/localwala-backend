/**
 * LocalWala �?" Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Ac 2026 WeWorkLocal Private Limited
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
 * verify.stores.coupons.js �?" the coupon and favourite contracts, without a database.
 *
 * Run: node scripts/verify.stores.coupons.js
 *
 * The DB suites cannot run while Mongo authentication fails; these checks pin the parts
 * that are pure or schema-level, so a wrong model/ref/discount cannot ship unnoticed.
 */

const assert = require('assert');
const mongoose = require('mongoose');
require('../src/models');

const couponService = require('../src/modules/stores/services/stores.coupon.service');
const favouriteService = require('../src/modules/stores/services/stores.favourite.service');

let failures = 0;
const ck = (label, fn) => {
  try {
    fn();
    console.log('  PASS  ' + label);
  } catch (error) {
    failures += 1;
    console.log('  FAIL  ' + label + ' -> ' + error.message);
  }
};

console.log('\n=== coupon discount arithmetic ===\n');
ck('percent_off rounds to the paise', () => {
  assert.strictEqual(couponService.calculateDiscount({ type: 'percent_off', value: 10 }, 500), 50);
});
ck('percent_off respects maxDiscount', () => {
  assert.strictEqual(
    couponService.calculateDiscount({ type: 'percent_off', value: 50, maxDiscount: 100 }, 500),
    100
  );
});
ck('percent_off never exceeds the cart', () => {
  assert.strictEqual(couponService.calculateDiscount({ type: 'percent_off', value: 500 }, 500), 500);
});
ck('fixed_off is capped at the cart', () => {
  assert.strictEqual(couponService.calculateDiscount({ type: 'fixed_off', value: 800 }, 500), 500);
});
ck('free_delivery yields no line discount', () => {
  assert.strictEqual(couponService.calculateDiscount({ type: 'free_delivery', value: 99 }, 500), 0);
});
ck('a missing coupon discounts nothing', () => {
  assert.strictEqual(couponService.calculateDiscount(null, 500), 0);
});

console.log('\n=== schema fields the services write ===\n');
const StoreCoupon = mongoose.model('StoreCoupon');
ck('StoreCoupon has code and a redemption ledger', () => {
  for (const path of ['chain', 'outlet', 'code', 'type', 'value', 'maxDiscount', 'minOrderAmount', 'usageLimit', 'usedCount', 'perCustomerLimit', 'startsAt', 'endsAt', 'status']) {
    assert.ok(StoreCoupon.schema.path(path), `missing ${path}`);
  }
});
ck('a code is unique per chain', () => {
  const index = StoreCoupon.schema.indexes().find(([fields]) => fields.chain === 1 && fields.code === 1);
  assert.ok(index, 'compound chain+code index missing');
  assert.strictEqual(index[1].unique, true);
});

const StoreFavourite = mongoose.model('StoreFavourite');
ck('StoreFavourite is customer + chain', () => {
  assert.ok(StoreFavourite.schema.path('customer'));
  assert.ok(StoreFavourite.schema.path('chain'));
});
ck('a favourite is unique per customer and chain', () => {
  const index = StoreFavourite.schema.indexes().find(([fields]) => fields.customer === 1 && fields.chain === 1);
  assert.ok(index, 'compound customer+chain index missing');
  assert.strictEqual(index[1].unique, true);
});

const StoreOrder = mongoose.model('StoreOrder');
ck('the order coupon ref points at StoreCoupon, not the food Coupon', () => {
  assert.strictEqual(StoreOrder.schema.path('coupon.coupon').options.ref, 'StoreCoupon');
});

const StorePromotion = mongoose.model('StorePromotion');
ck('promotion has stackable/priority', () => {
  assert.ok(StorePromotion.schema.path('stackable'));
  assert.ok(StorePromotion.schema.path('priority'));
});
ck('promotion approval survives Mongoose strict', () => {
  for (const path of ['approval.status', 'approval.by', 'approval.at', 'approval.note']) {
    assert.ok(StorePromotion.schema.path(path), `missing ${path}`);
  }
});

console.log('\n=== the services export what their controllers call ===\n');
ck('coupon service exports its full surface', () => {
  for (const name of ['validateCoupon', 'calculateDiscount', 'applyCoupon', 'createCoupon', 'listCoupons', 'listActiveCoupons']) {
    assert.strictEqual(typeof couponService[name], 'function', `missing ${name}`);
  }
});
ck('favourite service exports its full surface', () => {
  for (const name of ['addFavourite', 'removeFavourite', 'isFavourite', 'listFavourites']) {
    assert.strictEqual(typeof favouriteService[name], 'function', `missing ${name}`);
  }
});

if (failures) {
  console.error(`\n${failures} STORES COUPON/FAVOURITE CHECK(S) FAILED\n`);
  process.exit(1);
}

console.log('\nALL STORES COUPON/FAVOURITE CHECKS PASSED\n');
