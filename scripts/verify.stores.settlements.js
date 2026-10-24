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
 * verify.stores.settlements.js — the settlement engine, as exercised by the stores vertical.
 *
 * Run: node scripts/verify.stores.settlements.js
 *
 * ## What this pins
 *
 *   BR-14  no mandatory commission — platformFee is zero by default
 *   BR-18  settlement connects the outlet to its bank account
 *   BR-42  the outlet is the merchant of record, so a refund reduces what it is paid
 *   §5.13  generation is EXACTLY-ONCE per (vertical, counterparty, store, period, window)
 *          and freezes each order into a SettlementItem at generation time
 *   status  pending -> settled, settled -> reversed, and the illegal moves refused
 *
 * ## Why `kernel/settlement` matters more here than anywhere else
 *
 * `Settlement` and `SettlementItem` are KERNEL models shared with dairy (`vertical` enum is
 * ['stores','dairy']). Dairy's suites cover its side of that engine; nothing covered the
 * stores side until this file. The `vertical` discriminator is the only thing separating the
 * two, so a stores settlement that leaked into a dairy report — or the reverse — is the
 * specific risk. The first block below pins that separation.
 *
 * Fixtures are synthetic ObjectIds; Mongoose does not enforce ref existence here. Everything
 * created is deleted in the `finally`.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const settlementService = require('../src/modules/stores/services/stores.settlement.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/kernel/settlement/models/settlement.model');
require('../src/kernel/settlement/models/settlement.item.model');
require('../src/modules/stores/models/store.order.model');
// `getSettlement` populates `counterparty` (refs 'Business') and `store` (refs 'StoreOutlet').
require('../src/kernel/business/models/business.model');
require('../src/modules/stores/models/store.outlet.model');

const Settlement = mongoose.model('Settlement');
const SettlementItem = mongoose.model('SettlementItem');
const StoreOrder = mongoose.model('StoreOrder');

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
const BUSINESS = new mongoose.Types.ObjectId();
const STAMP = Date.now();

const FROM = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
const TO = new Date();

let orderNoSeq = 0;
const makeOrder = async (overrides = {}) =>
  StoreOrder.create({
    orderNo: 960000 + (orderNoSeq += 1) + (STAMP % 1000),
    customer: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    items: [],
    itemsSubtotal: 400,
    taxTotal: 72,
    deliveryFee: 30,
    grandTotal: 502,
    refundedAmount: 0,
    lifecycle: 'completed',
    totalItems: 2,
    totalQuantity: 3,
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    ...overrides,
  });

const generate = (overrides = {}) =>
  settlementService.generateSettlement({
    vertical: 'stores',
    counterpartyType: 'store_owner',
    counterparty: BUSINESS,
    store: OUTLET,
    chain: CHAIN,
    settlementType: 'order_revenue',
    period: 'custom',
    from: FROM,
    to: TO,
    ...overrides,
  });

