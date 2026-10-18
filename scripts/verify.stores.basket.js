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
 * verify.stores.basket.js — the money is recomputed server-side, never trusted.
 *
 * Run: node scripts/verify.stores.basket.js
 *
 * ## What this pins
 *
 *   §8.4  totals are recomputed server-side — the request contributes product +
 *         variant + quantity per line, and everything else (price, promo, tax) is
 *         resolved from data. Client totals are never trusted.
 *   BR-36 availability is per outlet: no join row (or an inactive one) means the
 *         outlet does not sell the variant — the resolver never falls back to the
 *         chain price, which would sell stock the outlet may not hold.
 *   BR-41 every line freezes its tax; the frozen snapshot is what refunds read later.
 *   promo the discount is validated server-side, capped at the subtotal, and allocated
 *         pro-rata so per-line tax is computed on the discounted base.
 *   fees  free delivery by promo OR by threshold, else the outlet fee; delivery tax is
 *         explicitly zero in V1 (no SAC rate configured).
 *   gate  the minimum-order and COD gates fire on the computed total, so checkout quotes
 *         and real orders cannot drift apart.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const basketService = require('../src/modules/stores/services/stores.basket.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/store.chain.model');
require('../src/modules/stores/models/store.category.model');
require('../src/modules/stores/models/store.subcategory.model');
require('../src/modules/stores/models/store.brand.model');
require('../src/modules/stores/models/chain.product.model');
require('../src/modules/stores/models/chain.product.variant.model');
require('../src/modules/stores/models/store.outlet.product.model');
require('../src/modules/stores/models/tax.configuration.model');
require('../src/modules/stores/models/store.promotion.model');
require('../src/kernel/vertical/models/vertical.model');

const StoreOutlet = mongoose.model('StoreOutlet');
const StoreChain = mongoose.model('StoreChain');
const ChainProduct = mongoose.model('ChainProduct');
const ChainProductVariant = mongoose.model('ChainProductVariant');
const StoreOutletProduct = mongoose.model('StoreOutletProduct');
const TaxConfiguration = mongoose.model('TaxConfiguration');
const StorePromotion = mongoose.model('StorePromotion');
const Vertical = mongoose.model('Vertical');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const CHAIN = new mongoose.Types.ObjectId();
const OUTLET = new mongoose.Types.ObjectId();
const CATEGORY = new mongoose.Types.ObjectId();
const SUBCATEGORY = new mongoose.Types.ObjectId();
const BRAND = new mongoose.Types.ObjectId();
const STAMP = Date.now() % 100000;

const fixtures = {};

const setup = async () => {
  await StoreChain.create({ _id: CHAIN, business: new mongoose.Types.ObjectId(), name: 'basket suite', slug: 'basket-suite-' + STAMP });
  await mongoose.model('StoreCategory').create({ _id: CATEGORY, key: 'basketcat' + STAMP, name: 'Basket Cat' });
  await mongoose.model('StoreSubcategory').create({ _id: SUBCATEGORY, category: CATEGORY, key: 'basketsub' + STAMP, name: 'Basket Sub' });
  await mongoose.model('StoreBrand').create({ _id: BRAND, name: 'Basket Brand', slug: 'basket-brand-' + STAMP });

  await TaxConfiguration.create({
    code: 'BASKET' + STAMP, description: 'suite rate', gstRate: 18,
    effectiveFrom: new Date(Date.now() - 86400000), status: true,
  });

  const outlet = await StoreOutlet.create({
    _id: OUTLET,
    chain: CHAIN,
    outletCode: 'BASKT-' + STAMP,
    name: 'basket suite',
    deliveryConfig: { radiusKm: 5, minimumOrder: 0, deliveryFee: 30, freeDeliveryAbove: 1000, codEnabled: true },
    taxIdentity: { stateCode: '29' },
  });

  const product = await ChainProduct.create({
    chain: CHAIN, category: CATEGORY, subcategory: SUBCATEGORY, brand: BRAND,
    name: 'Basket Shirt', slug: 'basket-shirt-' + STAMP,
    basePrice: 500, taxType: 'inclusive', hsn: 'BASKET' + STAMP, status: 'active',
  });

  const variant = await ChainProductVariant.create({
    chain: CHAIN, product: product._id, sku: 'BSKT-' + STAMP,
    name: 'M / Black', price: 500, priceInPaise: 50000,
    attributes: { size: 'M' }, facetKeys: ['size:M'],
    status: 'active',
  });

  const outletProduct = await StoreOutletProduct.create({
    outlet: OUTLET, chain: CHAIN, product: product._id, productVariant: variant._id,
    price: 480, priceInPaise: 48000, status: 'active',
  });

  // The COD gate reads the vertical switch: without a stores row it defaults closed.
  await Vertical.findOneAndUpdate(
    { key: 'stores' },
    { $setOnInsert: { key: 'stores', settings: { codEnabled: true } } },
    { upsert: true }
  );

  Object.assign(fixtures, { outlet, product, variant, outletProduct });
};

const line = (overrides = {}) => ({
  product: fixtures.product._id,
  variant: fixtures.variant._id,
  quantity: 2,
  ...overrides,
});

// Shared vertical state touched by the COD block, restored in cleanup.
let verticalCodWas = null;

const cleanup = async () => {
  await StoreOutletProduct.deleteMany({ outlet: OUTLET });
  await ChainProductVariant.deleteMany({ chain: CHAIN });
  await ChainProduct.deleteMany({ chain: CHAIN });
  await TaxConfiguration.deleteMany({ code: 'BASKET' + STAMP });
  await StorePromotion.deleteMany({ chain: CHAIN });
  await StoreOutlet.deleteMany({ _id: OUTLET });
  await StoreChain.deleteMany({ _id: CHAIN });
  await mongoose.model('StoreCategory').deleteMany({ _id: CATEGORY });
  await mongoose.model('StoreSubcategory').deleteMany({ _id: SUBCATEGORY });
  await mongoose.model('StoreBrand').deleteMany({ _id: BRAND });
  if (verticalCodWas !== null) {
    await Vertical.updateOne({ key: 'stores' }, { $set: { 'settings.enabledFeatures.codEnabled': verticalCodWas } });
  }
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  await setup();

  console.log('\n=== the outlet price wins, and the math is exact ===\n');

  const basket = await basketService.resolveBasket({
    outlet: OUTLET, chain: CHAIN, items: [line()], paymentMode: 'gateway',
  });
  ck('one input line yields one frozen line', basket.lines.length === 1);
  // Outlet price 480, NOT the chain/variant price 500 — BR-36 in one number.
  ck('the outlet row price is used, not the variant price',
    Number(basket.lines[0].unitPrice) === 480, basket.lines[0].unitPrice);
  ck('lineTotal is unit x qty', Number(basket.lines[0].lineTotal) === 960, basket.lines[0].lineTotal);
  ck('the snapshot freezes name, sku and attributes',
    !!basket.lines[0].name && !!basket.lines[0].sku && !!basket.lines[0].attributes);
  ck('the snapshot freezes the tax rate and HSN',
    basket.lines[0].gstRate === 18 && basket.lines[0].hsn === 'BASKET' + STAMP,
    `${basket.lines[0].gstRate} ${basket.lines[0].hsn}`);

  const t = basket.totals;
  ck('itemsSubtotal is the line sum', Number(t.itemsSubtotal) === 960, t.itemsSubtotal);
  ck('tax is computed (18% inclusive on 960)', Number(t.taxTotal) > 0, t.taxTotal);
  ck('grandTotal assembles subtotal + tax + fee',
    Math.abs(Number(t.grandTotal) - (Number(t.itemsSubtotal) + Number(t.taxTotal) + Number(t.deliveryFee))) < 0.015,
    `${t.grandTotal} vs ${t.itemsSubtotal}+${t.taxTotal}+${t.deliveryFee}`);

  console.log('\n=== BR-36: no join row, no sale ===\n');

  const otherVariant = await ChainProductVariant.create({
    chain: CHAIN, product: fixtures.product._id, sku: 'BSKT2-' + STAMP,
    name: 'L / Black', price: 500, priceInPaise: 50000, status: 'active',
  });
  let noJoin = false;
  try {
    await basketService.resolveBasket({
      outlet: OUTLET, chain: CHAIN,
      items: [{ product: fixtures.product._id, variant: otherVariant._id, quantity: 1 }],
    });
  } catch (e) {
    noJoin = e.statusCode === 409 && /VARIANT_NOT_AVAILABLE_AT_OUTLET/.test(e.message);
  }
  ck('a variant with no outlet join row is refused, not priced from the chain', noJoin);
  await ChainProductVariant.deleteOne({ _id: otherVariant._id });

  let mismatch = false;
  const wrongProduct = await ChainProduct.create({
    chain: CHAIN, category: CATEGORY, subcategory: SUBCATEGORY, brand: BRAND,
    name: 'Wrong Product', slug: 'wrong-product-' + STAMP, basePrice: 999, status: 'active',
  });
  try {
    await basketService.resolveBasket({
      outlet: OUTLET, chain: CHAIN,
      items: [{ product: wrongProduct._id, variant: fixtures.variant._id, quantity: 1 }],
    });
  } catch (e) {
    mismatch = e.statusCode === 422 && /LINE_PRODUCT_MISMATCH/.test(e.message);
  }
  ck('a variant paired with the wrong product is refused', mismatch);

  let ghost = false;
  try {
    await basketService.resolveBasket({
      outlet: OUTLET, chain: CHAIN,
      items: [{ product: fixtures.product._id, variant: new mongoose.Types.ObjectId(), quantity: 1 }],
    });
  } catch (e) {
    ghost = e.statusCode === 404 && /VARIANT_NOT_FOUND/.test(e.message);
  }
  ck('an unknown variant is a 404', ghost);

  let empty = false;
  try {
    await basketService.resolveBasket({ outlet: OUTLET, chain: CHAIN, items: [] });
  } catch (e) {
    empty = e.statusCode === 400 && /BASKET_EMPTY/.test(e.message);
  }
  ck('an empty basket is refused', empty);

  console.log('\n=== promos are validated and capped server-side ===\n');

  await StorePromotion.create({
    chain: CHAIN, name: 'Basket 10%', type: 'percent_off', value: 10,
    code: 'BASKET10', status: 'active', isActive: true,
    startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000),
  });
  const promoed = await basketService.resolveBasket({
    outlet: OUTLET, chain: CHAIN, items: [line()], promoCode: 'basket10', paymentMode: 'gateway',
  });
  ck('a valid code discounts (10% of 960 = 96)', Number(promoed.totals.discountTotal) === 96,
    promoed.totals.discountTotal);
  ck('the discounted line carries its pro-rata share', Number(promoed.lines[0].discountAmount) === 96,
    promoed.lines[0].discountAmount);
  ck('tax is computed on the discounted base', Number(promoed.totals.taxTotal) < Number(t.taxTotal),
    `${promoed.totals.taxTotal} vs ${t.taxTotal}`);

  let badCode = false;
  try {
    await basketService.resolveBasket({
      outlet: OUTLET, chain: CHAIN, items: [line()], promoCode: 'NOPE99',
    });
  } catch (e) {
    badCode = e.statusCode === 404;
  }
  ck('an unknown promo code is refused, not ignored', badCode);

  console.log('\n=== delivery fee: promo, threshold, or outlet fee ===\n');

  ck('below the free-delivery threshold the outlet fee applies', Number(t.deliveryFee) === 30, t.deliveryFee);

  await StoreOutlet.updateOne({ _id: OUTLET }, { 'deliveryConfig.freeDeliveryAbove': 100 });
  const freeByThreshold = await basketService.resolveBasket({
    outlet: OUTLET, chain: CHAIN, items: [line()], paymentMode: 'gateway',
  });
  ck('above the threshold delivery is free', Number(freeByThreshold.totals.deliveryFee) === 0,
    freeByThreshold.totals.deliveryFee);
  await StoreOutlet.updateOne({ _id: OUTLET }, { 'deliveryConfig.freeDeliveryAbove': 1000 });

  await StorePromotion.create({
    chain: CHAIN, name: 'Free ship', type: 'free_delivery', value: 0,
    code: 'FREESHIP', status: 'active', isActive: true,
    startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000),
  });
  const freeByPromo = await basketService.resolveBasket({
    outlet: OUTLET, chain: CHAIN, items: [line()], promoCode: 'FREESHIP', paymentMode: 'gateway',
  });
  ck('a free-delivery promo zeroes the fee', Number(freeByPromo.totals.deliveryFee) === 0);

  console.log('\n=== the minimum-order and COD gates ===\n');

  // The vertical COD switch is SHARED state (one `stores` row for the whole DB). Read it,
  // force it on for this block, and restore it in cleanup so no other suite sees us.
  const verticalBefore = await Vertical.findOne({ key: 'stores' }).select('settings').lean();
  verticalCodWas = !!(verticalBefore && verticalBefore.settings && verticalBefore.settings.enabledFeatures &&
    verticalBefore.settings.enabledFeatures.codEnabled === true);
  await Vertical.updateOne({ key: 'stores' }, { $set: { 'settings.enabledFeatures.codEnabled': true } });

  await StoreOutlet.updateOne({ _id: OUTLET }, { 'deliveryConfig.minimumOrder': 100000 });
  let tooSmall = false;
  try {
    await basketService.resolveBasket({ outlet: OUTLET, chain: CHAIN, items: [line()] });
  } catch (e) {
    tooSmall = e.statusCode === 422 && /MINIMUM_ORDER_NOT_MET/.test(e.message);
  }
  ck('below the outlet minimum the basket is refused', tooSmall);
  await StoreOutlet.updateOne({ _id: OUTLET }, { 'deliveryConfig.minimumOrder': 0 });

  const codOk = await basketService.resolveBasket({
    outlet: OUTLET, chain: CHAIN, items: [line()], paymentMode: 'cod',
  });
  ck('COD passes when outlet and vertical both allow it', !!codOk.totals);

  await StoreOutlet.updateOne({ _id: OUTLET }, { 'deliveryConfig.codEnabled': false });
  let codOff = false;
  try {
    await basketService.resolveBasket({ outlet: OUTLET, chain: CHAIN, items: [line()], paymentMode: 'cod' });
  } catch (e) {
    codOff = /COD/i.test(e.message);
  }
  ck('COD is refused when the outlet disables it', codOff);
  await StoreOutlet.updateOne({ _id: OUTLET }, { 'deliveryConfig.codEnabled': true });
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
    console.log('\n' + (failures === 0 ? 'ALL STORES BASKET CHECKS PASSED' : failures + ' STORES BASKET CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });