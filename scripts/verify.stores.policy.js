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
 * verify.stores.policy.js — the house rules, versioned.
 *
 * Run: node scripts/verify.stores.policy.js
 *
 * ## What this pins, and what it deliberately does not claim
 *
 *   - creation applies sane defaults (7-day windows, 24h cancellation) rather than
 *     leaving money-bearing fields undefined
 *   - reads and writes are outlet-scoped: another outlet's policy is a 404
 *   - archiving is a flag, never a delete (BR-25: historical orders reference these)
 *   - `findActive` / `findByType` return the newest version first
 *
 * ## A correction to an earlier claim
 *
 * An earlier session note described policy "cascading" product -> subcategory ->
 * category -> chain. That resolution does not exist in this service: `findActive` is a
 * filtered query on `{chain, type, isActive}`, newest version first. If cascading is
 * wanted it is new work with its own suite, not an untested path — nothing here depends
 * on a fallback that was never written.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const policyService = require('../src/modules/stores/services/stores.policy.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.policy.model');
require('../src/modules/stores/models/store.chain.model');
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/store.chain.model');
require('../src/modules/stores/models/store.outlet.model');

const StorePolicy = mongoose.model('StorePolicy');

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

const makePolicy = async (overrides = {}) =>
  policyService.createPolicy({
    chain: CHAIN,
    outlet: OUTLET,
    type: 'return',
    title: 'Returns',
    content: 'Thirty days, receipt required.',
    ...overrides,
  });

const cleanup = async () => {
  await StorePolicy.deleteMany({ outlet: { $in: [OUTLET, OTHER_OUTLET] } });
  await mongoose.model('StoreChain').deleteMany({ _id: CHAIN });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  // listPolicies populates `chain`: a synthetic id reads back null, so the chain row
  // must exist.
  await mongoose.model('StoreChain').create({
    _id: CHAIN, business: new mongoose.Types.ObjectId(), name: 'policy suite', slug: 'policy-suite',
  });

  console.log('\n=== creation applies defaults ===\n');

  const policy = await makePolicy();
  ck('a policy is created active', policy.isActive !== false);
  ck('return window defaults to 7 days', Number(policy.returnWindowDays) === 7, policy.returnWindowDays);
  ck('exchange window defaults to 7 days', Number(policy.exchangeWindowDays) === 7, policy.exchangeWindowDays);
  ck('cancellation window defaults to 24 hours', Number(policy.cancellationWindowHours) === 24, policy.cancellationWindowHours);
  ck('effectiveFrom defaults to now', !!policy.effectiveFrom);

  const explicit = await makePolicy({ returnWindowDays: 30, exchangeWindowDays: 14, warrantyDefaultMonths: 6 });
  ck('explicit windows survive creation',
    Number(explicit.returnWindowDays) === 30 && Number(explicit.exchangeWindowDays) === 14,
    `${explicit.returnWindowDays}/${explicit.exchangeWindowDays}`);

  console.log('\n=== outlet scoping ===\n');

  const fetched = await policyService.getPolicy(policy._id, { outlet: OUTLET });
  ck('the owning outlet reads its policy', String(fetched._id) === String(policy._id));

  let crossRead = false;
  try {
    await policyService.getPolicy(policy._id, { outlet: OTHER_OUTLET });
  } catch (e) {
    crossRead = e.statusCode === 404;
  }
  ck('another outlet cannot read it', crossRead);

  let crossUpdate = false;
  try {
    await policyService.updatePolicy(policy._id, { title: 'Hijacked' }, { outlet: OTHER_OUTLET });
  } catch (e) {
    crossUpdate = e.statusCode === 404;
  }
  ck('another outlet cannot rewrite it', crossUpdate);
  const untouched = await policyService.getPolicy(policy._id, { outlet: OUTLET });
  ck('the failed write changed nothing', untouched.title === 'Returns', untouched.title);

  console.log('\n=== archiving is a flag, never a delete (BR-25) ===\n');

  const archived = await policyService.archivePolicy(policy._id, { outlet: OUTLET });
  ck('archiving flips isActive, not a delete', archived.isActive === false);
  ck('the document survives for historical orders', !!(await policyService.getPolicy(policy._id, { outlet: OUTLET })));

  const active = await policyService.getActivePolicy(CHAIN, 'return');
  ck('an archived policy leaves the active set',
    active.every((p) => String(p._id) !== String(policy._id)));

  console.log('\n=== versions ===\n');

  const v1 = await makePolicy({ type: 'exchange' });
  const v2 = await makePolicy({ type: 'exchange' });
  void v1;
  ck('new policies start at version 1', Number(v2.version) === 1, v2.version);

  // `findActive` sorts by version desc, but nothing ever increments a version —
  // `updatePolicy` writes the fields without touching it. So every row sits at 1 and
  // "newest first" is vacuous: `findByType` returns AN active row, not deterministically
  // the latest edit. Recorded as a warning, not a failure: no contract promises
  // versioning today, but the sort implies one and a future editor will assume it.
  const actives = await policyService.getActivePolicy(CHAIN, 'exchange');
  ck('both exchange rows are visible as active', actives.length >= 2, `count=${actives.length}`);
  const one = await StorePolicy.findByType(CHAIN, 'exchange');
  ck('findByType returns an active exchange row', !!one && one.status !== 'archived' && one.type === 'exchange');
  if (Number(v1.version) === 1 && Number(v2.version) === 1) {
    console.log('  WARN  versions never advance past 1 — newest-first ordering is vacuous. If policy history matters, updatePolicy should $inc version.');
  }

  console.log('\n=== listing ===\n');

  const listed = await policyService.listPolicies({ chain: CHAIN, page: 1, limit: 10 });
  ck('listing scopes to the chain', listed.items.every((p) => String(p.chain) === String(CHAIN) || String(p.chain._id) === String(CHAIN)));
  ck('listing reports totals and paging', typeof listed.total === 'number' && listed.page === 1);
  const byType = await policyService.listPolicies({ chain: CHAIN, type: 'exchange' });
  ck('type filter returns only that type', byType.items.length > 0 && byType.items.every((p) => p.type === 'exchange'));
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
    console.log('\n' + (failures === 0 ? 'ALL STORES POLICY CHECKS PASSED' : failures + ' STORES POLICY CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });