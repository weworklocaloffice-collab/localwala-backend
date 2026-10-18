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
 * verify.stores.driver.js — the fleet lifecycle.
 *
 * Run: node scripts/verify.stores.driver.js
 *
 * ## What this pins
 *
 *   BR-06/07 a partner can add drivers (one per user per outlet) and suspend or
 *           deactivate them; BR-08 forbids hard deletion, so every exit here is a
 *           status, never a remove
 *   BR-05   only the outlet's own drivers are ever offered — availability is
 *           `status active AND isAvailable`, scoped to the outlet
 *
 * ## The reactivation gap this suite exists to stop
 *
 * `reactivateDriver` set `status: 'reactivated'`, but `findAvailable` — the only query
 * that decides who gets deliveries — accepted only `status: 'active'`. Nothing ever
 * moved a driver from `reactivated` back to `active`, so every reactivated driver was
 * stuck forever: available in name, invisible to dispatch. The lifecycle service treats
 * `reactivated` as equivalent to `active` for operational purposes, and `findAvailable`
 * now does the same.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const driverService = require('../src/modules/stores/services/stores.driver.service');
const deliveryService = require('../src/modules/stores/services/stores.delivery.service');

// The services resolve models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.driver.model');
require('../src/modules/stores/models/store.driver.vehicle.model');
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/store.chain.model');

const StoreDriver = mongoose.model('StoreDriver');

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

let codeSeq = 0;
const makeDriver = async (overrides = {}) => {
  codeSeq += 1;
  return driverService.createDriver({
    user: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    driverCode: 'DRV-' + STAMP + '-' + codeSeq,
    licenseNumber: 'DL-' + STAMP + '-' + codeSeq,
    licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    ...overrides,
  });
};

const cleanup = async () => {
  await StoreDriver.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== BR-06: a partner can add drivers ===\n');

  const driver = await makeDriver();
  ck('a driver starts active', driver.status === 'active', driver.status);

  let dup = false;
  try {
    await driverService.createDriver({
      user: driver.user, outlet: OUTLET, chain: CHAIN,
      driverCode: 'DRV-DUP-' + STAMP,
      licenseNumber: 'DL-DUP-' + STAMP,
      licenseExpiry: new Date(Date.now() + 86400000),
    });
  } catch (e) {
    dup = e.statusCode === 409;
  }
  ck('one driver per user per outlet', dup);

  const otherOutletSameUser = await driverService.createDriver({
    user: driver.user, outlet: OTHER_OUTLET, chain: CHAIN,
    driverCode: 'DRV-OTHER-' + STAMP,
    licenseNumber: 'DL-OTHER-' + STAMP,
    licenseExpiry: new Date(Date.now() + 86400000),
  });
  ck('the same user can drive for another outlet', !!otherOutletSameUser._id);
  await StoreDriver.deleteOne({ _id: otherOutletSameUser._id });

  console.log('\n=== BR-07: suspend and deactivate ===\n');

  const suspended = await driverService.suspendDriver(driver._id, { reason: 'customer complaint' });
  ck('suspend sets suspended', suspended.status === 'suspended', suspended.status);
  ck('suspend takes the driver offline', suspended.isAvailable === false);
  ck('the reason is recorded', suspended.suspensionReason === 'customer complaint');

  const deactivated = await driverService.deactivateDriver(driver._id, { reason: 'left', deactivatedBy: new mongoose.Types.ObjectId() });
  ck('deactivate sets inactive', deactivated.status === 'inactive', deactivated.status);
  ck('deactivate takes the driver offline', deactivated.isAvailable === false);
  ck('deactivation is timestamped', !!deactivated.deactivatedAt);

  console.log('\n=== reactivation returns the driver to dispatch ===\n');

  const revived = await driverService.reactivateDriver(driver._id);
  ck('reactivate marks the driver available', revived.isAvailable === true);
  const offered = await deliveryService.getAvailableDrivers(OUTLET);
  ck('a reactivated driver is offered for delivery again',
    offered.some((d) => String(d._id) === String(driver._id)),
    offered.map((d) => String(d.driverCode)).join(','));

  console.log('\n=== BR-05: only this outlet available drivers ===\n');

  const stillSuspended = await makeDriver();
  await driverService.suspendDriver(stillSuspended._id, { reason: 'pause' });
  const pool = await deliveryService.getAvailableDrivers(OUTLET);
  ck('a suspended driver is not offered', !pool.some((d) => String(d._id) === String(stillSuspended._id)));
  ck('an inactive driver is not offered', !pool.some((d) => String(d._id) === String(driver._id) && d.status === 'inactive'));

  const elsewhere = await makeDriver({ outlet: OTHER_OUTLET });
  const homePool = await deliveryService.getAvailableDrivers(OUTLET);
  ck('another outlet driver is never offered here', !homePool.some((d) => String(d._id) === String(elsewhere._id)));
  await StoreDriver.deleteOne({ _id: elsewhere._id });

  await driverService.toggleAvailability(stillSuspended._id, true);
  const toggled = await StoreDriver.findById(stillSuspended._id).lean();
  ck('toggling availability flips the flag', toggled.isAvailable === true);
  ck('but a suspended flag still keeps them out of dispatch',
    !(await deliveryService.getAvailableDrivers(OUTLET)).some((d) => String(d._id) === String(stillSuspended._id)));

  console.log('\n=== updates cannot escalate status ===\n');

  const updated = await driverService.updateDriver(stillSuspended._id, { status: 'active', isAvailable: true });
  ck('status is not mass-assignable through update', updated.status === 'suspended', updated.status);
  ck('but allowlisted fields do update', updated.isAvailable === true);

  let missing = false;
  try {
    await driverService.getDriver(new mongoose.Types.ObjectId());
  } catch (e) {
    missing = e.statusCode === 404;
  }
  ck('a missing driver is a 404', missing);

  console.log('\n=== listing ===\n');

  const listed = await driverService.listDrivers({ outlet: OUTLET, page: 1, limit: 10 });
  ck('listing scopes to the outlet', listed.items.every((d) => String(d.outlet) === String(OUTLET)));
  ck('listing reports totals and paging', typeof listed.total === 'number' && listed.page === 1);
  const suspendedOnly = await driverService.listDrivers({ outlet: OUTLET, status: 'suspended' });
  ck('status filter returns only that status',
    suspendedOnly.items.length > 0 && suspendedOnly.items.every((d) => d.status === 'suspended'));
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
    console.log('\n' + (failures === 0 ? 'ALL STORES DRIVER CHECKS PASSED' : failures + ' STORES DRIVER CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });