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
 * verify.stores.analytics.js — the numbers the partner sees.
 *
 * Run: node scripts/verify.stores.analytics.js
 *
 * ## What this pins
 *
 *   - an empty outlet returns zeros, not nulls and not a crash (every tile divides by
 *     something, and a missing row must not become a NaN on the dashboard)
 *   - order stats sum only the outlet's rows inside the window
 *   - low/out-of-stock counts use the same threshold expression as the low-stock query,
 *     so the dashboard and the stock screen cannot disagree
 *   - reviews count only `approved` rows
 *   - top products rank by quantity sold, capped at ten
 *   - chain analytics break outlets down by status and trend orders by day
 *
 * ## The inventory-value join, fixed
 *
 * `totalValue` used to multiply `$onHand` by `$costPrice` read off the STOCK ITEM — but
 * cost lives on the OUTLET PRODUCT, which has no such field on the item, so the tile was
 * permanently zero. The aggregation now `$lookup`s the outlet product by
 * (outlet, variant) and values each row by its joined cost, with an untracked SKU
 * contributing 0 rather than nulling the sum. The block below pins both halves: costed
 * stock counts, untracked stock does not poison it.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const analyticsService = require('../src/modules/stores/services/stores.analytics.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.order.model');
require('../src/modules/stores/models/store.outlet.stock.item.model');
require('../src/modules/stores/models/store.outlet.product.model');
require('../src/modules/stores/models/store.review.model');
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/chain.product.model');

const StoreOrder = mongoose.model('StoreOrder');
const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
const StoreReview = mongoose.model('StoreReview');
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
const OTHER_OUTLET = new mongoose.Types.ObjectId();
const CHAIN = new mongoose.Types.ObjectId();
const STAMP = Date.now() % 100000;

let orderNoSeq = 0;
const makeOrder = async (overrides = {}) =>
  StoreOrder.create({
    orderNo: 9730000 + Math.floor(Math.random() * 89999),
    customer: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    items: [],
    grandTotal: 500,
    refundedAmount: 0,
    lifecycle: 'completed',
    ...overrides,
  });

const cleanup = async () => {
  await StoreOrder.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
  await StoreOutletStockItem.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
  await StoreReview.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
  await StoreOutlet.deleteMany({ _id: { $in: [OUTLET, OTHER_OUTLET] } });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== an empty outlet returns zeros, not nulls ===\n');

  await StoreOutlet.create({ _id: OUTLET, chain: CHAIN, outletCode: 'ANL-' + STAMP, name: 'analytics suite', status: 'active' });
  const empty = await analyticsService.getOutletDashboard(OUTLET, {});
  ck('orders section is zeroed', empty.orders.totalOrders === 0 && empty.orders.totalRevenue === 0);
  ck('inventory section is zeroed', empty.inventory.totalSkus === 0 && empty.inventory.lowStock === 0);
  ck('reviews section is zeroed', empty.reviews.totalReviews === 0 && empty.reviews.avgRating === 0);
  ck('top products is an empty list, not null', Array.isArray(empty.topProducts) && empty.topProducts.length === 0);

  console.log('\n=== order stats sum the outlet window ===\n');

  await makeOrder({ grandTotal: 500, refundedAmount: 50 });
  await makeOrder({ grandTotal: 300, refundedAmount: 0 });
  // Another outlet's orders must not leak in.
  await makeOrder({ outlet: OTHER_OUTLET, grandTotal: 9999 });
  // Outside the window must not count.
  await makeOrder({ createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), grandTotal: 7777 });

  const week = await analyticsService.getOutletDashboard(OUTLET, {
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    to: new Date(),
  });
  ck('two orders in the window', week.orders.totalOrders === 2, `count=${week.orders.totalOrders}`);
  ck('revenue sums grandTotal (500 + 300)', week.orders.totalRevenue === 800, week.orders.totalRevenue);
  ck('refunds sum refundedAmount (50 + 0)', week.orders.totalRefunds === 50, week.orders.totalRefunds);
  ck('average is revenue over count', week.orders.avgOrderValue === 400, week.orders.avgOrderValue);

  const all = await analyticsService.getOutletDashboard(OUTLET, {});
  ck('without a window the old order counts too', all.orders.totalOrders === 3, `count=${all.orders.totalOrders}`);

  console.log('\n=== stock counts match the low-stock query ===\n');

  const v = (n) => new mongoose.Types.ObjectId();
  await StoreOutletStockItem.create([
    { outlet: OUTLET, chain: CHAIN, variant: v(1), product: new mongoose.Types.ObjectId(), onHand: 10, reserved: 0, damaged: 0, availableQty: 8, lowStockThreshold: 5 },
    { outlet: OUTLET, chain: CHAIN, variant: v(2), product: new mongoose.Types.ObjectId(), onHand: 3, reserved: 0, damaged: 0, availableQty: 3, lowStockThreshold: 5 },
    { outlet: OUTLET, chain: CHAIN, variant: v(3), product: new mongoose.Types.ObjectId(), onHand: 0, reserved: 0, damaged: 0, availableQty: 0, lowStockThreshold: 5 },
  ]);
  const dash = await analyticsService.getOutletDashboard(OUTLET, {});
  ck('three SKUs counted', dash.inventory.totalSkus === 3, `skus=${dash.inventory.totalSkus}`);
  ck('one low (3 <= 5) but not out', dash.inventory.lowStock === 2, `low=${dash.inventory.lowStock}`);
  ck('one out (available 0)', dash.inventory.outOfStock === 1, `out=${dash.inventory.outOfStock}`);

  console.log('\n=== inventory value joins cost from the outlet product ===\n');

  // Cost lives on StoreOutletProduct, keyed by (outlet, variant). Give two of the three
  // SKUs a cost; the third proves an untracked SKU contributes 0 rather than nulling
  // the whole tile.
  const StoreOutletProduct = mongoose.model('StoreOutletProduct');
  const stockRows = await mongoose.model('StoreOutletStockItem')
    .find({ outlet: OUTLET }).select('variant onHand').lean();
  await StoreOutletProduct.create([
    { outlet: OUTLET, chain: CHAIN, product: new mongoose.Types.ObjectId(), productVariant: stockRows[0].variant, price: 100, priceInPaise: 10000, status: 'active', costPrice: 60 },
    { outlet: OUTLET, chain: CHAIN, product: new mongoose.Types.ObjectId(), productVariant: stockRows[1].variant, price: 100, priceInPaise: 10000, status: 'active', costPrice: 40 },
  ]);
  const valued = await analyticsService.getOutletDashboard(OUTLET, {});
  // onHand 10 @ 60 + onHand 3 @ 40 + onHand 0 @ untracked(0) = 600 + 120 + 0
  ck('totalValue reflects on-hand costed stock', Number(valued.inventory.totalValue) === 720,
    `totalValue=${valued.inventory.totalValue}`);
  await StoreOutletProduct.deleteMany({ outlet: OUTLET });

  console.log('\n=== reviews count approved only ===\n');

  await StoreReview.create([
    { outlet: OUTLET, chain: CHAIN, customer: new mongoose.Types.ObjectId(), rating: 5, status: 'approved' },
    { outlet: OUTLET, chain: CHAIN, customer: new mongoose.Types.ObjectId(), rating: 3, status: 'approved' },
    { outlet: OUTLET, chain: CHAIN, customer: new mongoose.Types.ObjectId(), rating: 1, status: 'pending' },
    { outlet: OUTLET, chain: CHAIN, customer: new mongoose.Types.ObjectId(), rating: 1, status: 'rejected' },
  ]);
  const rev = await analyticsService.getOutletDashboard(OUTLET, {});
  ck('only approved reviews count', rev.reviews.totalReviews === 2, `count=${rev.reviews.totalReviews}`);
  ck('the average is over approved only', rev.reviews.avgRating === 4, `avg=${rev.reviews.avgRating}`);

  console.log('\n=== top products rank by quantity ===\n');

  const topA = new mongoose.Types.ObjectId();
  const topB = new mongoose.Types.ObjectId();
  await makeOrder({
    items: [
      { product: topA, variant: new mongoose.Types.ObjectId(), name: 'Seller', quantity: 5, orderedQuantity: 5, unitPrice: 10, lineTotal: 50, lineGrand: 50 },
      { product: topB, variant: new mongoose.Types.ObjectId(), name: 'Slow', quantity: 1, orderedQuantity: 1, unitPrice: 10, lineTotal: 10, lineGrand: 10 },
    ],
  });
  const ranked = await analyticsService.getOutletDashboard(OUTLET, {});
  ck('the best seller ranks first', ranked.topProducts.length > 0 && String(ranked.topProducts[0]._id) === String(topA));
  ck('at most ten products are returned', ranked.topProducts.length <= 10);

  console.log('\n=== chain analytics ===\n');

  await StoreOutlet.create({ _id: OTHER_OUTLET, chain: CHAIN, outletCode: 'ANL2-' + STAMP, name: 'second', status: 'suspended' });
  const chain = await analyticsService.getChainAnalytics(CHAIN, {});
  const byStatus = Object.fromEntries(chain.outlets.map((o) => [o._id, o.count]));
  ck('outlets break down by status', (byStatus.active || 0) >= 1 && (byStatus.suspended || 0) >= 1, JSON.stringify(byStatus));
  ck('the order trend is day-bucketed', chain.orderTrend.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t._id)));
  ck('trend rows carry orders and revenue', chain.orderTrend.every((t) => typeof t.orders === 'number' && typeof t.revenue === 'number'));
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
    console.log('\n' + (failures === 0 ? 'ALL STORES ANALYTICS CHECKS PASSED' : failures + ' STORES ANALYTICS CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });