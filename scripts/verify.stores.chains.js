/**
 * LocalWala — Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.chains.js — the chain registry works, and the admin console reads a
 * truthful picture of the vertical.
 *
 * ## Why model tests, not request-handler tests
 *
 * The admin HTTP handlers sit behind `webAuth`, which is cookie-based and is the test
 * of a different file. What this suite must prove is the THING the handlers exist to
 * serve:
 *
 *   - a business can hold exactly one chain (the unique index), so two chains cannot
 *     both claim the same business
 *   - `outlets[]` and `outletCount` agree, or every "how many branches" number an admin
 *     sees is a lie
 *   - the catalogue-scope default is `shared`, because a per_outlet catalogue is an
 *     explicit, more expensive decision and must not be the silent default
 *   - a chain with nothing approved still reads `draft`, so a half-onboarded chain is
 *     never mistaken for a live one in the admin list
 *
 * Run: node scripts/verify.stores.chains.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const { StoreChain, StoreOutlet, Business } = require('../src/models');

let pass = 0;
let failures = 0;

const ck = (label, condition, detail) => {
  if (condition) {
    pass += 1;
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const run = async () => {
  console.log('\n=== StoreChain registry ===\n');

  const stamp = Date.now();
  const bizA = await Business.create({ name: 'Chain A ' + stamp, vertical: 'stores', status: true });
  const bizB = await Business.create({ name: 'Chain B ' + stamp, vertical: 'stores', status: true });

  // ---- 1. defaults and requireds ----------------------------------------------
  console.log('--- defaults ---');

  const chainA = await StoreChain.create({ business: bizA._id, name: 'Chain A ' + stamp, categories: [] });
  ck('1. a fresh chain defaults to draft status', chainA.status === 'draft', chainA.status);
  ck('1b. catalogueScope defaults to shared', chainA.catalogueScope === 'shared', chainA.catalogueScope);
  ck('1c. a fresh chain has no outlets recorded', chainA.outlets.length === 0 && chainA.outletCount === 0);
  ck('1d. slug auto-generates from the name', chainA.slug === ('chain-a-' + stamp).toLowerCase(), chainA.slug);

  // ---- 2. one business, exactly one chain -------------------------------------
  console.log('--- uniqueness ---');

  let second = 'created';
  try {
    await StoreChain.create({ business: bizA._id, name: 'Second Attempt', categories: [] });
  } catch (error) {
    second = error.code === 11000 ? 'E11000' : String(error.code || error.message);
  }
  ck('2. a second chain for the same business is a duplicate-key error', second === 'E11000', second);

  const other = await StoreChain.create({ business: bizB._id, name: 'Chain B ' + stamp, categories: [] });
  ck('2b. a DIFFERENT business can own its chain', !!other._id);

  // ---- 3. outlets and outletCount agree -----------------------------------------
  console.log('--- outlet accounting ---');

  const o1 = await StoreOutlet.create({ chain: chainA._id, outletCode: 'CH-A1-' + stamp, name: 'A one', location: { type: 'Point', coordinates: [77.4, 17.4] }, status: 'draft', operational: false });
  const o2 = await StoreOutlet.create({ chain: chainA._id, outletCode: 'CH-A2-' + stamp, name: 'A two', location: { type: 'Point', coordinates: [77.5, 17.5] }, status: 'active', operational: true });

  await StoreChain.updateOne(
    { _id: chainA._id },
    { $set: { outlets: [o1._id, o2._id], outletCount: 2, status: 'active' } }
  );

  const reloaded = await StoreChain.findById(chainA._id)
    .populate('outlets', 'name outletCode status')
    .lean();
  ck('3. populated outlets match the recorded count', reloaded.outlets.length === reloaded.outletCount && reloaded.outletCount === 2, `count=${reloaded.outletCount}, populated=${reloaded.outlets.length}`);
  ck('3b. the two outlet names resolve', reloaded.outlets.map((o) => o.name).sort().join(',') === 'A one,A two', reloaded.outlets.map((o) => o.name).join(','));

  // ---- 4. the filter shape the admin list uses ---------------------------------
  console.log('--- admin list filter/pagination ---');

  const byBusiness = await StoreChain.find({ business: bizA._id }).lean();
  ck('4. filtered by business, only that chain comes back', byBusiness.length === 1 && String(byBusiness[0].business) === String(bizA._id), byBusiness.length);

  const activeForA = await StoreChain.find({ status: 'active', business: bizA._id }).lean();
  ck('4b. status+business scoping isolates the active chain to this business', activeForA.length === 1 && String(activeForA[0]._id) === String(chainA._id), activeForA.length);

  const activeOnlyOneBusinessPartition = await StoreChain.find({ status: 'active', business: bizB._id }).lean();
  ck('4c. business B has no active chain (it is still draft)', activeOnlyOneBusinessPartition.length === 0, activeOnlyOneBusinessPartition.length);

  const page = await StoreChain.find({ status: 'active' }).sort({ createdAt: -1 }).skip(0).limit(1).lean();
  ck('4c. a page of one returns exactly one', page.length === 1);

  // ---- 5. status is explicit --------------------------------------------------
  console.log('--- status transitions ---');

  const bad = new StoreChain({ business: new mongoose.Types.ObjectId(), name: 'x', status: 'nonsense' });
  const err = bad.validateSync();
  ck('5. only the declared status values are valid', !!(err && err.errors.status), err && err.errors.status && err.errors.status.message);

  // ---- cleanup ----------------------------------------------------------------
  await StoreChain.deleteMany({ _id: { $in: [chainA._id, other._id] } });
  await StoreOutlet.deleteMany({ _id: { $in: [o1._id, o2._id] } });
  await Business.deleteMany({ _id: { $in: [bizA._id, bizB._id] } });

  console.log('\n' + pass + '/' + (pass + failures) + ' checks passed');
  if (failures === 0) {
    console.log('ALL CHAIN REGISTRY CHECKS PASSED');
  } else {
    console.log(failures + ' CHAIN CHECK(S) FAILED');
  }
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    await run();
    process.exit(failures === 0 ? 0 : 1);
  } catch (error) {
    console.error('chains suite could not run:', error.message);
    process.exit(1);
  }
})();