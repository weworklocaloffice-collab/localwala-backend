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
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.lifecycle.js — proves the chain and outlet lifecycle, the BR-32
 * suspension capability matrix, the failed-renewal ladder, the activation guards and
 * the onboarding step-completeness rules.
 *
 * The exhaustive part is the transition table: every LEGAL move must be accepted and
 * every ILLEGAL move must be refused. That is 24 + 86 cases, so a typo in the table
 * cannot hide.
 *
 * Run: node scripts/verify.stores.lifecycle.js
 */

const mongoose = require('mongoose');
require('dotenv').config();
const models = require('../src/models');
const lifecycle = require('../src/modules/stores/services/stores.lifecycle.service');
const onboarding = require('../src/modules/stores/services/stores.onboarding.service');
const profile = require('../src/modules/stores/services/stores.profile.service');

let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else { fail += 1; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
};

const run = async () => {
  console.log('\n=== lifecycle transitions ===\n');

  // every legal move
  const legal = [];
  for (const [from, targets] of Object.entries(lifecycle.LIFECYCLE_TRANSITIONS)) {
    for (const to of targets) legal.push([from, to]);
  }
  let bad = 0;
  for (const [from, to] of legal) {
    try { lifecycle.assertTransition(from, to); } catch (e) { bad += 1; }
  }
  ok('every declared legal move is accepted (' + legal.length + ')', bad === 0, bad + ' rejected');

  // every illegal move is refused
  const states = Object.keys(lifecycle.LIFECYCLE_TRANSITIONS);
  const legalSet = new Set(legal.map(([f, t]) => f + '->' + t));
  let leaks = 0;
  for (const from of states) {
    for (const to of states) {
      if (from === to) continue;
      if (legalSet.has(from + '->' + to)) continue;
      let threw = false;
      try { lifecycle.assertTransition(from, to); } catch (e) { threw = true; }
      if (!threw) { leaks += 1; console.log('        LEAK: ' + from + ' -> ' + to + ' was allowed'); }
    }
  }
  ok('no illegal move is accepted (' + (states.length * (states.length - 1) - legal.length) + ' tested)', leaks === 0, leaks + ' leaks');

  // the ones that must never be legal
  const forbidden = [
    ['a suspended outlet going straight to active (needs reactivated)', 'suspended', 'active'],
    ['draft jumping to active (no review, no payment)', 'draft', 'active'],
    ['submitted jumping to active', 'submitted', 'active'],
    ['under_review jumping to subscription_payment (no approval)', 'under_review', 'subscription_payment'],
    ['approved jumping to active (no payment)', 'approved', 'active'],
    ['archived is terminal', 'archived', 'active'],
    ['rejected cannot become active', 'rejected', 'active'],
  ];
  for (const [label, from, to] of forbidden) {
    let threw = false;
    try { lifecycle.assertTransition(from, to); } catch (e) { threw = true; }
    ok('refuses ' + label, threw);
  }

  // message quality: an operator has to be able to act on it
  try { lifecycle.assertTransition('active', 'draft'); } catch (e) {
    ok('illegal message names what IS allowed', e.message.includes('Allowed from active:'), e.message);
    ok('illegal message carries a machine-readable allowed list', Array.isArray(e.extra && e.extra.allowed));
  }

  console.log('\n=== suspension reasons ===\n');
  ok('7 reason codes', lifecycle.SUSPENSION_REASONS.length === 7);
  ok('includes expired_subscription', lifecycle.SUSPENSION_REASONS.includes('expired_subscription'));
  ok('includes fraud', lifecycle.SUSPENSION_REASONS.includes('fraud'));

  console.log('\n=== BR-32 capability matrix ===\n');
  const expect = {
    trial:        { acceptNewOrders: true,  manageCatalogue: true,  fulfilExisting: true, readSettlements: true, banner: null },
    active:       { acceptNewOrders: true,  manageCatalogue: true,  fulfilExisting: true, readSettlements: true, banner: null },
    payment_due:  { acceptNewOrders: true,  manageCatalogue: true,  fulfilExisting: true, banner: 'SUBSCRIPTION_PAST_DUE' },
    retrying:     { acceptNewOrders: true,  manageCatalogue: true,  fulfilExisting: true, banner: 'SUBSCRIPTION_PAST_DUE' },
    grace_period: { acceptNewOrders: false, manageCatalogue: true,  fulfilExisting: true, banner: 'SUBSCRIPTION_GRACE_PERIOD' },
    suspended:    { acceptNewOrders: false, manageCatalogue: false, fulfilExisting: true, banner: 'SUBSCRIPTION_SUSPENDED' },
    cancelled:    { acceptNewOrders: false, manageCatalogue: false, fulfilExisting: true, banner: 'SUBSCRIPTION_SUSPENDED' },
    expired:      { acceptNewOrders: false, manageCatalogue: false, fulfilExisting: true, banner: 'SUBSCRIPTION_SUSPENDED' },
  };
  for (const [state, want] of Object.entries(expect)) {
    const caps = lifecycle.capabilitiesFor(state);
    for (const [k, v] of Object.entries(want)) {
      ok('  ' + state.padEnd(13) + ' ' + k.padEnd(16) + ' = ' + v, caps[k] === v, 'got ' + caps[k]);
    }
    ok('  ' + state.padEnd(13) + ' viewDashboard always true', caps.viewDashboard === true);
    ok('  ' + state.padEnd(13) + ' FULFILMENT never blocked', caps.fulfilExisting === true);
  }

  console.log('\n=== subscription ladder (BR-15, BR-16) ===\n');
  const ladder = [
    ['trial', 'active'], ['active', 'payment_due'], ['payment_due', 'retrying'],
    ['retrying', 'active'], ['retrying', 'grace_period'], ['grace_period', 'active'],
    ['grace_period', 'suspended'], ['suspended', 'active'], ['suspended', 'expired'],
    ['active', 'cancelled'], ['cancelled', 'active'],
  ];
  let ladderBad = 0;
  for (const [f, t] of ladder) {
    try { lifecycle.assertSubscriptionTransition(f, t); } catch (e) { ladderBad += 1; }
  }
  ok('the whole retry ladder is walkable (' + ladder.length + ' steps)', ladderBad === 0, ladderBad + ' broken');
  let ladderLeaks = 0;
  for (const f of Object.keys(lifecycle.SUBSCRIPTION_TRANSITIONS)) {
    for (const t of Object.keys(lifecycle.SUBSCRIPTION_TRANSITIONS)) {
      if (f === t) continue;
      if ((lifecycle.SUBSCRIPTION_TRANSITIONS[f] || []).includes(t)) continue;
      let threw = false;
      try { lifecycle.assertSubscriptionTransition(f, t); } catch (e) { threw = true; }
      if (!threw) ladderLeaks += 1;
    }
  }
  ok('no illegal subscription move accepted', ladderLeaks === 0, ladderLeaks + ' leaks');
  let expiredLeak = false;
  try { lifecycle.assertSubscriptionTransition('expired', 'active'); } catch (e) { expiredLeak = true; }
  ok('expired -> active is legal (a lapsed partner may rejoin)', !expiredLeak);

  console.log('\n=== activation guards ===\n');
  const id = () => new mongoose.Types.ObjectId();
  let guards = 0;
  const expectFail = async (label, input) => {
    try { await lifecycle.assertCanBecomeActive(input); } catch (e) { guards += 1; return; }
    fail += 1;
    console.log('  FAIL  ' + label + ' -> should have thrown');
  };
  await expectFail('no chain approved', {
    chain: { status: 'draft' }, outlet: { status: 'subscription_payment', categories: [id()], location: { coordinates: [1, 2] }, taxIdentity: { gstin: 'X' } }, mandatoryDocuments: [],
  });
  await expectFail('no map pin', {
    chain: { status: 'approved' }, outlet: { status: 'subscription_payment', categories: [id()], taxIdentity: { gstin: 'X' } }, mandatoryDocuments: [],
  });
  await expectFail('no category', {
    chain: { status: 'approved' }, outlet: { status: 'subscription_payment', categories: [], location: { coordinates: [1, 2] }, taxIdentity: { gstin: 'X' } }, mandatoryDocuments: [],
  });
  await expectFail('no GSTIN (BR-42)', {
    chain: { status: 'approved' }, outlet: { status: 'subscription_payment', categories: [id()], location: { coordinates: [1, 2] }, taxIdentity: {} }, mandatoryDocuments: [],
  });
  await expectFail('mandatory document unapproved', {
    chain: { status: 'approved' }, outlet: { status: 'subscription_payment', categories: [id()], location: { coordinates: [1, 2] }, taxIdentity: { gstin: 'X' } }, mandatoryDocuments: [{ type: 'trade_licence', status: 'pending' }],
  });
  ok('5 of 6 activation guards fire', guards === 5, guards + ' fired');

  let passed = false;
  try {
    await lifecycle.assertCanBecomeActive({
      chain: { status: 'approved' },
      outlet: { status: 'subscription_payment', categories: [id()], location: { coordinates: [1, 2] }, taxIdentity: { gstin: '29ABCDE1234F1Z5' } },
      mandatoryDocuments: [{ type: 'trade_licence', status: 'approved' }],
    });
    passed = true;
  } catch (e) { console.log('        ' + e.message + ' ' + JSON.stringify(e.extra)); }
  ok('a fully complete application is allowed to activate', passed);

  console.log('\n=== onboarding step completeness ===\n');
  const blank = { businessInfo: {}, storeInfo: {}, ownerInfo: {}, location: {}, documents: [], deliveryConfig: {} };
  ok('a blank draft has all 6 steps incomplete', onboarding.computeIncompleteSteps(blank).length === 6);
  const full = {
    businessInfo: { legalName: 'ABC', businessType: 'private_limited' },
    storeInfo: { name: 'ABC', categories: [id()] },
    ownerInfo: { name: 'R', mobile: 9999999999, relation: 'director' },
    location: { city: id(), locality: id(), geo: { coordinates: [77.5, 12.9] } },
    documents: [id()],
    deliveryConfig: { radiusKm: 5, minimumOrder: 0, deliveryFee: 30 },
  };
  ok('a fully filled draft has none incomplete', onboarding.computeIncompleteSteps(full).length === 0,
     JSON.stringify(onboarding.computeIncompleteSteps(full)));
  const partial = { ...full, storeInfo: { name: 'ABC', categories: [] } };
  ok('a missing category marks step 1 only', JSON.stringify(onboarding.computeIncompleteSteps(partial)) === '[1]',
     JSON.stringify(onboarding.computeIncompleteSteps(partial)));
  const noPin = { ...full, location: { ...full.location, geo: { coordinates: [77.5] } } };
  ok('a one-coordinate pin does NOT satisfy location', onboarding.computeIncompleteSteps(noPin).includes(3));

  console.log('\n=== invoice series (BR-43) ===\n');
  ok('financial year Apr-Mar', onboarding.currentFinancialYear(new Date(2026, 3, 1)) === '2026-27');
  ok('before April rolls back', onboarding.currentFinancialYear(new Date(2026, 2, 28)) === '2025-26');
  ok('December is in the same FY', onboarding.currentFinancialYear(new Date(2026, 11, 25)) === '2026-27');
  ok('following January advances', onboarding.currentFinancialYear(new Date(2027, 0, 5)) === '2026-27');

  console.log('\n--- summary ---');
  console.log(fail === 0 ? 'ALL LIFECYCLE AND ONBOARDING CHECKS PASSED' : fail + ' CHECK(S) FAILED');
  return fail;
};

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);
    const f = await run();
    process.exit(f === 0 ? 0 : 1);
  } catch (e) {
    console.error('could not run:', e.message);
    process.exit(1);
  }
})();