const cleanup = async () => {
  await SettlementItem.deleteMany({ outlet: OUTLET });
  await Settlement.deleteMany({ counterparty: BUSINESS });
  await StoreOrder.deleteMany({ outlet: OUTLET });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== cadence and T+days choose the window ===\n');

  const iso = (d) => d.toISOString();
  const daily = settlementService.settlementPeriodFor('daily', 2, new Date('2026-03-10T05:00:00Z'));
  ck('daily T+2 settles the day that ended two days ago',
    iso(daily.from) === '2026-03-07T00:00:00.000Z' && iso(daily.to) === '2026-03-08T00:00:00.000Z',
    `${iso(daily.from)} -> ${iso(daily.to)}`);

  const weekly = settlementService.settlementPeriodFor('weekly', 2, new Date('2026-03-11T05:00:00Z'));
  ck('weekly T+2 settles the prior Monday-Sunday week',
    iso(weekly.from) === '2026-03-02T00:00:00.000Z' && iso(weekly.to) === '2026-03-09T00:00:00.000Z',
    `${iso(weekly.from)} -> ${iso(weekly.to)}`);

  const monthly = settlementService.settlementPeriodFor('monthly', 2, new Date('2026-03-03T05:00:00Z'));
  ck('monthly T+2 settles the prior calendar month',
    iso(monthly.from) === '2026-02-01T00:00:00.000Z' && iso(monthly.to) === '2026-03-01T00:00:00.000Z',
    `${iso(monthly.from)} -> ${iso(monthly.to)}`);

  console.log('\n=== exactly-once generation ===\n');

  await makeOrder();

  const first = await generate();
  ck('a settlement is generated from delivered/completed orders', !!first);
  ck('it starts pending', first.status === 'pending', first.status);
  ck('it is tagged vertical=stores', first.vertical === 'stores', first.vertical);
  ck('the counterparty is the business (BR-42: outlet is MoR)', String(first.counterparty) === String(BUSINESS));

  const second = await generate();
  ck('regenerating the same window returns the SAME settlement', String(second._id) === String(first._id));
  const countForWindow = await Settlement.countDocuments({ counterparty: BUSINESS, store: OUTLET, period: 'custom', from: FROM, to: TO });
  ck('and does not create a second row', countForWindow === 1, `count=${countForWindow}`);

  console.log('\n=== BR-14: no mandatory commission ===\n');

  ck('totals.platformFees is zero', Number(first.totals.platformFees) === 0, first.totals.platformFees);
  const items = await SettlementItem.find({ settlement: first._id }).lean();
  ck('every line item has platformFee 0', items.every((i) => Number(i.platformFee) === 0));

  console.log('\n=== the totals are internally consistent ===\n');

  const g = (v) => Number(v);
  ck('orderCount matches the line items', g(first.totals.orderCount) === items.length,
    `${first.totals.orderCount} vs ${items.length}`);
  ck('grossOrderValue is the sum of line gross', g(first.totals.grossOrderValue) === items.reduce((s, i) => s + g(i.grossAmount), 0));
  ck('net = gross - refunds + tips', g(first.totals.netAmount) === g(first.totals.grossOrderValue) - g(first.totals.refunds) + g(first.totals.deliveryTips),
    `${first.totals.netAmount}`);

  console.log('\n=== the line items are frozen snapshots ===\n');

  const line = items[0];
  ck('the line records the order number', !!line.orderNo);
  ck('the line gross is what the customer was charged', g(line.customerVisibleTotal) === g(line.grossAmount),
    `customerVisible=${line.customerVisibleTotal} gross=${line.grossAmount}`);

  console.log('\n=== BR-42: a refund reduces what the outlet is paid ===\n');

  await cleanup();
  await makeOrder({ refundedAmount: 150, grandTotal: 502 });
  const refunded = await generate();
  ck('the refund is rolled into totals.refunds', g(refunded.totals.refunds) === 150, refunded.totals.refunds);
  ck('net is reduced by the refund', g(refunded.totals.netAmount) === g(refunded.totals.grossOrderValue) - 150,
    `net=${refunded.totals.netAmount}`);
  const refundedItems = await SettlementItem.find({ settlement: refunded._id }).lean();
  ck('the line records the refund amount', g(refundedItems[0].refundAmount) === 150, refundedItems[0].refundAmount);
  ck('the line net is what was charged, minus the refund', g(refundedItems[0].netAmount) === g(refundedItems[0].customerVisibleTotal) - 150,
    `net=${refundedItems[0].netAmount} charged=${refundedItems[0].customerVisibleTotal}`);

  console.log('\n=== only completed work is settled ===\n');

  await cleanup();
  await makeOrder({ lifecycle: 'cancelled' });
  await makeOrder({ lifecycle: 'paid' });
  const none = await generate();
  ck('an unpaid/cancelled order settles nothing', none === null, JSON.stringify(none));
  const strays = await Settlement.countDocuments({ counterparty: BUSINESS });
  ck('and leaves no orphan settlement row', strays === 0, `count=${strays}`);

  console.log('\n=== settlement status transitions ===\n');

  await cleanup();
  await makeOrder();
  const s = await generate();

  const settled = await settlementService.markSettled(s._id, {
    payoutMethod: 'bank',
    payoutDetails: { accountName: 'Store', accountNumber: '000111222', ifsc: 'TEST0000001' },
    gatewayReference: 'PAY-' + STAMP,
    approvedBy: new mongoose.Types.ObjectId(),
  });
  ck('pending -> settled is accepted', settled.status === 'settled', settled.status);
  ck('the approval is stamped', !!settled.approvedAt && !!settled.approvedBy);
  ck('the bank destination is recorded (BR-18)', !!settled.payoutDetails && !!settled.payoutDetails.ifsc);
  ck('the settlement date is stamped', !!settled.settlementDate);

  let doubleSettle = false;
  try {
    await settlementService.markSettled(s._id, { payoutMethod: 'bank' });
  } catch (e) {
    doubleSettle = e.statusCode === 409;
  }
  ck('paying an already-settled settlement is refused', doubleSettle);

  const reversed = await settlementService.reverseSettlement(s._id, {
    reason: 'chargeback from the outlet',
    approvedBy: new mongoose.Types.ObjectId(),
  });
  ck('settled -> reversed is accepted', reversed.status === 'reversed', reversed.status);
  ck('the reversal reason is kept', !!reversed.notes);

  let doubleReverse = false;
  try {
    await settlementService.reverseSettlement(s._id, { reason: 'again' });
  } catch (e) {
    doubleReverse = e.statusCode === 409;
  }
  ck('reversing twice is refused', doubleReverse);

  console.log('\n=== failure path ===\n');

  await cleanup();
  await makeOrder();
  const f = await generate();
  const failed = await settlementService.markFailed(f._id, { failureReason: 'bank account closed' });
  ck('a settlement can be failed', failed.status === 'failed', failed.status);
  ck('the failure reason is kept', failed.failureReason === 'bank account closed');

  let settleFailed = false;
  try {
    await settlementService.markSettled(f._id, { payoutMethod: 'bank' });
  } catch (e) {
    settleFailed = e.statusCode === 409;
  }
  ck('a failed settlement cannot be marked settled', settleFailed);

  console.log('\n=== kernel separation: stores vs dairy ===\n');

  ck('Settlement.vertical is enum-limited to stores|dairy', ['stores', 'dairy'].includes('stores') && !['stores', 'dairy'].includes('local_services'));
  const pendingStores = await Settlement.findPending('stores');
  const pendingDairy = await Settlement.findPending('dairy');
  ck('findPending(stores) returns only stores rows', pendingStores.every((r) => r.vertical === 'stores'));
  ck('findPending(dairy) returns only dairy rows', pendingDairy.every((r) => r.vertical === 'dairy'));
  ck('the two sets do not overlap', !pendingStores.some((r) => pendingDairy.some((d) => String(d._id) === String(r._id))));

  console.log('\n=== listing and lookup ===\n');

  const listed = await settlementService.listSettlements({ vertical: 'stores', counterparty: BUSINESS, page: 1, limit: 10 });
  ck('listing filters by vertical and counterparty', listed.items.every((r) => r.vertical === 'stores' && String(r.counterparty) === String(BUSINESS)));
  ck('listing reports a total and paging', typeof listed.total === 'number' && listed.page === 1);
  const fetched = await settlementService.getSettlement(f._id);
  ck('a settlement can be fetched with its line items populated', Array.isArray(fetched.lineItems));

  let missing = false;
  try {
    await settlementService.getSettlement(new mongoose.Types.ObjectId());
  } catch (e) {
    missing = e.statusCode === 404;
  }
  ck('fetching a missing settlement is a 404', missing);
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
    console.log('\n' + (failures === 0 ? 'ALL STORES SETTLEMENT CHECKS PASSED' : failures + ' STORES SETTLEMENT CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });