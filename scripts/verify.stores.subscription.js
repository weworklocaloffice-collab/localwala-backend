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
 * verify.stores.subscription.js
 *
 * Covers StoreSubscription: chain-level scoping, money round-tripping, and the
 * index rules that only fail once a chain has been live for more than one period.
 *
 * The index tests are the reason this file exists as a database suite rather than a
 * pure unit test. A `unique: true` mistake here is invisible on day one — the first
 * subscription inserts cleanly — and then blocks every renewal from month two onward.
 * Nothing in a unit test with a mocked collection would have caught it.
 *
 * Run: node scripts/verify.stores.subscription.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const {
  StoreSubscription,
  StoreChain,
  Business,
  StoreOutlet,
} = require('../src/models');

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
  console.log('\n=== StoreSubscription ===\n');

  const stamp = Date.now();
  const business = await Business.create({
    name: 'Sub Test Co ' + stamp,
    vertical: 'stores',
    status: true,
  });
  const chain = await StoreChain.create({
    business: business._id,
    name: 'Sub Test Chain ' + stamp,
    categories: [],
    status: 'active',
  });
  const outlet = await StoreOutlet.create({
    chain: chain._id,
    outletCode: 'SUB-' + stamp,
    name: 'Subscription Test Outlet',
    location: { type: 'Point', coordinates: [77.4, 17.4] },
    status: 'active',
    operational: true,
  });

  // ---- 1. money round-trips through the model -------------------------------
  const sub = await StoreSubscription.create({
    chain: chain._id,
    business: business._id,
    plan: 'chain_pro',
    status: 'trial',
    amount: 2499,
    taxAmount: 449.82,
    totalAmount: 2948.82,
    trialDays: 14,
    trialEndsAt: new Date(Date.now() + 14 * 86400000),
    features: ['customerSubscriptions'],
  });

  const raw = sub.toObject();
  ck('1. amount 2499 is stored as 249900 paise', raw.amount === 249900, raw.amount);
  ck('1b. amount reads back as 2499', sub.amount === 2499, sub.amount);
  ck('1c. totalAmount 2948.82 reads back exactly', sub.totalAmount === 2948.82, sub.totalAmount);

  // ---- 2. status and the read-side trial backstop ----------------------------
  ck('2. status is trial', sub.status === 'trial');
  ck('2b. isLive is true for trial', sub.isLive === true);

  const live = StoreSubscription.hydrate({ status: 'active', endsAt: null });
  ck('2c. isLive true for active', live.isLive === true);
  const dead = StoreSubscription.hydrate({ status: 'suspended' });
  ck('2d. isLive false for suspended', dead.isLive === false);

  const trialFuture = StoreSubscription.hydrate({
    status: 'trial',
    trialEndsAt: new Date(Date.now() + 86400000),
  });
  ck('3. a live trial reports trial', trialFuture.effectiveStatus === 'trial', trialFuture.effectiveStatus);

  const trialOverdue = StoreSubscription.hydrate({
    status: 'trial',
    trialEndsAt: new Date(Date.now() - 1000),
  });
  ck(
    '3b. an OVERDUE trial reports expired without waiting for the sweeper',
    trialOverdue.effectiveStatus === 'expired',
    trialOverdue.effectiveStatus
  );

  const dunning = StoreSubscription.hydrate({ status: 'payment_due', trialEndsAt: new Date(Date.now() - 1) });
  ck(
    '3c. the trial backstop does not touch a dunning subscription',
    dunning.effectiveStatus === 'payment_due',
    dunning.effectiveStatus
  );

  // ---- 4. endsAt / cancelled semantics ---------------------------------------
  const cancelledPast = StoreSubscription.hydrate({
    status: 'cancelled',
    endsAt: new Date(Date.now() - 1000),
  });
  ck('4. cancelled with a past endsAt has ended', cancelledPast.hasEnded === true);

  const cancelledFuture = StoreSubscription.hydrate({
    status: 'cancelled',
    endsAt: new Date(Date.now() + 86400000),
  });
  ck('4b. cancelled with a future endsAt has NOT ended', cancelledFuture.hasEnded === false);

  const cancelledNoDate = StoreSubscription.hydrate({ status: 'cancelled' });
  ck('4c. cancelled with no endsAt has not ended', cancelledNoDate.hasEnded === false);

  // ---- 5. daysUntilDue -------------------------------------------------------
  const due = StoreSubscription.hydrate({ nextPaymentDueAt: new Date(Date.now() + 5 * 86400000) });
  ck('5. daysUntilDue is 5 for a payment due in five days', due.daysUntilDue === 5, due.daysUntilDue);

  const overdue = StoreSubscription.hydrate({ nextPaymentDueAt: new Date(Date.now() - 3 * 86400000) });
  ck('5b. daysUntilDue is negative when overdue', overdue.daysUntilDue === -3, overdue.daysUntilDue);

  const noDue = StoreSubscription.hydrate({});
  ck('5c. daysUntilDue is null with no due date', noDue.daysUntilDue === null, noDue.daysUntilDue);

  // ---- 6. ONE LIVE SUBSCRIPTION PER CHAIN ------------------------------------
  //
  // The month-two bug. A second live row must be refused by the partial index.
  let dupCode = 'no error';
  try {
    await StoreSubscription.create({
      chain: chain._id,
      business: business._id,
      plan: 'chain_pro',
      status: 'active',
      amount: 2499,
    });
  } catch (error) {
    dupCode = error.code === 11000 ? 'E11000' : String(error.code || error.message);
  }
  ck('6. a SECOND live subscription for one chain is refused', dupCode === 'E11000', dupCode);

  // A different chain is unaffected — the index is per chain, not global.
  const otherBusiness = await Business.create({
    name: 'Sub Test Co 2 ' + stamp,
    vertical: 'stores',
    status: true,
  });
  const otherChain = await StoreChain.create({
    business: otherBusiness._id,
    name: 'Sub Test Chain 2 ' + stamp,
    categories: [],
    status: 'active',
  });
  let otherChainOk = false;
  try {
    await StoreSubscription.create({
      chain: otherChain._id,
      business: otherBusiness._id,
      plan: 'chain_pro',
      status: 'active',
      amount: 2499,
    });
    otherChainOk = true;
  } catch (error) {
    otherChainOk = false;
  }
  ck('6b. a different chain may hold its own live subscription', otherChainOk);

  // ---- 7. renewal after cancel MUST be possible ------------------------------
  //
  // The other half of the month-two bug. Cancelled rows are historical, so they must
  // not collide with the new live row. A plain unique index on `chain` would pass test
  // 6 and fail here.
  await StoreSubscription.updateOne(
    { _id: sub._id },
    { $set: { status: 'cancelled', cancelledAt: new Date(), endsAt: new Date() } }
  );

  let renewed = 'failed';
  try {
    const second = await StoreSubscription.create({
      chain: chain._id,
      business: business._id,
      plan: 'chain_pro_renewed',
      status: 'active',
      amount: 2999,
    });
    renewed = second && second._id ? 'created' : 'failed';
  } catch (error) {
    renewed = 'FAILED ' + (error.code || error.message);
  }
  ck('7. a renewal after cancel CAN be created', renewed === 'created', renewed);

  const total = await StoreSubscription.countDocuments({ chain: chain._id });
  ck('7b. the chain keeps both rows as history', total === 2, total);

  // ---- 8. lookups used by the lifecycle service ------------------------------
  const viaOutlet = await StoreSubscription.forOutlet(outlet);
  ck('8. forOutlet resolves through the outlet chain', !!viaOutlet, JSON.stringify(viaOutlet));

  const unsubscribed = await StoreSubscription.forOutlet({
    chain: new mongoose.Types.ObjectId(),
  });
  ck(
    '8b. an unsubscribed chain returns null, which the caller reads as expired',
    unsubscribed === null,
    String(unsubscribed)
  );

  const history = await StoreSubscription.historyForChain(chain._id);
  ck('8c. history returns newest first', history.length === 2 && history[0].plan === 'chain_pro_renewed',
     history.map((h) => h.plan).join(','));

  const dunningRows = await StoreSubscription.dueForDunning(new Date());
  ck(
    '8d. the dunning sweep returns only dunning statuses',
    dunningRows.every((r) => ['payment_due', 'retrying', 'grace_period'].includes(r.status)),
    dunningRows.map((r) => r.status).join(',')
  );

  const trials = await StoreSubscription.expiringTrials(new Date());
  ck(
    '8e. the trial sweeper returns only trials past their end',
    trials.every((t) => t.status === 'trial'),
    trials.map((t) => t.status).join(',')
  );

  // ---- 9. chain-level, never outlet-level ------------------------------------
  const schemaPaths = Object.keys(StoreSubscription.schema.paths);
  ck('9. the schema has NO outlet field (one bill per chain)', !schemaPaths.includes('outlet'), schemaPaths.join(','));
  ck('9b. the schema keys on chain', schemaPaths.includes('chain'));

  await StoreSubscription.deleteMany({ chain: { $in: [chain._id, otherChain._id] } });
  await StoreOutlet.deleteMany({ chain: { $in: [chain._id, otherChain._id] } });
  await StoreChain.deleteMany({ _id: { $in: [chain._id, otherChain._id] } });
  await Business.deleteMany({ _id: { $in: [business._id, otherBusiness._id] } });

  console.log('\n' + pass + '/' + (pass + failures) + ' checks passed');
  if (failures === 0) {
    console.log('ALL SUBSCRIPTION CHECKS PASSED');
  } else {
    console.log(failures + ' SUBSCRIPTION CHECK(S) FAILED');
  }
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    await mongoose.syncIndexes().catch(() => {});
    await run();
    process.exit(failures === 0 ? 0 : 1);
  } catch (error) {
    console.error('subscription suite could not run:', error.message);
    process.exit(1);
  }
})();