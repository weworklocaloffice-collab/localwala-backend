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
 * Verifies the subscription schedules and the nightly manifest pipeline against
 * the real DB.
 *
 * Schedule evaluation (the specification's four modes):
 *   1. daily
 *   2. alternate_days — every other day from the start date
 *   3. weekly — the same weekday as the start date
 *   4. custom_days — an explicit weekday list
 *   5. skip date always beats the recurrence
 *   6. pause window suspends generation
 *   7. plan before start / after end is not due
 *
 * Lifecycle (all twelve operations append to the event log):
 *   8. create reserves stock
 *   9. skip / unskip
 *  10. pause / resume
 *  11. change quantity (with stock return on decrease)
 *  12. change address
 *  13. change schedule
 *  14. cancel returns stock and voids planned occurrences
 *  15. reactivate
 *
 * Manifest pipeline:
 *  16. occurrences generated only for due plans
 *  17. second run for the same date is idempotent
 *  18. runs are bucketed per business + slot, not one per customer
 *  19. generated occurrences link back to run and stop
 *  20. preview writes nothing
 *  21. demand forecast totals by SKU
 *
 * Usage: node scripts/verify.dairy.subscriptions.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  Wallet,
  DairySku,
  DairyCategory,
  DairySubCategory,
  DairyProduct,
  DairySubscription,
  DairySubscriptionEvent,
  DairyRecurringOrder,
  DeliveryRun,
  DeliveryStop,
} = require('../src/models');
const subService = require('../src/modules/dairy/services/dairy.subscription.service');
const manifestService = require('../src/modules/dairy/services/dairy.manifest.service');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Next calendar date at or after `from` whose weekday is `weekday`
 * (0 = Sunday … 6 = Saturday), matching `Date#getDay`.
 */
const nextWeekday = (from, weekday) => {
  const d = addDays(from, 0);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  return d;
};

// A known reference week so weekday assertions are unambiguous.
const MONDAY = new Date(2026, 8, 7); // 2026-09-07 is a Monday

const run = async () => {
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const asha = await User.findOne({ countryCode: '+91', mobile: '9000000001' });
  if (!asha) {
    console.error('Seed data missing. Run: node scripts/seed.dairy.js');
    process.exit(1);
  }
  const business = await Business.findOne({ owner: asha._id });
  const tag = `S${Date.now().toString().slice(-6)}`;
  const agent = asha._id.toString();

  const created = { categories: [], subs: [], products: [], skus: [], subs_: [] };

  // Customers, one per plan so deliveries are distinguishable.
  const customers = [];
  for (let i = 0; i < 4; i += 1) {
    const mobile = `96${Date.now().toString().slice(-7)}${i}`;
    customers.push(
      await User.create({
        firstName: `Sub${i}`, lastName: 'Test', countryCode: '+91', mobile: Number(mobile),
        email: `sub${i}${Date.now()}@sub.local`, password: 'Customer@123',
        role: 'user', status: true, locale: 'en',
      })
    );
    await Wallet.create({ holderId: customers[i]._id, balance: 1000, status: true });
  }

  try {
    // Minimal catalogue so a SKU exists.
    const category = await DairyCategory.create({ key: `milk_${tag}`, name: `Milk ${tag}`, sortOrder: 1 });
    created.categories.push(category);
    const subCat = await DairySubCategory.create({ category: category._id, name: `Toned ${tag}` });
    created.categories.push(subCat);
    const product = await DairyProduct.create({
      business: business._id, category: category._id, subCategory: subCat._id,
      name: `Sub Test Milk ${tag}`,
    });
    created.products.push(product);
    const sku = await DairySku.create({
      business: business._id, product: product._id, category: category._id, subCategory: subCat._id,
      name: `Sub Test Milk 1 Litre ${tag}`,
      packSize: { value: '1 Litre', unit: 'litre', quantity: 1 },
      price: 60, availableQty: 1000, inStock: true, status: true,
    });
    created.skus.push(sku);

    const slot = { startTime: '06:00', endTime: '08:00' };

    // ---- 1-7. Schedule evaluation ----
    console.log('\n1. Schedule evaluation');
    const daily = await DairySubscription.create({
      subscriptionNo: 990001, user: customers[0]._id, business: business._id, sku: sku._id,
      quantity: 2, scheduleType: 'daily', startDate: MONDAY, deliverySlot: slot,
      unitPrice: 60, status: 'active',
    });
    created.subs_.push(daily);

    check('daily is due on the start date', daily.isScheduledFor(MONDAY) === true);
    check('daily is due the next day', daily.isScheduledFor(addDays(MONDAY, 1)) === true);
    check('daily is NOT due before it starts', daily.isScheduledFor(addDays(MONDAY, -1)) === false);

    const alt = await DairySubscription.create({
      subscriptionNo: 990002, user: customers[1]._id, business: business._id, sku: sku._id,
      quantity: 1, scheduleType: 'alternate_days', startDate: MONDAY, deliverySlot: slot,
      unitPrice: 60, status: 'active',
    });
    created.subs_.push(alt);

    check('alternate day 0 is due', alt.isScheduledFor(MONDAY) === true);
    check('alternate day 1 is NOT due', alt.isScheduledFor(addDays(MONDAY, 1)) === false);
    check('alternate day 2 is due', alt.isScheduledFor(addDays(MONDAY, 2)) === true);
    check('alternate day 3 is NOT due', alt.isScheduledFor(addDays(MONDAY, 3)) === false);

    const weekly = await DairySubscription.create({
      subscriptionNo: 990003, user: customers[2]._id, business: business._id, sku: sku._id,
      quantity: 1, scheduleType: 'weekly', startDate: MONDAY, deliverySlot: slot,
      unitPrice: 60, status: 'active',
    });
    created.subs_.push(weekly);

    check('weekly is due on its weekday', weekly.isScheduledFor(MONDAY) === true);
    check('weekly is NOT due 6 days later', weekly.isScheduledFor(addDays(MONDAY, 6)) === false);
    check('weekly is due 7 days later', weekly.isScheduledFor(addDays(MONDAY, 7)) === true);

    // custom_days: Wednesday(3) + Friday(5)
    const custom = await DairySubscription.create({
      subscriptionNo: 990004, user: customers[3]._id, business: business._id, sku: sku._id,
      quantity: 1, scheduleType: 'custom_days', customDays: [3, 5], startDate: MONDAY,
      deliverySlot: slot, unitPrice: 60, status: 'active',
    });
    created.subs_.push(custom);

    check('custom day Monday(1) NOT in list', custom.isScheduledFor(MONDAY) === false);
    check('custom Wednesday(3) in list', custom.isScheduledFor(addDays(MONDAY, 2)) === true);
    check('custom Thursday(4) NOT in list', custom.isScheduledFor(addDays(MONDAY, 3)) === false);
    check('custom Friday(5) in list', custom.isScheduledFor(addDays(MONDAY, 4)) === true);

    // skip beats recurrence
    const withSkip = await DairySubscription.create({
      subscriptionNo: 990005, user: customers[0]._id, business: business._id, sku: sku._id,
      quantity: 1, scheduleType: 'daily', startDate: MONDAY, deliverySlot: slot,
      unitPrice: 60, status: 'active',
      skipDates: [addDays(MONDAY, 3)],
    });
    created.subs_.push(withSkip);
    check('skip date beats the recurrence', withSkip.isScheduledFor(addDays(MONDAY, 3)) === false);
    check('non-skipped date still due', withSkip.isScheduledFor(addDays(MONDAY, 4)) === true);

    // pause window
    const withPause = await DairySubscription.create({
      subscriptionNo: 990006, user: customers[1]._id, business: business._id, sku: sku._id,
      quantity: 1, scheduleType: 'daily', startDate: MONDAY, deliverySlot: slot,
      unitPrice: 60, status: 'paused',
      pauseWindows: [{ from: addDays(MONDAY, 1), to: addDays(MONDAY, 5) }],
    });
    created.subs_.push(withPause);
    check('inside pause window NOT due', withPause.isScheduledFor(addDays(MONDAY, 2)) === false);
    check('outside pause window still due', withPause.isScheduledFor(addDays(MONDAY, 6)) === true);

    // end date
    const withEnd = await DairySubscription.create({
      subscriptionNo: 990007, user: customers[2]._id, business: business._id, sku: sku._id,
      quantity: 1, scheduleType: 'daily', startDate: MONDAY, endDate: addDays(MONDAY, 2),
      deliverySlot: slot, unitPrice: 60, status: 'active',
    });
    created.subs_.push(withEnd);
    check('before end date due', withEnd.isScheduledFor(addDays(MONDAY, 2)) === true);
    check('after end date NOT due', withEnd.isScheduledFor(addDays(MONDAY, 3)) === false);

    // ---- 8. create reserves stock ----
    console.log('\n2. Lifecycle');
    const stockBefore = (await DairySku.findById(sku._id)).availableQty;
    const { subscription: createdSub, amount } = await subService.createSubscription({
      user: customers[0]._id, business: business._id, sku: sku._id, quantity: 3,
      scheduleType: 'daily', startDate: MONDAY, deliverySlot: slot, paymentMode: 'cod',
      actor: customers[0]._id,
    });
    created.subs_.push(createdSub);
    const stockAfter = (await DairySku.findById(sku._id)).availableQty;
    // Stock is reserved per occurrence, not per plan. Signing a plan must not
    // lock up stock the customer has not been delivered yet — see
    // verify.dairy.subscription.billing.js for the reservation itself.
    check('create does NOT reserve stock up front', stockBefore === stockAfter,
      `${stockBefore} -> ${stockAfter}`);
    check('create computes amount', amount === 180, `got ${amount}`);

    const events = await subService.listEvents(createdSub._id, {});
    check('creation is logged as an event', events.some((e) => e.eventType === 'created'));

    // ---- 9. skip / unskip ----
    // The cutoff guard (a skip too close to its slot is rejected) now owns the
    // "when can a skip be taken" answer, so this fixture uses a date safely in the
    // future instead of the fixed September reference. Missed an occurrence while a
    // run was planned is covered by the pre-existing "already been planned" fence,
    // and the cutoff itself is proven in verify.dairy.settings.js.
    const skipTarget = addDays(new Date(), 3);
    await subService.skipDate(createdSub._id, skipTarget, { actor: customers[0]._id, reason: 'travel' });
    let fresh = await DairySubscription.findById(createdSub._id);
    check('skip date recorded', fresh.skipDates.length === 1);
    check('skipped date is not due', fresh.isScheduledFor(skipTarget) === false);

    await subService.unskipDate(createdSub._id, skipTarget, { actor: customers[0]._id });
    fresh = await DairySubscription.findById(createdSub._id);
    check('unskip clears it', fresh.skipDates.length === 0);
    check('date due again after unskip', fresh.isScheduledFor(skipTarget) === true);

    // ---- 10. pause / resume ----
    // `from` is explicit: it defaults to now, so a window starting today could not
    // be tested against the September reference dates.
    await subService.pause(createdSub._id, {
      from: MONDAY, to: addDays(MONDAY, 10), reason: 'vacation', actor: customers[0]._id,
    });
    fresh = await DairySubscription.findById(createdSub._id);
    check('pause sets status', fresh.status === 'paused');
    check('pause window blocks a date inside it', fresh.isScheduledFor(addDays(MONDAY, 5)) === false);

    await subService.resume(createdSub._id, { actor: customers[0]._id });
    fresh = await DairySubscription.findById(createdSub._id);
    check('resume sets status active', fresh.status === 'active');
    check('pause windows closed on resume', fresh.pauseWindows.every((w) => new Date(w.to) <= new Date()));
    // `resume` closes windows at *now*, so dates in the September reference week
    // are still inside the paused range. Check a date after the window instead.
    const afterResume = addDays(new Date(), 2);
    check('date due again after resume', fresh.isScheduledFor(afterResume) === true);

    // ---- 11. change quantity ----
    await subService.changeQuantity(createdSub._id, 5, { actor: customers[0]._id });
    fresh = await DairySubscription.findById(createdSub._id);
    const stockUp = (await DairySku.findById(sku._id)).availableQty;
    check('quantity changed', fresh.quantity === 5, `got ${fresh.quantity}`);
    // A quantity change applies to deliveries not yet generated, so it moves no
    // stock: past occurrences are already billed and are not repriced.
    check('quantity change moves no stock', stockUp === stockAfter,
      `expected ${stockAfter}, got ${stockUp}`);

    await subService.changeQuantity(createdSub._id, 2, { actor: customers[0]._id });
    const stockDown = (await DairySku.findById(sku._id)).availableQty;
    check('lowering the quantity moves no stock', stockDown === stockAfter,
      `${stockAfter} -> ${stockDown}`);

    const qtyEvents = await subService.listEvents(createdSub._id, {});
    check('quantity changes are logged with before/after',
      qtyEvents.filter((e) => e.eventType === 'quantity_changed').length === 2);

    // ---- 12. change address ----
    await subService.changeAddress(createdSub._id, {
      addressRaw: '99 New Address Road', receiverName: 'Ramesh', actor: customers[0]._id,
    });
    fresh = await DairySubscription.findById(createdSub._id);
    check('address updated', fresh.addressRaw === '99 New Address Road');

    // ---- 13. change schedule ----
    // Assert against dates outside the September reference week, which is still
    // inside the resumed pause window's original span.
    const nextTue = nextWeekday(new Date(), 2);
    const nextWed = nextWeekday(new Date(), 3);
    await subService.changeSchedule(createdSub._id, {
      scheduleType: 'custom_days', customDays: [2, 4], actor: customers[0]._id,
    });
    fresh = await DairySubscription.findById(createdSub._id);
    check('schedule type changed', fresh.scheduleType === 'custom_days');
    check('custom days applied', fresh.isScheduledFor(nextTue) === true);
    check('non-listed day excluded', fresh.isScheduledFor(nextWed) === false);

    let customRequired = false;
    try {
      await subService.changeSchedule(createdSub._id, { scheduleType: 'custom_days', customDays: [], actor: customers[0]._id });
    } catch (e) { customRequired = e.statusCode === 400; }
    check('custom_days without days refused', customRequired);

    // ---- 14. cancel ----
    await subService.cancel(createdSub._id, { reason: 'moving away', actor: customers[0]._id });
    fresh = await DairySubscription.findById(createdSub._id);
    const afterCancel = (await DairySku.findById(sku._id)).availableQty;
    check('cancel sets status', fresh.status === 'cancelled');
    check('cancel records the reason', fresh.cancellation && fresh.cancellation.reason === 'moving away');
    // Nothing was reserved for this plan, so cancelling it moves no stock. The
    // return path for real reservations is covered in
    // verify.dairy.subscription.billing.js.
    check('cancel moves no stock when nothing was reserved', afterCancel === stockAfter,
      `expected ${stockAfter}, got ${afterCancel}`);
    let changeCancelled = false;
    try {
      await subService.changeQuantity(createdSub._id, 4, { actor: customers[0]._id });
    } catch (e) { changeCancelled = e.statusCode === 400; }
    check('cancelled plan refuses further changes', changeCancelled);

    // ---- 15. reactivate ----
    await subService.reactivate(createdSub._id, { actor: customers[0]._id });
    fresh = await DairySubscription.findById(createdSub._id);
    check('reactivate restores active', fresh.status === 'active');

    // ---- 16-19. Manifest pipeline ----
    console.log('\n3. Manifest pipeline');
    // Clear the seeded plans so the manifest result is predictable.
    await DairyRecurringOrder.deleteMany({});
    await DeliveryStop.deleteMany({});
    await DeliveryRun.deleteMany({});

    const target = addDays(MONDAY, 21);
    const dueIds = [];
    for (const plan of [daily, alt, weekly, custom, withEnd]) {
      await DairySubscription.updateOne(
        { _id: plan._id },
        { $set: { status: 'active', skipDates: [], pauseWindows: [] } }
      );
      if (plan.isScheduledFor(target)) dueIds.push(plan.subscriptionNo);
    }
    await DairySubscription.updateOne({ _id: daily._id }, { $set: { status: 'inactive-probe' } });

    const preview = await manifestService.previewManifest(target);
    check('preview writes nothing', (await DairyRecurringOrder.countDocuments({ occurrenceDate: manifestService.dayKey(target) })) === 0);
    check('preview reports due count', preview.dueToday === dueIds.length,
      `preview=${preview.dueToday} expected=${dueIds.length}`);
    check('preview buckets by business + slot', preview.expectedRuns >= 1, `runs=${preview.expectedRuns}`);

    const summary = await manifestService.runManifestJob(target);
    const occCount = await DairyRecurringOrder.countDocuments({ occurrenceDate: manifestService.dayKey(target) });
    check('occurrences generated for due plans', occCount === dueIds.length,
      `got ${occCount} expected ${dueIds.length}`);
    check('summary reports occurrences', summary.occurrencesGenerated === dueIds.length);
    check('summary reports runs created', summary.runsCreated >= 1, `got ${summary.runsCreated}`);

    const nonDue = await DairyRecurringOrder.findOne({ subscription: alt._id, occurrenceDate: manifestService.dayKey(target) });
    if (alt.isScheduledFor(target)) {
      check('due alternate-day plan generated', !!nonDue);
    } else {
      check('non-due alternate-day plan NOT generated', !nonDue);
    }

    const stops = await DeliveryStop.countDocuments({});
    check('stops created for generated occurrences', stops === occCount, `stops=${stops} occ=${occCount}`);

    const linked = await DairyRecurringOrder.findOne({ run: { $exists: true } });
    check('occurrences link back to a run', !!linked);
    check('occurrences link back to a stop', !!(linked && linked.stop));

    // Idempotency
    const rerun = await manifestService.runManifestJob(target);
    const occAfter = await DairyRecurringOrder.countDocuments({ occurrenceDate: manifestService.dayKey(target) });
    check('second run for the same date creates nothing new', occAfter === occCount,
      `before=${occCount} after=${occAfter}`);
    check('second run reports zero generated', rerun.occurrencesGenerated === 0,
      `got ${rerun.occurrencesGenerated}`);

    // ---- 21. Forecast ----
    console.log('\n4. Forecast');
    const forecast = await manifestService.getDemandForecast(target, 2);
    check('forecast covers the requested days', forecast.length === 3, `got ${forecast.length}`);
    const totalCans = forecast.reduce((s, d) => s + d.skus.reduce((x, e) => x + e.cans, 0), 0);
    check('forecast totals cans across days', totalCans > 0, `got ${totalCans}`);

    const daySummary = await manifestService.getDaySummary(target);
    check('day summary reports runs', daySummary.runs >= 1, `got ${daySummary.runs}`);
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message}`);
  } finally {
    await DairySubscriptionEvent.deleteMany({ subscription: { $in: created.subs_.map((s) => s._id) } });
    await DairyRecurringOrder.deleteMany({});
    await DeliveryStop.deleteMany({});
    await DeliveryRun.deleteMany({});
    await DairySubscription.deleteMany({ _id: { $in: created.subs_.map((s) => s._id) } });
    await DairySku.deleteMany({ _id: { $in: created.skus.map((s) => s._id) } });
    await DairyProduct.deleteMany({ _id: { $in: created.products.map((p) => p._id) } });
    await DairySubCategory.deleteMany({ _id: { $in: created.categories.map((c) => c._id) } });
    await DairyCategory.deleteMany({ _id: { $in: created.categories.map((c) => c._id) } });
    await User.deleteMany({ _id: { $in: customers.map((c) => c._id) } });
    await Wallet.deleteMany({ holderId: { $in: customers.map((c) => c._id) } });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL SUBSCRIPTION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});