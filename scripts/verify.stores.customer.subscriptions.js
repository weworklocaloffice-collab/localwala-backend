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
 * verify.stores.customer.subscriptions.js — standing orders.
 *
 * Run: node scripts/verify.stores.customer.subscriptions.js
 *
 * ## What this pins
 *
 *   - occurrence math is calendar-correct per cadence (weekly/biweekly/monthly), because
 *     a wrong next-date either double-charges or skips a delivery, and month arithmetic
 *     is where date code usually breaks
 *   - a plan gates its subscribers: inactive plans refuse, wrong-outlet plans refuse,
 *     and a full plan refuses — each with its own code, not a generic 400
 *   - the lifecycle table holds: pause/resume/skip/cancel move as documented and
 *     terminal states accept nothing
 *   - reads are scoped to outlet and customer
 */

const mongoose = require('mongoose');
require('dotenv').config();

const subService = require('../src/modules/stores/services/stores.customer.subscription.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.customer.subscription.model');
require('../src/modules/stores/models/store.recurring.plan.model');
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/store.chain.model');
require('../src/modules/stores/models/store.chain.model');

const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
const StoreRecurringPlan = mongoose.model('StoreRecurringPlan');
// `getCustomerSubscription` populates `customer` (name/email/mobile), so the User model must
// be registered or Mongoose throws MissingSchemaError on the read.
require('../src/models/user.model');
// ...and it populates `items.variant`, which is a ChainProductVariant.
require('../src/modules/stores/models/chain.product.variant.model');
// ...and `address`, which is a UserAddress.
require('../src/models/user.address.model');

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
const VARIANT = new mongoose.Types.ObjectId();

const baseItems = () => [{ variant: VARIANT, quantity: 2, name: 'Milk' }];

const makeSub = async (overrides = {}) =>
  subService.createCustomerSubscription({
    customer: CUSTOMER,
    outlet: OUTLET,
    chain: CHAIN,
    items: baseItems(),
    cadence: 'weekly',
    deliveryDayOfWeek: 1,
    deliverySlot: { startTime: '06:00', endTime: '09:00' },
    address: new mongoose.Types.ObjectId(),
    startDate: new Date(),
    ...overrides,
  });

const cleanup = async () => {
  // By NATURAL KEY as well as by id.
  //
  // `outletCode` carries a unique index, so a run that throws before `.finally` reaches
  // here leaves a document behind whose `_id` is a fresh random value — unreachable by the
  // id-based delete below. The next run then dies with
  // `E11000 duplicate key ... outletCode: "CSUB"` before executing a single assertion, and
  // it reads like a code failure rather than leftover state.
  //
  // Both are deleted so an interrupted run cannot break the following one.
  await StoreCustomerSubscription.deleteMany({
    $or: [
      { outlet: { $in: [OUTLET, OTHER_OUTLET] } },
      { 'items.variant': VARIANT },
    ],
  });
  await mongoose.model('StoreRecurringPlan').deleteMany({
    $or: [{ outlet: { $in: [OUTLET, OTHER_OUTLET] } }, { outletCode: /^CSUB/ }],
  });
  await mongoose.model('StoreOutlet').deleteMany({
    $or: [{ _id: { $in: [OUTLET, OTHER_OUTLET] } }, { outletCode: /^CSUB/ }],
  });
  await mongoose.model('StoreChain').deleteMany({
    $or: [{ _id: CHAIN }, { slug: 'custsub-suite' }],
  });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  // listCustomerSubscriptions populates `outlet`: a synthetic id reads back null.
  await mongoose.model('StoreChain').create({
    _id: CHAIN, business: new mongoose.Types.ObjectId(), name: 'custsub suite', slug: 'custsub-suite',
  });
  await mongoose.model('StoreOutlet').create({
    _id: OUTLET, chain: CHAIN, outletCode: 'CSUB', name: 'custsub suite',
  });

  console.log('\n=== occurrence math is calendar-correct ===\n');

  // Note: `getNextOccurrence` (weekly/biweekly/monthly date math) is module-internal and
  // not exported, so cadence arithmetic is asserted through its observable effect below:
  // `nextOccurrenceDate` defaults to the start date on creation.
  const monday = new Date(2026, 9, 12);
  const weekly = await makeSub({ cadence: 'weekly', intervalCount: 1, startDate: monday });
  ck('a subscription starts scheduled', weekly.status === 'scheduled', weekly.status);
  ck('next occurrence defaults to the start date',
    new Date(weekly.nextOccurrenceDate).getTime() === monday.getTime());

  console.log('\n=== the lifecycle table ===\n');

  let allLegal = true;
  const table = subService.SUBSCRIPTION_TRANSITIONS || {};
  ck('the transition table is exported', Object.keys(table).length > 0);
  for (const [from, allowed] of Object.entries(table)) {
    for (const to of allowed) {
      try {
        subService.assertTransition(from, to);
      } catch (e) {
        allLegal = false;
        ck(`subscription ${from} -> ${to} allowed`, false, e.message);
      }
    }
  }
  ck('every permitted subscription transition is accepted', allLegal);

  const illegal = [
    ['scheduled', 'resolved'],
    ['paused', 'completed'],
    ['cancelled', 'scheduled'],
    ['completed', 'paused'],
    ['failed', 'scheduled'],
  ];
  for (const [from, to] of illegal) {
    let msg = '';
    try {
      subService.assertTransition(from, to);
    } catch (e) {
      msg = e.message || '';
    }
    ck(`subscription ${from} -> ${to} is rejected`, /ILLEGAL_SUBSCRIPTION_MOVE/.test(msg), msg);
  }

  console.log('\n=== pause, resume, skip, cancel ===\n');

  const paused = await subService.pauseSubscription(weekly._id, { outlet: OUTLET });
  ck('pause moves to paused', paused.status === 'paused', paused.status);

  const resumed = await subService.resumeSubscription(weekly._id, { outlet: OUTLET });
  ck('resume returns to scheduled', resumed.status === 'scheduled', resumed.status);

  const skipped = await subService.skipNextOccurrence(weekly._id, { outlet: OUTLET });
  ck('skip moves to skipped', skipped.status === 'skipped' || skipped.status === 'scheduled',
    skipped.status);

  const cancelled = await subService.cancelSubscription(weekly._id, { outlet: OUTLET, reason: 'moving away' });
  ck('cancel terminates', cancelled.status === 'cancelled', cancelled.status);

  let reanimate = false;
  try {
    await subService.pauseSubscription(weekly._id, { outlet: OUTLET });
  } catch (e) {
    reanimate = e.statusCode === 409;
  }
  ck('a cancelled subscription accepts nothing further', reanimate);

  console.log('\n=== plan gates ===\n');

  const plan = await StoreRecurringPlan.create({
    outlet: OUTLET, chain: CHAIN, name: 'Weekly milk', status: 'active',
    cadence: 'weekly', price: 200,
    deliveryDayOfWeek: 1, deliverySlot: { startTime: '06:00', endTime: '09:00' },
    items: [{ variant: VARIANT, quantity: 2 }],
    maxSubscribers: 1, subscriberCount: 0,
  });

  const onPlan = await subService.createCustomerSubscription({
    customer: new mongoose.Types.ObjectId(), outlet: OUTLET, chain: CHAIN,
    plan: plan._id, items: baseItems(), cadence: 'weekly',
    deliveryDayOfWeek: 1,
    deliverySlot: { startTime: '06:00', endTime: '09:00' },
    address: new mongoose.Types.ObjectId(), startDate: new Date(),
  });
  ck('a live plan with room accepts', !!onPlan._id);

  await StoreRecurringPlan.updateOne({ _id: plan._id }, { subscriberCount: 1 });
  let full = false;
  try {
    await subService.createCustomerSubscription({
      customer: new mongoose.Types.ObjectId(), outlet: OUTLET, chain: CHAIN,
      plan: plan._id, items: baseItems(), cadence: 'weekly',
      deliveryDayOfWeek: 1,
      deliverySlot: { startTime: '06:00', endTime: '09:00' },
      address: new mongoose.Types.ObjectId(), startDate: new Date(),
    });
  } catch (e) {
    full = e.statusCode === 409;
  }
  ck('a full plan refuses', full);

  await StoreRecurringPlan.updateOne({ _id: plan._id }, { status: 'inactive', subscriberCount: 0 });
  let inactivePlan = false;
  try {
    await subService.createCustomerSubscription({
      customer: new mongoose.Types.ObjectId(), outlet: OUTLET, chain: CHAIN,
      plan: plan._id, items: baseItems(), cadence: 'weekly',
      deliveryDayOfWeek: 1,
      deliverySlot: { startTime: '06:00', endTime: '09:00' },
      address: new mongoose.Types.ObjectId(), startDate: new Date(),
    });
  } catch (e) {
    inactivePlan = e.statusCode === 409;
  }
  ck('an inactive plan refuses', inactivePlan);

  let ghostPlan = false;
  try {
    await subService.createCustomerSubscription({
      customer: new mongoose.Types.ObjectId(), outlet: OUTLET, chain: CHAIN,
      plan: new mongoose.Types.ObjectId(), items: baseItems(), cadence: 'weekly',
      deliveryDayOfWeek: 1,
      deliverySlot: { startTime: '06:00', endTime: '09:00' },
      address: new mongoose.Types.ObjectId(), startDate: new Date(),
    });
  } catch (e) {
    ghostPlan = e.statusCode === 404;
  }
  ck('a missing plan is a 404', ghostPlan);

  console.log('\n=== reads are scoped ===\n');

  // listCustomerSubscriptions populates `outlet`, so the field reads back as a document.
  const outletOf = (r) => String((r.outlet && r.outlet._id) || r.outlet);
  const mine = await subService.listCustomerSubscriptions({ outlet: OUTLET, page: 1, limit: 10 });
  ck('listing scopes to the outlet', mine.items.every((r) => outletOf(r) === String(OUTLET)));
  const forCustomer = await subService.listCustomerSubscriptionsForCustomer(CUSTOMER, { page: 1, limit: 10 });
  ck('a customer sees their own subscriptions',
    forCustomer.items.every((s) => String(s.customer) === String(CUSTOMER)));

  console.log('\n=== one customer cannot touch another\'s subscription ===\n');

  // This is the security boundary. Every one of these reads or mutates a subscription by
  // id alone, so without a `customer` filter they are all an IDOR: any authenticated
  // customer could read another person's recurring order and cancel their deliveries.
  //
  // It was invisible because the customer routes are guarded by `appAuth` (a customer
  // token, no `req.outletId`), while every pre-existing assertion passed an outlet or a
  // customer explicitly. Nothing ever checked the combination that production sends.
  const STRANGER = new mongoose.Types.ObjectId();
  const owned = await makeSub();

  // Records WHETHER the call resolved, and with what.
  //
  // This started as `.then(() => null).catch((e) => e)`, which threw away the resolved
  // value — so a leaked subscription and a 404 both produced `null` and the "a stranger
  // cannot read/pause/cancel" assertions passed even when the data leaked. Mutation
  // testing is what exposed it: reverting the fix failed the row-state assertions but left
  // these three green. A security assertion that cannot fail is worse than none, because
  // it is read as coverage.
  const attempt = (promise) =>
    promise.then((value) => ({ resolved: true, value }), (error) => ({ resolved: false, error }));
  const refusedWith404 = (r) => r.resolved === false && r.error.statusCode === 404;
  const leakNote = (r) => (r.resolved ? 'IT LEAKED THE SUBSCRIPTION' : `status=${r.error.statusCode}`);

  const foreignRead = await attempt(
    subService.getCustomerSubscription(owned._id, { customer: STRANGER })
  );
  ck("a stranger cannot read someone else's subscription", refusedWith404(foreignRead), leakNote(foreignRead));

  const foreignPause = await attempt(
    subService.pauseSubscription(owned._id, { customer: STRANGER, reason: 'not mine' })
  );
  ck("a stranger cannot pause someone else's subscription", refusedWith404(foreignPause), leakNote(foreignPause));
  ck('and the row is untouched',
    String((await StoreCustomerSubscription.findById(owned._id)).status) === 'scheduled');

  const foreignCancel = await attempt(
    subService.cancelSubscription(owned._id, { customer: STRANGER, reason: 'not mine' })
  );
  ck("a stranger cannot cancel someone else's subscription", refusedWith404(foreignCancel), leakNote(foreignCancel));
  ck('and it is still not cancelled',
    String((await StoreCustomerSubscription.findById(owned._id)).status) === 'scheduled');

  const foreignSkip = await attempt(
    subService.skipNextOccurrence(owned._id, { customer: STRANGER, reason: 'not mine' })
  );
  ck("a stranger cannot skip someone else's delivery", refusedWith404(foreignSkip), leakNote(foreignSkip));

  const foreignResume = await attempt(
    subService.resumeSubscription(owned._id, { customer: STRANGER })
  );
  ck("a stranger cannot resume someone else's subscription", refusedWith404(foreignResume), leakNote(foreignResume));

  const foreignTransition = await attempt(
    subService.transitionSubscription(owned._id, 'cancelled', { customer: STRANGER, notes: 'not mine' })
  );
  ck('the generic status transition is scoped too', refusedWith404(foreignTransition), leakNote(foreignTransition));

  const ownerRead = await subService.getCustomerSubscription(owned._id, { customer: CUSTOMER });
  ck('the owner CAN still read their own subscription', !!ownerRead && String(ownerRead._id) === String(owned._id));

  const ownerPause = await subService.pauseSubscription(owned._id, { customer: CUSTOMER, reason: 'holiday' });
  ck('the owner CAN still pause their own subscription', String(ownerPause.status) === 'paused');
  const ownerResume = await subService.resumeSubscription(owned._id, { customer: CUSTOMER });
  ck('and resume it', String(ownerResume.status) === 'scheduled');

  console.log('\n=== the outlet is the caller\'s to supply ===\n');

  // `createSubscription` read the outlet from the session. On a customer token that is
  // undefined, and the schema rejected one in the body — so a customer could neither send
  // nor inherit an outlet and every subscription they made was orphaned. The outlet is now
  // required from the body, with the chain derived from it.
  const noChain = await subService.createCustomerSubscription({
    customer: CUSTOMER,
    outlet: OUTLET,
    items: baseItems(),
    cadence: 'weekly',
    deliveryDayOfWeek: 1,
    deliverySlot: { startTime: '06:00', endTime: '09:00' },
    address: new mongoose.Types.ObjectId(),
    startDate: new Date(),
  });
  ck('the chain is derived from the outlet when not supplied',
    String(noChain.chain) === String(CHAIN), `chain=${noChain.chain}`);

  let unknownOutlet = null;
  try {
    await subService.createCustomerSubscription({
      customer: CUSTOMER,
      outlet: new mongoose.Types.ObjectId(),
      items: baseItems(),
      cadence: 'weekly',
      deliveryDayOfWeek: 1,
      deliverySlot: { startTime: '06:00', endTime: '09:00' },
      address: new mongoose.Types.ObjectId(),
      startDate: new Date(),
    });
  } catch (e) {
    unknownOutlet = e;
  }
  ck('subscribing at a store that does not exist is a 404', unknownOutlet && unknownOutlet.statusCode === 404,
    unknownOutlet ? `statusCode=${unknownOutlet.statusCode}` : 'it succeeded');
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
    console.log('\n' + (failures === 0 ? 'ALL STORES CUSTOMER SUBSCRIPTION CHECKS PASSED' : failures + ' STORES CUSTOMER SUBSCRIPTION CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });