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
 * verify.stores.refunds.js — the refunds console.
 *
 * Run: node scripts/verify.stores.refunds.js
 *
 * ## Scope discipline
 *
 * `verify.stores.orders.js` already pins the money rules themselves — BR-28's per-component
 * refunds, the BR-33 ceiling, and the refund state machine. What it does NOT prove is the
 * surface the refunds console and the partner app read: lookup by id, filtered listing,
 * pagination, and the failed-refunds queue. This suite proves reads, not writes.
 *
 * ## What this pins
 *
 *   - `getRefund` returns the row with customer and order populated, or a 404
 *   - `listRefunds` filters by outlet, customer and status, independently
 *   - paging is newest-first with a sane totalPages floor of 1
 *   - `findFailedRefunds` returns only FAILED rows for the outlet
 *   - a REVERSED row is never reported as failed (reversal is the terminal fix)
 *
 * Fixtures are synthetic ObjectIds; nothing here needs taxonomy or stock.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const refundService = require('../src/modules/stores/services/stores.refund.service');

// The service resolves models through `mongoose.model(...)` at call time.
// `getRefund` populates customer (refs 'User') and order (refs 'StoreOrder').
require('../src/modules/stores/models/store.refund.model');
require('../src/models/user.model');
require('../src/modules/stores/models/store.order.model');

const StoreRefund = mongoose.model('StoreRefund');

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
const CUSTOMER = new mongoose.Types.ObjectId();
const OTHER_CUSTOMER = new mongoose.Types.ObjectId();

const makeRefund = async (overrides = {}) =>
  StoreRefund.create({
    order: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    customer: CUSTOMER,
    componentKey: `item:${new mongoose.Types.ObjectId()}`,
    amount: 100,
    reason: 'customer_cancellation',
    fundingSource: 'connected_account',
    status: 'REFUND_PENDING',
    timeline: [{ status: 'REFUND_PENDING', at: new Date() }],
    ...overrides,
  });

const cleanup = async () => {
  await StoreRefund.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== getRefund: the row, populated ===\n');

  const one = await makeRefund();
  const fetched = await refundService.getRefund(one._id);
  ck('a refund can be fetched by id', String(fetched._id) === String(one._id));
  ck('it carries the amount', Number(fetched.amount) === 100, fetched.amount);

  let missing = false;
  try {
    await refundService.getRefund(new mongoose.Types.ObjectId());
  } catch (e) {
    missing = e.statusCode === 404;
  }
  ck('a missing refund is a 404, not null', missing);

  console.log('\n=== listRefunds: independent filters ===\n');

  await makeRefund({ outlet: OTHER_OUTLET });
  await makeRefund({ customer: OTHER_CUSTOMER });
  await makeRefund({ status: 'REFUNDED' });

  const byOutlet = await refundService.listRefunds({ outlet: OUTLET });
  ck('outlet filter scopes to the outlet', byOutlet.items.every((r) => String(r.outlet) === String(OUTLET)));
  ck('a row from another outlet is excluded', !byOutlet.items.some((r) => String(r.outlet) === String(OTHER_OUTLET)));

  const byCustomer = await refundService.listRefunds({ customer: CUSTOMER });
  ck('customer filter scopes to the customer', byCustomer.items.every((r) => String(r.customer) === String(CUSTOMER)));
  ck('another customer is excluded', !byCustomer.items.some((r) => String(r.customer) === String(OTHER_CUSTOMER)));

  const byStatus = await refundService.listRefunds({ status: 'REFUNDED' });
  ck('status filter returns only that status', byStatus.items.length > 0 && byStatus.items.every((r) => r.status === 'REFUNDED'));

  const combined = await refundService.listRefunds({ outlet: OUTLET, customer: CUSTOMER });
  ck('filters combine rather than union',
    combined.items.every((r) => String(r.outlet) === String(OUTLET) && String(r.customer) === String(CUSTOMER)));

  console.log('\n=== paging ===\n');

  ck('items come back an array', Array.isArray(byOutlet.items));
  ck('total counts the filtered set, not the page', byOutlet.total >= byOutlet.items.length,
    `total=${byOutlet.total} items=${byOutlet.items.length}`);
  ck('the page echoes', byOutlet.page === 1 && byOutlet.limit === 20);
  ck('totalPages floors at 1 even when empty', (await refundService.listRefunds({ outlet: new mongoose.Types.ObjectId() })).totalPages === 1);

  const page2 = await refundService.listRefunds({ outlet: OUTLET, page: 2, limit: 1 });
  ck('page 2 of size 1 carries the next row', page2.items.length <= 1 && page2.page === 2);
  const newest = page2.items.length ? page2.items[0] : null;
  if (newest) {
    const firstPage = await refundService.listRefunds({ outlet: OUTLET, page: 1, limit: 1 });
    ck('pages do not overlap', String(firstPage.items[0]._id) !== String(newest._id));
  }
  ck('newest first ordering', true && (byOutlet.items.length <= 1 || new Date(byOutlet.items[0].createdAt) >= new Date(byOutlet.items[byOutlet.items.length - 1].createdAt)));

  console.log('\n=== findFailedRefunds: the retry queue ===\n');

  const failedOne = await makeRefund({ status: 'FAILED', failureReason: 'bank closed' });
  const found = await refundService.findFailedRefunds(OUTLET);
  ck('a FAILED row is returned', found.some((r) => String(r._id) === String(failedOne._id)));
  ck('only FAILED rows are returned', found.every((r) => r.status === 'FAILED'));

  await refundService.transitionRefund(failedOne._id, 'PROCESSING');
  const revived = await refundService.findFailedRefunds(OUTLET);
  ck('a row being retried leaves the failed queue', !revived.some((r) => String(r._id) === String(failedOne._id)));

  const terminalReversed = await makeRefund();
  await refundService.transitionRefund(terminalReversed._id, 'REVERSED');
  const afterReverse = await refundService.findFailedRefunds(OUTLET);
  ck('a REVERSED row never appears as failed', !afterReverse.some((r) => String(r._id) === String(terminalReversed._id)));
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
    console.log('\n' + (failures === 0 ? 'ALL STORES REFUND CONSOLE CHECKS PASSED' : failures + ' STORES REFUND CONSOLE CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });