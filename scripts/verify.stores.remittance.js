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
 * verify.stores.remittance.js — the COD cash comes home.
 *
 * Run: node scripts/verify.stores.remittance.js
 *
 * ## What this pins
 *
 *   A store driver collects COD cash at doors all day and hands a bundle to the outlet.
 *   The remittance is the reconciliation of those two numbers:
 *
 *     variance = collected - remitted
 *
 *   - variance 0          -> reconciled immediately on submit
 *   - variance POSITIVE   -> disputed (cash is missing; the driver kept more than handed over)
 *   - variance NEGATIVE   -> status unchanged (over-remittance is not auto-reconciled)
 *   - a reconciled row is terminal: submit and reconcile both refuse it
 *   - reconcile is idempotent for an already-reconciled row, but refuses a row that
 *     still carries variance
 *   - generation is idempotent per (driver, date): re-running updates `expected` rather
 *     than writing a second row (unique index backs this)
 *   - `expected` is the sum of that driver's DELIVERED COD that day — and nothing else:
 *     failed, cancelled and non-COD deliveries do not count
 *
 * ## Money note
 *
 * `StoreDriverRemittance` money fields use the platform getter (paise at rest, rupees at
 * the edges). Fixtures assign rupees and assertions read through the getters, never
 * `.lean()`, so a paise-vs-rupees slip reads as a wrong number rather than passing
 * silently. Where `.lean()` is unavoidable the assertion converts explicitly.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const remittanceService = require('../src/modules/stores/services/stores.remittance.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.driver.remittance.model');
require('../src/modules/stores/models/store.delivery.model');
require('../src/modules/stores/models/store.driver.model');
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/chain.product.model');

const StoreDriverRemittance = mongoose.model('StoreDriverRemittance');
const StoreDelivery = mongoose.model('StoreDelivery');

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
const DRIVER = new mongoose.Types.ObjectId();
const OTHER_DRIVER = new mongoose.Types.ObjectId();
const TODAY = new Date();
TODAY.setHours(12, 0, 0, 0);

const makeDelivery = async (overrides = {}) =>
  StoreDelivery.create({
    order: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    driver: DRIVER,
    status: 'delivered',
    deliveredAt: new Date(),
    codCollected: 250,
    codCollected: 250,
    codStatus: 'collected',
    ...overrides,
  });

const cleanup = async () => {
  await StoreDriverRemittance.deleteMany({ outlet: OUTLET });
  await StoreDelivery.deleteMany({ outlet: OUTLET });
  await mongoose.model('StoreOutlet').deleteMany({ _id: OUTLET });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  // listRemittances populates `outlet`, so the outlet row must exist or the field
  // reads back null and every scoping assertion fails on population, not on logic.
  await mongoose.model('StoreOutlet').create({
    _id: OUTLET, chain: CHAIN, outletCode: 'REM-' + Date.now(), name: 'remittance suite',
  });

  console.log('\n=== generation: expected is delivered COD, nothing else ===\n');

  await makeDelivery();
  await makeDelivery();
  // Noise that must NOT count: failed, cancelled, and a zero-COD prepaid order.
  await makeDelivery({ status: 'failed' });
  await makeDelivery({ status: 'cancelled' });
  await makeDelivery({ codCollected: 0 });
  // Another driver's deliveries must not count either.
  await makeDelivery({ driver: OTHER_DRIVER });

  const generated = await remittanceService.generateRemittanceForDriver(DRIVER, OUTLET, CHAIN, TODAY);
  ck('a remittance row is created', !!generated._id);
  ck('it starts pending', generated.status === 'pending', generated.status);
  ck('expected sums only this driver delivered COD (2 x 250)', Number(generated.expected) === 500, generated.expected);
  ck('collected and remitted start at zero', Number(generated.collected) === 0 && Number(generated.remitted) === 0);

  const regenerated = await remittanceService.generateRemittanceForDriver(DRIVER, OUTLET, CHAIN, TODAY);
  ck('regenerating the same day returns the SAME row', String(regenerated._id) === String(generated._id));
  const dayCount = await StoreDriverRemittance.countDocuments({ driver: DRIVER });
  ck('and does not write a second row (unique driver+date)', dayCount === 1, `count=${dayCount}`);

  console.log('\n=== a balanced handover reconciles on submit ===\n');

  const balanced = await remittanceService.submitRemittance({
    remittanceId: generated._id, collected: 500, remitted: 500, notes: 'even', actor: new mongoose.Types.ObjectId(),
  });
  ck('variance is collected minus remitted', Number(balanced.variance) === 0, balanced.variance);
  ck('a zero-variance submit reconciles immediately', balanced.status === 'reconciled', balanced.status);
  ck('the reconciliation is stamped', !!balanced.reconciledAt && !!balanced.reconciledBy);

  console.log('\n=== a short handover is disputed, not reconciled ===\n');

  const short = await StoreDriverRemittance.create({
    driver: OTHER_DRIVER, outlet: OUTLET, chain: CHAIN, date: new Date(TODAY.getTime() - 86400000),
    expected: 500, collected: 0, remitted: 0, variance: 0, status: 'pending',
  });
  const disputed = await remittanceService.submitRemittance({
    remittanceId: short._id, collected: 500, remitted: 300, notes: 'short', actor: new mongoose.Types.ObjectId(),
  });
  ck('a 200 shortfall records variance 200', Number(disputed.variance) === 200, disputed.variance);
  ck('a short handover is disputed, never reconciled', disputed.status === 'disputed', disputed.status);

  let resubmitDisputed = false;
  try {
    await remittanceService.submitRemittance({ remittanceId: short._id, collected: 500, remitted: 500 });
  } catch (e) {
    resubmitDisputed = e.statusCode === 409 && /REMITTANCE_DISPUTED/.test(e.message);
  }
  ck('resubmitting a disputed row is refused', resubmitDisputed);

  let reconcileShort = false;
  try {
    await remittanceService.reconcileRemittance({ remittanceId: short._id });
  } catch (e) {
    reconcileShort = e.statusCode === 409 && /VARIANCE_EXISTS/.test(e.message);
  }
  ck('a row carrying variance cannot be reconciled', reconcileShort);

  console.log('\n=== reconciled rows are terminal, reconcile is idempotent ===\n');

  let resubmitReconciled = false;
  try {
    await remittanceService.submitRemittance({ remittanceId: balanced._id, collected: 500, remitted: 500 });
  } catch (e) {
    resubmitReconciled = e.statusCode === 409 && /ALREADY_RECONCILED/.test(e.message);
  }
  ck('submitting an already-reconciled row is refused', resubmitReconciled);

  const again = await remittanceService.reconcileRemittance({ remittanceId: balanced._id });
  ck('reconciling an already-reconciled row is a no-op returning the row', again.status === 'reconciled');

  let reconcileMissing = false;
  try {
    await remittanceService.reconcileRemittance({ remittanceId: new mongoose.Types.ObjectId() });
  } catch (e) {
    reconcileMissing = e.statusCode === 404;
  }
  ck('reconciling a missing row is a 404', reconcileMissing);

  console.log('\n=== listing and the pending queue ===\n');

  // listRemittances populates `outlet`, so the field reads back as a document, not an id.
  const outletOf = (r) => String((r.outlet && r.outlet._id) || r.outlet);
  const listed = await remittanceService.listRemittances({ outlet: OUTLET, page: 1, limit: 10 });
  ck('listing scopes to the outlet', listed.items.every((r) => outletOf(r) === String(OUTLET)));
  ck('listing reports totals and paging', typeof listed.total === 'number' && listed.page === 1);
  const byStatus = await remittanceService.listRemittances({ outlet: OUTLET, status: 'disputed' });
  ck('status filter returns only that status', byStatus.items.length > 0 && byStatus.items.every((r) => r.status === 'disputed'));

  const pending = await remittanceService.getPendingRemittances(OUTLET);
  ck('the pending queue excludes reconciled and disputed rows',
    pending.every((r) => r.status === 'pending'));
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
    console.log('\n' + (failures === 0 ? 'ALL STORES REMITTANCE CHECKS PASSED' : failures + ' STORES REMITTANCE CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });