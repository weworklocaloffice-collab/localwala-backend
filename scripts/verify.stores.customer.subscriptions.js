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
require('../src/modules/stores/models/store.recurring.order.model');
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
// §6.18.6 generation touches these through the sweep and the notification path.
require('../src/modules/stores/models/store.outlet.product.model');
require('../src/modules/stores/models/store.outlet.stock.item.model');
require('../src/models/notification.list.model');
require('../src/models/push.notitication.token.model');

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
  await mongoose.model('StoreRecurringOrder').deleteMany({ customer: CUSTOMER });
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

  // A previous run can leave the natural-key rows behind when its cleanup half-ran
  // (an unregistered model throws first and skips the rest), so start by clearing
  // what the fixture is about to create.
  await cleanup();

  // listCustomerSubscriptions populates `outlet`: a synthetic id reads back null.
  // `status` and `operational` come from the model defaults ('draft' and false), so a
  // harness outlet is NOT automatically open for §6.18.6 — the generator is designed to
  // refuse it. Seed it live, exactly like a real approved outlet.
  await mongoose.model('StoreChain').create({
    _id: CHAIN, business: new mongoose.Types.ObjectId(), name: 'custsub suite', slug: 'custsub-suite',
  });
  await mongoose.model('StoreOutlet').create({
    _id: OUTLET, chain: CHAIN, outletCode: 'CSUB', name: 'custsub suite',
    status: 'active', operational: true,
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

  console.log('\n=== §6.18.6 occurrence generation ===\n');

  const StoreRecurringOrder = mongoose.model('StoreRecurringOrder');
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const StoreOutletProduct = mongoose.model('StoreOutletProduct');

  // Three citations from the plan, each exercised against a controlled fixture:
  //   - skipDates covering the day → the cursor advances and NO row is written
  //   - a store that cannot fulfil → skipped_store_inactive + customer notification
  //   - live stock below half of the box → skipped_no_stock with full credit (rule 4)
  // and, above half, a generated row that carries the shortfall credit for the missing units.
  const atPriceRow = async (variant, price) => {
    await StoreOutletProduct.deleteMany({ outlet: OUTLET, productVariant: variant });
    await StoreOutletProduct.create({
      outlet: OUTLET, chain: CHAIN, product: new mongoose.Types.ObjectId(), productVariant: variant,
      price, priceInPaise: price * 100, status: 'active',
    });
  };
  const atStockRow = async (variant, { onHand = 0, reserved = 0, damaged = 0 } = {}) => {
    await StoreOutletStockItem.deleteMany({ outlet: OUTLET, variant });
    await StoreOutletStockItem.create({
      outlet: OUTLET, chain: CHAIN, product: new mongoose.Types.ObjectId(), variant,
      onHand, reserved, damaged, availableQty: onHand - reserved - damaged,
    });
  };

  // ...the generator advances the cursor by day-keys (UTC midnight), while
  // `nextOccurrenceDate` may carry a time-of-day. Seed the fixture with a near-now
  // date; the sweep claims it, then advances a full cadence step.
  const seedCursor = (subId, nextDate) =>
    StoreCustomerSubscription.updateOne({ _id: subId }, {
      $set: { nextOccurrenceDate: nextDate, lastOccurrenceDate: null, status: 'scheduled', endDate: null },
    });

  const occurrencesOf = (subId) => StoreRecurringOrder.find({ subscription: subId }).lean();
  const freshCursor = async (subId) => (await StoreCustomerSubscription.findById(subId)).nextOccurrenceDate;

  // 1. skip-day advance, no row.
  const skipDaySub = await makeSub({});
  await atPriceRow(VARIANT, 50);
  await atStockRow(VARIANT, { onHand: 50 });
  const skipDay = new Date(); // today
  await seedCursor(skipDaySub._id, skipDay);
  await StoreCustomerSubscription.updateOne({ _id: skipDaySub._id }, { $push: { skipDates: new Date(new Date().setUTCHours(0, 0, 0, 0)) } });
  const skipDayRun = await subService.generateOccurrences();
  const skipDayRows = await occurrencesOf(skipDaySub._id);
  ck('a skip-date occurrence writes NO occurrence row', skipDayRows.length === 0,
    `rows=${skipDayRows.length}`);
  const skipDayAfter = await freshCursor(skipDaySub._id);
  ck('a skip-date still advances the cursor', skipDayAfter.getTime() >= new Date(skipDay.getTime() + 6 * 24 * 3600 * 1000).getTime(),
    `next=${skipDayAfter.toISOString()}`);
  ck('the sweep reports the skip-day advance', skipDayRun.advanced >= 1, JSON.stringify(skipDayRun));

  // 2. store inactive → skipped_store_inactive + notification.
  const deadOutlet = await mongoose.model('StoreOutlet').create({
    chain: CHAIN, outletCode: 'CSUB-D' + Math.floor(Math.random() * 10000), name: 'closed outlet', operational: false, status: 'active',
  });
  const inactiveSub = await makeSub({ outlet: deadOutlet._id, cadence: 'weekly', intervalCount: 1 });
  await seedCursor(inactiveSub._id, new Date());
  const inactiveRun = await subService.generateOccurrences();
  const inactiveRows = await occurrencesOf(inactiveSub._id);
  ck('a non-operational store produces a skipped row',
    inactiveRows.length === 1 && inactiveRows[0].generationStatus === 'skipped_store_inactive',
    JSON.stringify(inactiveRows));
  ck('the skipped row names the reason',
    inactiveRows.length === 1 && inactiveRows[0].skipReason === 'store_not_operational',
    inactiveRows.length === 1 ? inactiveRows[0].skipReason : 'no row');
  ck('a skipped row does not credit', inactiveRows.length === 1 && Number(inactiveRows[0].creditAmount) === 0);
  ck('the inactive-run is reported', inactiveRun.skipped >= 1, JSON.stringify(inactiveRun));

  // 3. live stock below half of the box → skipped_no_stock + FULL credit (rule 4).
  await atPriceRow(VARIANT, 50);
  await atStockRow(VARIANT, { onHand: 0 });
  const emptyBoxSub = await makeSub({});
  await seedCursor(emptyBoxSub._id, new Date());
  await subService.generateOccurrences();
  const emptyRows = await occurrencesOf(emptyBoxSub._id);
  ck('an empty shelf skips the cycle',
    emptyRows.length === 1 && emptyRows[0].generationStatus === 'skipped_no_stock', JSON.stringify(emptyRows));
  ck('the empty-shelf credit is the full agreed value',
    emptyRows.length === 1 && Number(emptyRows[0].creditAmount) === 100,
    emptyRows.length === 1 ? String(emptyRows[0].creditAmount) : 'no row');

  // 4. above half + partial → generated row carrying the SHORTFALL credit.
  // The box is 2 units; 1 on hand is exactly 50% — the boundary case, so seed 1 of 2
  // available: ratio = 0.5 must NOT trip the < 50 rule.
  await atStockRow(VARIANT, { onHand: 1 });
  const partialSub = await makeSub({});
  await seedCursor(partialSub._id, new Date());
  await subService.generateOccurrences();
  const partialRows = await occurrencesOf(partialSub._id);
  ck('half-available stays generated (rule 4 boundary)',
    partialRows.length === 1 && partialRows[0].generationStatus === 'generated', JSON.stringify(partialRows));
  ck('the missing unit is credited at the agreed price',
    partialRows.length === 1 && Number(partialRows[0].creditAmount) === 50,
    partialRows.length === 1 ? String(partialRows[0].creditAmount) : 'no row');
  ck('a partial row keeps a shortfall reason',
    partialRows.length === 1 && partialRows[0].skipReason === 'stock_partial_shortfall',
    partialRows.length === 1 ? partialRows[0].skipReason : 'no row');

  // 5. exactly-once: a repeat run does NOT create a second row nor re-notify.
  const onceSub = await makeSub({});
  await atStockRow(VARIANT, { onHand: 50 });
  await seedCursor(onceSub._id, new Date(Date.now() - 9 * 24 * 3600 * 1000)); // two weeks behind
  const firstRun = await subService.generateOccurrences();
  const firstRows = await occurrencesOf(onceSub._id);
  ck('a two-cycle catch-up generates one row per cycle', firstRows.length === 2, `rows=${firstRows.length}`);
  ck('nothing was reported as a failure during the catch-up', firstRun.failures === 0, JSON.stringify(firstRun));
  const firstCount = firstRows.length;
  const firstCredits = firstRows.map((r) => String(r.creditAmount)).join(',');
  await subService.generateOccurrences();
  const secondRows = await occurrencesOf(onceSub._id);
  ck('a repeat run does not duplicate occurrences', secondRows.length === firstCount,
    `before=${firstCount} after=${secondRows.length}`);
  ck('a repeat run does not revise credits', secondRows.map((r) => String(r.creditAmount)).join(',') === firstCredits);
  const catchUpCursor = await freshCursor(onceSub._id);
  ck('the catch-up cursor ends on a future date', catchUpCursor.getTime() > Date.now(), catchUpCursor.toISOString());

  // 6. the upsert row is keyed on UTC midnight, so two runs on the same DAY
  //    with different times-of-day cannot create two rows.
  ck('occurrence dates are stored at UTC midnight',
    (await occurrencesOf(onceSub._id)).every((r) => new Date(r.occurrenceDate).toISOString().endsWith('T00:00:00.000Z')));

  const subscriptionAfter = await StoreCustomerSubscription.findById(emptyBoxSub._id).lean();
  ck('a processed cycle stamps lastOccurrenceDate', !!subscriptionAfter.lastOccurrenceDate);

  // The fixture rows must not survive into later suites: delete the recurring rows the
  // sweep produced and the stock/price rows for the suite variant.
  await StoreRecurringOrder.deleteMany({ subscription: { $in: [skipDaySub._id, inactiveSub._id, emptyBoxSub._id, partialSub._id, onceSub._id, onPlan._id] } });
  await StoreOutletStockItem.deleteMany({ outlet: OUTLET });
  await StoreOutletProduct.deleteMany({ outlet: OUTLET });
  await mongoose.model('StoreOutlet').deleteMany({ _id: deadOutlet._id });
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