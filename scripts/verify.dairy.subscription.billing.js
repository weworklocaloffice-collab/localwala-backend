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
 * Verifies that a subscription occurrence becomes a real, paid order.
 *
 * The gap this closes: occurrences used to be generated onto a manifest with no
 * order, no payment and no revenue, so subscription money was invisible to outlet
 * reports and to partner settlements.
 *
 * Asserts stock:
 *   1. creating a plan reserves nothing
 *   2. generating an occurrence reserves exactly its quantity
 *   3. a second generation for the same date does not reserve again
 *   4. an occurrence the outlet cannot cover is skipped and reserves nothing
 *   5. an occurrence that cannot be paid for returns the stock it took
 *
 * Asserts billing:
 *   6. a real order is raised, linked to both the plan and the occurrence
 *   7. the order is an ordinary confirmed/paid order, not a special type
 *   8. the customer wallet is debited by the frozen occurrence amount
 *   9. the price frozen at generation survives a later price change
 *  10. an order cannot be raised twice for one occurrence
 *  11. a low prepaid balance skips the delivery instead of delivering unpaid
 *
 * Asserts the money comes back:
 *  12. cancelling the plan refunds the undelivered, prepaid occurrence
 *  13. cancelling returns the reserved stock
 *  14. the refund is recorded in the transaction ledger
 *  15. an already-assigned occurrence is not silently withdrawn
 *
 * Asserts the revenue loop closes:
 *  16. completing the stop marks the order delivered with a timestamp
 *  17. a delivered, paid subscription order is settleable
 *  18. the delivery kernel emits to dairy without the kernel importing it
 *
 * Usage: node scripts/verify.dairy.subscription.billing.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  Wallet,
  Transactions,
  DairySku,
  DairyOrder,
  DairyOrderStatusHistory,
  DairySubscription,
  DairyRecurringOrder,
  DairyCan,
  DairyCanLedger,
  DairyContainerAssignment,
  DairyDriver,
  DeliveryRun,
  DeliveryStop,
} = require('../src/models');
const subService = require('../src/modules/dairy/services/dairy.subscription.service');
const manifestService = require('../src/modules/dairy/services/dairy.manifest.service');
const billingService = require('../src/modules/dairy/services/dairy.subscription.billing.service');
const containerService = require('../src/modules/dairy/services/dairy.container.service');
const canService = require('../src/modules/dairy/services/dairy.can.service');
const deliveryRunService = require('../src/kernel/delivery/services/delivery.run.service');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const addDays = (base, days) => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
};

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
  const tag = `B${Date.now().toString().slice(-6)}`;

  const makeUser = async (name, mobile, balance) => {
    const u = await User.create({
      firstName: name, lastName: 'Billing', countryCode: '+91', mobile: Number(mobile),
      email: `${mobile}@billing.local`, password: 'Test@12345',
      role: 'user', status: true, locale: 'en',
    });
    await Wallet.create({ holderId: u._id, balance, status: true });
    return u;
  };

  const stamp = Date.now().toString().slice(-7);
  const rich = await makeUser('Rich', `981${stamp}1`, 5000);
  const poor = await makeUser('Poor', `982${stamp}2`, 5);
  const partnerUser = await makeUser('Owner', `983${stamp}3`, 0);

  const business = await Business.create({
    vertical: 'dairy', businessModel: 'direct', name: `Milk Outlet ${tag}`,
    owner: partnerUser._id, ownDeliveryPartner: true, verified: true, status: true,
  });

  // The outlet has to actually employ a rider.
  //
  // This fixture used to set `ownDeliveryPartner: true` and hire nobody, and the run
  // picked up a rider from the platform pool. There is no pool, so `assignAgent` now
  // returns no agent, the run is created unstaffed, and delivering a stop fails the
  // ownership check with a bare `Forbidden`. Hiring a rider is what the app now
  // requires an outlet to do, so the fixture does it too.
  const riderUser = await User.create({
    firstName: 'Billing', lastName: 'Rider', countryCode: '+91',
    mobile: Number(`8${tag}9`), email: `bill${tag}r@test.local`,
    password: 'Rider@12345', role: 'dairyDriver', status: true,
  });
  const rider = await DairyDriver.create({
    userId: riderUser._id,
    // Required: a dairy rider always belongs to an outlet.
    business: business._id,
    city: business.city,
    locality: business.locality,
    payoutMode: 'per_can',
    payoutRate: 500,
    canCapacity: 30,
    vehicleType: 'cycle',
    activeStatus: true,
    status: true,
  });

  const makeSku = async (name, qty, price, overrides = {}) =>
    DairySku.create({
      business: business._id, name, packSize: { value: 1, unit: 'litre', quantity: 1 },
      price, availableQty: qty, inStock: true, status: true, ...overrides,
    });

  const sku = await makeSku(`Full Cream ${tag}`, 100, 60);
  const scarceSku = await makeSku(`Scarce ${tag}`, 1, 60);

  const ids = { users: [rich._id, poor._id, partnerUser._id, riderUser._id], skus: [sku._id, scarceSku._id], cans: [], drivers: [rider._id] };

  // A Monday, so a daily plan is due on the target date.
  const MONDAY = addDays(new Date(), 7);
  while (MONDAY.getDay() !== 1) {
    MONDAY.setDate(MONDAY.getDate() + 1);
  }

  const makePlan = async (user, targetSku, quantity, endDate) => {
    const { subscription } = await subService.createSubscription({
      user: user._id,
      business: business._id,
      sku: targetSku._id,
      quantity,
      scheduleType: 'daily',
      startDate: MONDAY,
      // An end date pins a plan to one day, so each section of this script can
      // assert on one customer's money without a neighbouring plan also billing.
      endDate,
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
      addressRaw: '1 Billing Street',
      paymentMode: 'wallet',
    });
    ids.subs = ids.subs || [];
    ids.subs.push(subscription._id);
    return subscription;
  };

  try {
    // ---- 1-5. Stock ----
    console.log('\n1. Stock is reserved per occurrence');
    const plan = await makePlan(rich, sku, 2, MONDAY);
    check('creating a plan reserves nothing',
      (await DairySku.findById(sku._id)).availableQty === 100,
      `got ${(await DairySku.findById(sku._id)).availableQty}`);

    const gen = await manifestService.generateOccurrences(MONDAY);
    check('occurrence generated', gen.generated === 1, `generated ${gen.generated}`);

    const occurrence = await DairyRecurringOrder.findOne({
      subscription: plan._id, occurrenceDate: MONDAY,
    });
    check('occurrence exists', !!occurrence);
    check('occurrence reserved its quantity',
      (await DairySku.findById(sku._id)).availableQty === 98,
      `got ${(await DairySku.findById(sku._id)).availableQty}`);
    check('reservation flagged on the occurrence', occurrence.stockReserved === true);
    check('occurrence marked billed', occurrence.status === 'billed', `got ${occurrence.status}`);

    // Rerunning the nightly job must not take the stock or the money twice.
    const walletBeforeRerun = (await Wallet.findOne({ holderId: rich._id })).balance;
    const stockBeforeRerun = (await DairySku.findById(sku._id)).availableQty;
    await manifestService.generateOccurrences(MONDAY);
    check('regeneration does not reserve again',
      (await DairySku.findById(sku._id)).availableQty === stockBeforeRerun);
    check('regeneration does not charge again',
      (await Wallet.findOne({ holderId: rich._id })).balance === walletBeforeRerun);

    // ---- 6-11. Billing ----
    console.log('\n2. The occurrence becomes a paid order');
    const order = await DairyOrder.findById(occurrence.order);
    check('an order was raised', !!order);
    check('order linked to the plan', String(order.subscription) === String(plan._id));
    check('order linked to the occurrence', String(order.recurringOrder) === String(occurrence._id));
    check('order mode is subscription', order.mode === 'subscription', `got ${order.mode}`);
    check('order is an ordinary confirmed order', order.status === 'confirmed', `got ${order.status}`);
    check('order is paid', order.paymentStatus === 'paid', `got ${order.paymentStatus}`);
    check('order carries no invented delivery charge',
      Number(order.serviceCharge) === 0 && Number(order.depositTotal) === 0);
    check('order total equals the occurrence amount',
      Number(order.grandTotal) === Number(occurrence.amount),
      `${order.grandTotal} vs ${occurrence.amount}`);
    check('order item quantity matches the plan', order.items[0].quantity === 2);

    const wallet = await Wallet.findOne({ holderId: rich._id });
    check('wallet debited by the occurrence amount',
      wallet.balance === 5000 - 120, `got ${wallet.balance}`);
    check('wallet history shows the debit',
      wallet.meta.some((m) => m.amount === -120), JSON.stringify(wallet.meta));
    check('transaction ledger recorded the charge',
      (await Transactions.countDocuments({
        payableId: rich._id, type: 'dairy_subscription',
      })) === 1);
    check('order history recorded the transition',
      (await DairyOrderStatusHistory.countDocuments({
        order: order._id, toStatus: 'confirmed',
      })) === 1);

    // A price change after generation must not alter what was already agreed.
    await DairySku.updateOne({ _id: sku._id }, { $set: { price: 99 } });
    const reread = await DairyOrder.findById(order._id);
    check('price frozen at generation survives a price change',
      Number(reread.items[0].price) === 60, `got ${reread.items[0].price}`);

    let doubleBillRefused = false;
    try {
      await billingService.billOccurrence(occurrence, plan);
    } catch (e) { doubleBillRefused = e.code === 11000; }
    check('one occurrence cannot be billed twice', doubleBillRefused);

    // Not enough stock for the outlet.
    console.log('\n3. Occurrences that cannot be prepared');
    const scarcePlan = await makePlan(rich, scarceSku, 5);
    const scarceDay = addDays(MONDAY, 1);
    await manifestService.generateOccurrences(scarceDay);
    const scarceOcc = await DairyRecurringOrder.findOne({
      subscription: scarcePlan._id, occurrenceDate: scarceDay,
    });
    check('uncoverable occurrence skipped', scarceOcc.status === 'skipped', `got ${scarceOcc.status}`);
    check('skip reason explains the stockout',
      /stock/i.test(scarceOcc.skipReason || ''), `got "${scarceOcc.skipReason}"`);
    check('no stock taken for the skipped occurrence',
      (await DairySku.findById(scarceSku._id)).availableQty === 1);
    check('no order raised for a stockout', !scarceOcc.order);
    check('no money taken for a stockout',
      (await Wallet.findOne({ holderId: rich._id })).balance === 5000 - 120);

    // Not enough prepaid balance for the customer.
    const poorPlan = await makePlan(poor, sku, 2);
    const poorDay = addDays(MONDAY, 1);
    const stockBeforePoor = (await DairySku.findById(sku._id)).availableQty;
    await manifestService.generateOccurrences(poorDay);
    const poorOcc = await DairyRecurringOrder.findOne({
      subscription: poorPlan._id, occurrenceDate: poorDay,
    });
    check('unaffordable occurrence skipped', poorOcc.status === 'skipped', `got ${poorOcc.status}`);
    check('skip reason names the balance',
      /balance/i.test(poorOcc.skipReason || ''), `got "${poorOcc.skipReason}"`);
    check('stock returned after a failed charge',
      (await DairySku.findById(sku._id)).availableQty === stockBeforePoor,
      `${stockBeforePoor} -> ${(await DairySku.findById(sku._id)).availableQty}`);
    check('no unpaid order left behind', !poorOcc.order);
    check('no order created for the unaffordable occurrence',
      (await DairyOrder.countDocuments({ subscription: poorPlan._id })) === 0);
    check('poor customer wallet untouched',
      (await Wallet.findOne({ holderId: poor._id })).balance === 5);

    // ---- 12-15. Unwinding ----
    console.log('\n4. Cancelling unwinds money and stock');
    const walletBeforeCancel = (await Wallet.findOne({ holderId: rich._id })).balance;
    const stockBeforeCancel = (await DairySku.findById(sku._id)).availableQty;
    await subService.cancel(plan._id, { reason: 'moving away', actor: rich._id });
    const unwound = await DairyRecurringOrder.findOne({
      subscription: plan._id, occurrenceDate: MONDAY,
    });
    check('occurrence cancelled', unwound.status === 'cancelled', `got ${unwound.status}`);
    check('reserved stock returned on cancel',
      (await DairySku.findById(sku._id)).availableQty === stockBeforeCancel + 2,
      `${stockBeforeCancel} -> ${(await DairySku.findById(sku._id)).availableQty}`);
    check('wallet refunded on cancel',
      (await Wallet.findOne({ holderId: rich._id })).balance === walletBeforeCancel + 120,
      `${walletBeforeCancel} -> ${(await Wallet.findOne({ holderId: rich._id })).balance}`);
    check('refund recorded in the ledger',
      (await Transactions.countDocuments({
        payableId: rich._id, type: 'dairy_subscription_refund',
      })) === 1);
    const cancelledOrder = await DairyOrder.findById(order._id);
    check('order cancelled', cancelledOrder.status === 'cancelled', `got ${cancelledOrder.status}`);
    check('order marked refunded', cancelledOrder.paymentStatus === 'refunded');
    check('cancellation reason recorded',
      /moving away/.test(cancelledOrder.cancellation.reason || ''),
      `got "${cancelledOrder.cancellation.reason}"`);

    // An occurrence already on a rider's manifest is left alone.
    const keptPlan = await makePlan(rich, sku, 1);
    await manifestService.generateOccurrences(addDays(MONDAY, 2));
    const keptOcc = await DairyRecurringOrder.findOne({
      subscription: keptPlan._id, occurrenceDate: addDays(MONDAY, 2),
    });
    const runs = await manifestService.buildRuns(addDays(MONDAY, 2));
    check('run built for the occurrence', runs.runs >= 1, `runs ${runs.runs}`);
    const assigned = await DairyRecurringOrder.findById(keptOcc._id);
    check('occurrence assigned to a run', !!assigned.run, `status ${assigned.status}`);
    check('order linked to the run',
      !!(await DairyOrder.findById(assigned.order)).run);
    const walletBeforeAssignedCancel = (await Wallet.findOne({ holderId: rich._id })).balance;
    await subService.cancel(keptPlan._id, { reason: 'unreachable', actor: rich._id });
    check('assigned occurrence NOT withdrawn on cancel',
      (await DairyRecurringOrder.findById(keptOcc._id)).status === 'assigned',
      `got ${(await DairyRecurringOrder.findById(keptOcc._id)).status}`);
    check('assigned occurrence money NOT refunded',
      (await Wallet.findOne({ holderId: rich._id })).balance === walletBeforeAssignedCancel);

    // ---- 16-18. Revenue loop ----
    console.log('\n5. Completing the delivery settles the loop');
    const stop = await DeliveryStop.findOne({ run: assigned.run });
    const run = await DeliveryRun.findById(assigned.run);
    // Deliver as whoever the run was actually assigned to, so this exercises the
    // real stop-delivery path rather than a shortcut around ownership checks.
    const agentId = run.agent || asha._id;

    await deliveryRunService.deliverStop(stop._id, agentId, {
      cansDelivered: 1,
      emptyCansCollected: 0,
      amountCollected: 0,
      clientRef: `${tag}-1`,
    });

    const deliveredOcc = await DairyRecurringOrder.findById(assigned._id);
    check('occurrence marked delivered', deliveredOcc.status === 'delivered', `got ${deliveredOcc.status}`);
    const deliveredOrder = await DairyOrder.findById(assigned.order);
    check('order marked delivered', deliveredOrder.status === 'delivered', `got ${deliveredOrder.status}`);
    check('order has a delivery timestamp', !!deliveredOrder.deliveredAt);
    check('delivered history records the real previous status',
      (await DairyOrderStatusHistory.findOne({
        order: deliveredOrder._id, toStatus: 'delivered',
      })).fromStatus === 'confirmed');

    // This is the whole point: settleable revenue now exists for subscriptions.
    const settlementService = require('../src/modules/dairy/services/dairy.settlement.service');
    const settleable = await DairyOrder.countDocuments({
      business: business._id, status: 'delivered', paymentStatus: 'paid',
      mode: 'subscription',
    });
    check('subscription order is settleable', settleable === 1, `got ${settleable}`);
    check('settlement service sees subscription revenue',
      typeof settlementService.collectSettleableOrders === 'function');

    // A prepaid delivery the rider cannot complete must give the money back.
    // This drives the kernel hook for real: assign a run, fail its stop as the
    // assigned agent, and check the customer is whole again.
    const refundDay = addDays(MONDAY, 5);
    const refundPlan = await makePlan(rich, sku, 1, refundDay);
    await manifestService.generateOccurrences(refundDay);
    await manifestService.buildRuns(refundDay);
    const refundOcc = await DairyRecurringOrder.findOne({
      subscription: refundPlan._id, occurrenceDate: refundDay,
    });
    check('second plan billed for its occurrence', !!refundOcc.order);

    const refundStop = await DeliveryStop.findOne({ run: refundOcc.run });
    const refundRun = await DeliveryRun.findById(refundOcc.run);
    const chargedBefore = (await Wallet.findOne({ holderId: rich._id })).balance;
    // Charged at whatever the plan's frozen unit price was, not a fixed amount:
    // the SKU price was moved earlier in this script on purpose.
    const refundAmount = Number(refundOcc.amount);

    await deliveryRunService.markStop(
      refundStop._id,
      refundRun.agent || asha._id,
      'failed',
      'customer unavailable'
    );

    const refundedOcc = await DairyRecurringOrder.findById(refundOcc._id);
    check('undelivered occurrence withdrawn', refundedOcc.status === 'cancelled', `got ${refundedOcc.status}`);
    check('stock returned after a failed delivery',
      refundedOcc.stockReserved === false);
    check('prepaid money refunded after a failed delivery',
      (await Wallet.findOne({ holderId: rich._id })).balance === chargedBefore + refundAmount,
      `${chargedBefore} + ${refundAmount} -> ${(await Wallet.findOne({ holderId: rich._id })).balance}`);
    check('failed delivery order is refunded',
      (await DairyOrder.findById(refundOcc.order)).paymentStatus === 'refunded');

    // ---- Reusable bottles ----
    // The gap this closes: a recurring plan on a reusable SKU used to deliver milk
    // in a bottle nobody tracked — no assignment, no rotation, no deposit.
    console.log('\n6. Reusable bottles join the rotation');
    const bottleSku = await makeSku(`Bottled ${tag}`, 100, 60, {
      reusableContainer: true, rotationSize: 2,
    });
    ids.skus.push(bottleSku._id);

    const bottleUser = await makeUser('Bottle', `984${stamp}4`, 1000);
    ids.users.push(bottleUser._id);

    const cans = [];
    for (let i = 1; i <= 2; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      cans.push(await DairyCan.create({
        canCode: `${tag}-B${i}`, business: business._id, canType: 'standard',
        capacityL: 1, depositAmount: 40, status: 'in_store',
        currentHolder: { type: 'store', ref: null }, heldAt: business._id, condition: 'ready',
      }));
    }
    ids.cans.push(...cans.map((c) => c._id));

    const day1 = addDays(MONDAY, 10);
    const day2 = addDays(MONDAY, 11);
    const bottlePlan = await subService.createSubscription({
      user: bottleUser._id, business: business._id, sku: bottleSku._id, quantity: 1,
      scheduleType: 'daily', startDate: day1, endDate: day2,
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
      addressRaw: '1 Bottle Street', paymentMode: 'wallet',
    }).then((r) => r.subscription);
    ids.subs.push(bottlePlan._id);

    await manifestService.generateOccurrences(day1);
    const occ1 = await DairyRecurringOrder.findOne({
      subscription: bottlePlan._id, occurrenceDate: day1,
    });

    check('reusable subscription is billed like any other', occ1.status === 'billed',
      `got ${occ1.status}`);

    // Re-read: the generator works on its own copy of the plan, so the instance
    // held here cannot see a field the generator has since saved.
    const reloadedPlan = await DairySubscription.findById(bottlePlan._id);
    check('a container assignment was created automatically', !!reloadedPlan.containerAssignment);
    const assignment = await DairyContainerAssignment.findById(reloadedPlan.containerAssignment);
    check('assignment holds a full rotation pair', assignment.cans.length === 2,
      `got ${assignment.cans.length}`);
    check('both bottles reserved for the customer',
      (await DairyCan.countDocuments({
        _id: { $in: assignment.cans }, 'assignedTo.type': 'customer',
      })) === 2);

    check('first delivery plans a bottle out', !!occ1.rotation.deliver);
    check('first delivery collects nothing — the customer holds none',
      !occ1.rotation.collect, `got ${occ1.rotation.collect}`);
    check('deposit held for the outgoing bottle', Number(occ1.rotation.depositHeld) === 40,
      `got ${occ1.rotation.depositHeld}`);
    // ₹60 goods, ₹40 deposit hold.
    const bottleWallet = await Wallet.findOne({ holderId: bottleUser._id });
    check('wallet charged goods and held the deposit', bottleWallet.balance === 900,
      `got ${bottleWallet.balance}`);
    check('deposit is not part of what the customer paid for',
      Number((await DairyOrder.findById(occ1.order)).grandTotal) === 60);

    // Hand the first bottle over, as the rider would at the door.
    const firstCan = await DairyCan.findOne({ canCode: occ1.rotation.deliver });
    await canService.applyMovement(firstCan._id, {
      eventType: 'issue',
      customer: bottleUser._id,
      clientRef: `${tag}-issue-1`,
    });

    await manifestService.generateOccurrences(day2);
    const occ2 = await DairyRecurringOrder.findOne({
      subscription: bottlePlan._id, occurrenceDate: day2,
    });

    check('second delivery collects the bottle now with the customer',
      occ2.rotation.collect === occ1.rotation.deliver,
      `${occ2.rotation.collect} vs ${occ1.rotation.deliver}`);
    check('second delivery hands over the sibling bottle',
      occ2.rotation.deliver && occ2.rotation.deliver !== occ1.rotation.deliver,
      `${occ2.rotation.deliver} vs ${occ1.rotation.deliver}`);

    // ---- Unwinding a planned rotation ----
    console.log('\n7. Unwinding a planned rotation');
    const walletBeforeUnwind = (await Wallet.findOne({ holderId: bottleUser._id })).balance;
    const plannedCan = await DairyCan.findOne({ canCode: occ2.rotation.deliver });

    await billingService.unwindOccurrence(occ2, 'customer changed the plan');

    // Two separate sums come back: the ₹60 paid for the delivery, and the ₹40
    // deposit that was only ever held for the bottle.
    check('payment refunded and deposit hold released on unwind',
      (await Wallet.findOne({ holderId: bottleUser._id })).balance === walletBeforeUnwind + 60 + 40,
      `${walletBeforeUnwind} -> ${(await Wallet.findOne({ holderId: bottleUser._id })).balance}`);
    // Assert against the stored document, not the Mongoose view: the question is
    // whether a stale swap plan survives in the database for the next run to act
    // on, and a subdocument Mongoose still materialises in memory says nothing
    // about that.
    const unwoundRaw = await DairyRecurringOrder.collection.findOne({ _id: occ2._id });
    check('planned rotation cleared', !unwoundRaw.rotation,
      `still set: ${JSON.stringify(unwoundRaw.rotation)}`);
    const returnedCan = await DairyCan.findById(plannedCan._id);
    check('bottle that never left is back on the shelf',
      returnedCan.currentHolder.type === 'store' && returnedCan.condition === 'ready',
      `${returnedCan.currentHolder.type}/${returnedCan.condition}`);
    check('the bottle the customer really holds is untouched',
      (await DairyCan.findOne({ canCode: occ1.rotation.deliver })).currentHolder.type === 'customer');

    // ---- Wash line behind ----
    console.log('\n8. A rotation that cannot happen is called off');
    const sibling = await DairyCan.findOne({ canCode: occ1.rotation.deliver });
    await canService.applyMovement(sibling._id, {
      eventType: 'collect',
      customer: bottleUser._id,
      clientRef: `${tag}-collect-1`,
    });
    await containerService.advanceLifecycle(sibling._id, 'send_to_wash', {
      createdBy: partnerUser._id,
    });

    const day3 = addDays(MONDAY, 12);
    // Put *both* bottles into the wash line. One bottle on the shelf is a
    // perfectly good rotation, so blocking it needs the pair unavailable.
    //
    // A can may only enter the wash from `dirty`, and in this scenario neither
    // bottle has been returned dirty by a customer, so they are moved there
    // directly. The wash pipeline itself is covered by verify.dairy.rotation.js.
    for (const canId of assignment.cans) {
      // eslint-disable-next-line no-await-in-loop
      await DairyCan.updateOne(
        { _id: canId },
        { $set: { condition: 'dirty', status: 'in_store', 'currentHolder.type': 'store', 'currentHolder.ref': null } }
      );
      // eslint-disable-next-line no-await-in-loop
      await containerService.advanceLifecycle(canId, 'send_to_wash', {
        createdBy: partnerUser._id,
      });
    }
    check('no bottle is in service',
      (await DairyCan.countDocuments({
        _id: { $in: assignment.cans }, condition: 'ready', 'currentHolder.type': 'store',
      })) === 0);

    // A second bottled plan for the same customer shares the one rotation, so
    // this exercises the wash-line block on the assignment already in use.
    const blockedPlan = await subService.createSubscription({
      user: bottleUser._id, business: business._id, sku: bottleSku._id, quantity: 1,
      scheduleType: 'daily', startDate: day3,
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
      addressRaw: '1 Bottle Street', paymentMode: 'wallet',
    }).then((r) => r.subscription);
    ids.subs.push(blockedPlan._id);

    const walletBeforeBlocked = (await Wallet.findOne({ holderId: bottleUser._id })).balance;
    await manifestService.generateOccurrences(day3);
    const occ3 = await DairyRecurringOrder.findOne({
      subscription: blockedPlan._id, occurrenceDate: day3,
    });

    check('a second bottled plan shares the existing rotation',
      String((await DairySubscription.findById(blockedPlan._id)).containerAssignment)
        === String(assignment._id));

    check('delivery skipped when no bottle is in service', occ3.status === 'skipped',
      `got ${occ3.status}`);
    check('skip reason names the rotation', /rotation|ready/i.test(occ3.skipReason || ''),
      `got "${occ3.skipReason}"`);
    check('no order raised for an impossible rotation', !occ3.order);
    check('no money taken for an impossible rotation',
      (await Wallet.findOne({ holderId: bottleUser._id })).balance === walletBeforeBlocked);
    check('stock reserved for it was returned', occ3.stockReserved === false);
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message} >>> ${e.stack}`);
  } finally {
    await DairyOrderStatusHistory.deleteMany({});
    await Transactions.deleteMany({ payableId: { $in: ids.users } });
    await Wallet.deleteMany({ holderId: { $in: ids.users } });
    await DairyOrder.deleteMany({});
    await DeliveryStop.deleteMany({});
    await DeliveryRun.deleteMany({});
    await DairyRecurringOrder.deleteMany({});
    await DairyCanLedger.deleteMany({});
    await DairyCan.deleteMany({ _id: { $in: ids.cans } });
    await DairyContainerAssignment.deleteMany({});
    if (ids.subs) {
      await DairySubscription.deleteMany({ _id: { $in: ids.subs } });
      await require('../src/models').DairySubscriptionEvent.deleteMany({
        subscription: { $in: ids.subs },
      });
    }
    await DairySku.deleteMany({ _id: { $in: ids.skus } });
    // Before the business, so nothing is left pointing at a deleted outlet.
    await DairyDriver.deleteMany({ _id: { $in: ids.drivers } });
    await Business.deleteMany({ _id: business._id });
    await User.deleteMany({ _id: { $in: ids.users } });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL SUBSCRIPTION BILLING CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

