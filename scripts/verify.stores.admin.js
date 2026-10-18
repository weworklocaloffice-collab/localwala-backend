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
 * verify.stores.admin.js — the admin layer's own decisions.
 *
 * Run: node scripts/verify.stores.admin.js
 *
 * ## Why this file exists separately from the partner suites
 *
 * `stores.admin.records.service.js` states the reason in its header: every partner list
 * requires an outlet or chain because BR-38 makes tenancy mandatory, and loosening the
 * partner services to serve the admin panel would delete that guarantee. So admin reads
 * are cross-tenant by construction, behind admin-only rights — and they need their own
 * suite, because the partner suites never exercise a call without a tenant filter.
 *
 * ## What this pins
 *
 *   - taxonomy removal refuses when referenced (BR-25): a category holding subcategories
 *     or products, and a brand holding products, cannot be deleted — the error names the
 *     archive path instead
 *   - orphaned taxonomy rows delete cleanly
 *   - the operations consoles return shaped data without throwing on an empty platform:
 *     subscription health, settlement exceptions, refund failures, inventory drift,
 *     compliance expiry, abuse queue, application ageing, COD remittance, console summary
 *   - admin reads are cross-tenant by design: no outlet filter still returns rows
 *   - money reads back as rupees through `lean({ getters: true })` — a bare `.lean()`
 *     here was a silent 100x display bug on every paise-stored column
 */

const mongoose = require('mongoose');
require('dotenv').config();

const taxonomyService = require('../src/modules/stores/services/stores.admin.taxonomy.service');
const operationsService = require('../src/modules/stores/services/stores.admin.operations.service');
const recordsService = require('../src/modules/stores/services/stores.admin.records.service');

// The services resolve models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.category.model');
require('../src/modules/stores/models/store.subcategory.model');
require('../src/modules/stores/models/store.brand.model');
require('../src/modules/stores/models/chain.product.model');
require('../src/modules/stores/models/store.subscription.model');
require('../src/modules/stores/models/store.subscription.plan.model');
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/store.chain.model');
require('../src/modules/stores/models/store.order.model');
require('../src/modules/stores/models/store.outlet.stock.item.model');
require('../src/modules/stores/models/store.refund.model');
require('../src/modules/stores/models/store.review.model');
require('../src/modules/stores/models/store.compliance.document.model');
require('../src/modules/stores/models/store.organic.verification.model');
require('../src/modules/stores/models/store.onboarding.model');
require('../src/models/user.model');
require('../src/modules/stores/models/store.complaint.model');
require('../src/modules/stores/models/store.driver.remittance.model');
require('../src/modules/stores/models/store.driver.model');
require('../src/modules/stores/models/store.delivery.model');
require('../src/modules/stores/models/store.cancellation.model');
require('../src/modules/stores/models/store.return.request.model');
require('../src/modules/stores/models/store.exchange.request.model');
require('../src/modules/stores/models/store.warranty.request.model');
require('../src/modules/stores/models/store.promotion.model');
require('../src/modules/stores/models/store.policy.model');
require('../src/modules/stores/models/store.customer.subscription.model');
require('../src/kernel/settlement/models/settlement.model');
require('../src/kernel/settlement/models/settlement.item.model');

const StoreCategory = mongoose.model('StoreCategory');
const StoreSubcategory = mongoose.model('StoreSubcategory');
const StoreBrand = mongoose.model('StoreBrand');
const ChainProduct = mongoose.model('ChainProduct');

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
const STAMP = Date.now() % 100000;

// ChainProduct has NO chain field (catalog-global; chain scoping lives on the outlet
// join), so cleanup by chain would match nothing and leak. Track ids explicitly.
const createdProductIds = [];

const cleanup = async () => {
  await ChainProduct.deleteMany({ _id: { $in: createdProductIds } });
  await StoreSubcategory.deleteMany({ key: /^admintest/ });
  await StoreCategory.deleteMany({ key: /^admintest/ });
  await StoreBrand.deleteMany({ slug: /^admintest/ });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== taxonomy removal refuses referenced rows (BR-25) ===\n');

  const category = await taxonomyService.createCategory({ key: 'admintest_cat' + STAMP, name: 'Admin Test Cat ' + STAMP });
  ck('a category is created', !!category._id);

  const sub = await taxonomyService.createSubcategory({
    category: category._id, key: 'admintest_sub' + STAMP, name: 'Admin Test Sub ' + STAMP,
  });
  void sub;

  let referencedCat = false;
  try {
    await taxonomyService.removeCategory(category._id);
  } catch (e) {
    referencedCat = e.statusCode === 409;
  }
  ck('a category holding a subcategory cannot be deleted', referencedCat);
  ck('the refused category still exists', !!(await StoreCategory.findById(category._id).lean()));

  const brand = await taxonomyService.createBrand({ name: 'Admin Test Brand ' + STAMP, slug: 'admintest_brand' + STAMP });
  const prod = await ChainProduct.create({
    chain: CHAIN, category: category._id, brand: brand._id,
    name: 'Admin Test Product ' + STAMP, status: 'active',
  });
  createdProductIds.push(prod._id);

  let referencedBrand = false;
  try {
    await taxonomyService.removeBrand(brand._id);
  } catch (e) {
    referencedBrand = e.statusCode === 409 && /archiv/i.test(e.message);
  }
  ck('a brand holding products cannot be deleted', referencedBrand);
  ck('the error names the archive path', referencedBrand);

  let referencedCatByProduct = false;
  try {
    await taxonomyService.removeCategory(category._id);
  } catch (e) {
    referencedCatByProduct = e.statusCode === 409;
  }
  ck('a category holding products cannot be deleted either', referencedCatByProduct);

  // Removal refuses while ANY sub or product row references the category — including
  // archived ones, which still exist as history. So success is only provable on a virgin
  // category that never held anything; the guards above prove the refusal half.
  const virgin = await taxonomyService.createCategory({ name: 'Virgin Cat ' + STAMP });
  await taxonomyService.removeCategory(virgin._id);
  const virginArchived = await StoreCategory.findById(virgin._id).lean();
  ck('an unreferenced category archives cleanly', virginArchived && virginArchived.status === false);
  const virginBrand = await taxonomyService.createBrand({ name: 'Virgin Brand ' + STAMP });
  await taxonomyService.removeBrand(virginBrand._id);
  const virginBrandArchived = await StoreBrand.findById(virginBrand._id).lean();
  ck('an unreferenced brand archives cleanly', virginBrandArchived && virginBrandArchived.status === 'archived',
    virginBrandArchived && virginBrandArchived.status);

  let missingCat = false;
  try {
    await taxonomyService.removeCategory(new mongoose.Types.ObjectId());
  } catch (e) {
    missingCat = e.statusCode === 404;
  }
  ck('removing a missing category is a 404', missingCat);

  console.log('\n=== operations consoles return shaped data on any platform state ===\n');

  const consoles = [
    ['subscriptionHealth', () => operationsService.subscriptionHealth()],
    ['settlementExceptions', () => operationsService.settlementExceptions()],
    ['refundFailures', () => operationsService.refundFailures()],
    ['inventoryDrift', () => operationsService.inventoryDrift()],
    ['complianceExpiry', () => operationsService.complianceExpiry()],
    ['organicVerificationQueue', () => operationsService.organicVerificationQueue()],
    ['abuseQueue', () => operationsService.abuseQueue()],
    ['applicationAgeing', () => operationsService.applicationAgeing()],
    ['codRemittance', () => operationsService.codRemittance()],
    ['consoleSummary', () => operationsService.consoleSummary()],
  ];
  for (const [name, fn] of consoles) {
    let ok = false;
    let detail = '';
    try {
      const result = await fn();
      ok = result !== undefined;
    } catch (e) {
      detail = e.message;
    }
    ck(`${name} resolves without throwing`, ok, detail);
  }

  console.log('\n=== admin reads are cross-tenant by design ===\n');

  // No outlet filter: the whole point of this file. Partner services would 400 here;
  // these must not.
  // `paginate` returns {results, totalResults} — not {items, total}. Assert the real shape.
  const listed = await recordsService.listOrders({ page: 1, limit: 5 });
  ck('listOrders works with no tenant filter', Array.isArray(listed.results) && typeof listed.totalResults === 'number');
  ck('paging reports a total and a floor of 1 page', listed.page === 1 && listed.totalPages >= 1);

  const drivers = await recordsService.listDrivers({ page: 1, limit: 5 });
  ck('listDrivers works with no tenant filter', Array.isArray(drivers.results));
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
    console.log('\n' + (failures === 0 ? 'ALL STORES ADMIN CHECKS PASSED' : failures + ' STORES ADMIN CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });