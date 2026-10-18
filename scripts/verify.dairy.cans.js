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
 * End-to-end verification of can custody and deposit handling.
 *
 * The scenario is a physically coherent milk round. The customer already holds
 * two empty cans from yesterday (`B*`), so their deposit is already held. This
 * morning the rider loads two FULL cans (`A*`) plus the two empties to bring
 * back, hands over the full cans, and collects yesterday's empties:
 *
 *     depot      : load 2 full + 2 empties
 *     at the door: issue A1, A2      (deposit ₹100 held)
 *                  collect B1, B2    (deposit ₹100 released)
 *     depot      : return 2 empties
 *
 * Asserts registration, unique canCode, custody transitions, wallet
 * hold/release symmetry, offline idempotency, invalid-operation rejection, the
 * ledger balance formula, and reconciliation including a shortfall write-off.
 *
 * Cleans up everything it creates.
 *
 * Usage: node scripts/verify.dairy.cans.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  Wallet,
  DairyCan,
  DairyCanLedger,
  DeliveryRun,
  DeliveryStop,
} = require('../src/models');
const dairyCanService = require('../src/modules/dairy/services/dairy.can.service');
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

const day = () => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
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
  const business = await Business.findOne({ owner: asha._id });
  const agent = asha._id.toString();

  const tag = `T${Date.now().toString().slice(-6)}`;
  const fullCodes = [`${tag}-A1`, `${tag}-A2`];
  const emptyCodes = [`${tag}-B1`, `${tag}-B2`];
  const allCodes = [...fullCodes, ...emptyCodes];

  // Money fields use a rupees-in / paise-out setter, so these are RUPEE values.
  // Passing 5000 for a deposit would silently mean ₹5,000.
  const DEPOSIT = 50; // ₹50 per can

  const customerMobile = `92${Date.now().toString().slice(-8)}`;
  const customer = await User.create({
    firstName: 'Can',
    lastName: 'Test',
    countryCode: '+91',
    mobile: Number(customerMobile),
    email: `${customerMobile}@can.local`,
    password: 'Customer@123',
    role: 'user',
    status: true,
    locale: 'en',
  });

  // Opening balance ₹300: ₹200 already held against yesterday's two cans,
  // plus ₹100 of spendable credit.
  const wallet = await Wallet.create({
    holderId: customer._id,
    balance: 300,
    description: 'Dairy can test wallet',
    status: true,
  });

  const createdRuns = [];

  try {
    // ---- 1. Registration ----
    console.log('\n1. Can registration');
    for (const code of fullCodes) {
      await DairyCan.create({
        canCode: code,
        business: business._id,
        canType: 'standard',
        capacityL: 1,
        depositAmount: DEPOSIT,
        status: 'in_store',
        currentHolder: { type: 'store', ref: null },
        heldAt: business._id,
        condition: 'ready',
      });
    }
    // Yesterday's empties already sitting at the customer's door, deposit held.
    for (const code of emptyCodes) {
      const can = await DairyCan.create({
        canCode: code,
        business: business._id,
        canType: 'standard',
        capacityL: 1,
        depositAmount: DEPOSIT,
        status: 'with_customer',
        currentHolder: { type: 'customer', ref: customer._id },
        heldAt: business._id,
        issuedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        condition: 'ready',
      });
      await DairyCanLedger.create({
        can: can._id,
        business: business._id,
        eventType: 'issue',
        customer: customer._id,
        fromHolder: 'store',
        toHolder: 'customer',
        amount: DEPOSIT,
        note: 'Prior run',
      });
      await DairyCanLedger.create({
        can: can._id,
        business: business._id,
        eventType: 'deposit_held',
        customer: customer._id,
        fromHolder: 'store',
        toHolder: 'customer',
        amount: DEPOSIT,
        note: 'Prior run',
      });
    }

    check('4 cans exist', (await DairyCan.countDocuments({ canCode: { $in: allCodes } })) === 4);

    let dupRejected = false;
    try {
      await DairyCan.create({ canCode: fullCodes[0], business: business._id, depositAmount: DEPOSIT });
    } catch (e) {
      dupRejected = e.code === 11000;
    }
    check('duplicate canCode rejected by unique index', dupRejected);

    const openingDeposit = await dairyCanService.getCustomerDepositSummary(customer._id);
    check('customer starts holding 2 cans worth ₹100', openingDeposit.canCount === 2 && openingDeposit.depositOutstanding === 100,
      `count=${openingDeposit.canCount} outstanding=${openingDeposit.depositOutstanding}`);

    // ---- 2. Build a run and load the crate ----
    console.log('\n2. Depot pickup');
    const runDoc = await deliveryRunService.createRun({
      business: business._id,
      serviceDate: day(),
      slot: { startTime: '06:00', endTime: '08:00' },
      stops: [
        {
          customer: customer._id,
          addressRaw: 'Can Test Address',
          receiverName: 'Can Test',
          cansOut: 2,
          amountDue: 12000,
          paymentMode: 'cod',
        },
      ],
    });
    createdRuns.push(runDoc._id);
    const stopId = (await DeliveryStop.findOne({ run: runDoc._id }))._id;

    // Record the depot load: 2 full to issue, 2 empties to bring back.
    await DeliveryRun.updateOne(
      { _id: runDoc._id },
      {
        $set: {
          status: 'in_progress',
          startedAt: new Date(),
          pickup: { completedAt: new Date(), cansLoaded: 2, cansLoadedForReturn: 2 },
        },
      }
    );

    await dairyCanService.applyScanBatch({
      eventType: 'pickup',
      clientRef: `${tag}-pickup`,
      run: runDoc._id,
      agent,
      createdBy: agent,
      canCodes: fullCodes,
    });

    check('both full cans move to with_agent',
      (await DairyCan.countDocuments({ canCode: { $in: fullCodes }, status: 'with_agent' })) === 2);
    // Empties stay with the customer until the rider reaches the door.
    check('empties remain with_customer until collected',
      (await DairyCan.countDocuments({ canCode: { $in: emptyCodes }, status: 'with_customer' })) === 2);

    // ---- 3. Issue full cans, deposit held ----
    console.log('\n3. Issue to customer (deposit held)');
    await dairyCanService.issueCans({
      clientRef: `${tag}-issue`,
      run: runDoc._id,
      stop: stopId,
      customer: customer._id,
      agent,
      createdBy: agent,
      canCodes: fullCodes,
    });

    const walletAfterIssue = await Wallet.findById(wallet._id);
    check('wallet debited ₹100 (300 -> 200)', walletAfterIssue.balance === 200, `got ${walletAfterIssue.balance}`);
    check('deposit_held written for this run',
      (await DairyCanLedger.countDocuments({ run: runDoc._id, eventType: 'deposit_held' })) === 2);

    // ---- 4. Offline idempotency ----
    console.log('\n4. Idempotency on replay');
    const replay = await dairyCanService.issueCans({
      clientRef: `${tag}-issue`,
      run: runDoc._id,
      stop: stopId,
      customer: customer._id,
      agent,
      createdBy: agent,
      canCodes: fullCodes,
    });
    const walletAfterReplay = await Wallet.findById(wallet._id);
    check('replay reported as duplicate', replay.duplicates === 2 && replay.depositHeld === 0,
      `dup=${replay.duplicates} held=${replay.depositHeld}`);
    check('replay does NOT double-debit', walletAfterReplay.balance === 200, `got ${walletAfterReplay.balance}`);

    // ---- 5. Invalid operations ----
    console.log('\n5. Invalid operations');
    let unknownRejected = false;
    try {
      await dairyCanService.applyScanBatch({
        eventType: 'pickup', clientRef: `${tag}-bad`, run: runDoc._id,
        agent, createdBy: agent, canCodes: ['NOPE-999'],
      });
    } catch (e) { unknownRejected = e.statusCode === 404; }
    check('unknown can code rejected', unknownRejected);

    let doubleIssueRejected = false;
    try {
      await dairyCanService.applyMovement(
        (await DairyCan.findOne({ canCode: fullCodes[0] }))._id,
        { eventType: 'issue', run: runDoc._id, stop: stopId, customer: customer._id, agent, createdBy: agent }
      );
    } catch (e) { doubleIssueRejected = e.statusCode === 400; }
    check('re-issuing a can already with a customer is rejected', doubleIssueRejected);

    // ---- 6. Collect yesterday's empties, deposit released ----
    console.log('\n6. Collect empties (deposit released)');
    await dairyCanService.collectCans({
      clientRef: `${tag}-collect`,
      run: runDoc._id,
      stop: stopId,
      agent,
      createdBy: agent,
      canCodes: emptyCodes,
    });

    const walletAfterCollect = await Wallet.findById(wallet._id);
    check('wallet credited ₹100 back (200 -> 300)', walletAfterCollect.balance === 300, `got ${walletAfterCollect.balance}`);

    const afterCollect = await dairyCanService.getCustomerDepositSummary(customer._id);
    check("customer now holds 2 cans worth ₹100 (this morning's)",
      afterCollect.canCount === 2 && afterCollect.depositOutstanding === 100,
      `count=${afterCollect.canCount} outstanding=${afterCollect.depositOutstanding}`);

    // ---- 7. Ledger balance ----
    console.log('\n7. Ledger balance');
    const balance = await dairyCanService.getRunBalance(runDoc._id);
    check('pickup (sealed) = 2', balance.pickup === 2, `got ${balance.pickup}`);
    check('issue = 2', balance.issue === 2, `got ${balance.issue}`);
    check('collect = 2', balance.collect === 2, `got ${balance.collect}`);
    // 2 empties collected + 0 undelivered sealed = 2
    check('expectedBackOnAgent = 2', balance.expectedBackOnAgent === 2, `got ${balance.expectedBackOnAgent}`);

    // ---- 8. Balanced reconciliation ----
    console.log('\n8. Reconciliation');
    let blocked = false;
    try {
      await dairyCanService.reconcileRun(runDoc._id, business._id, { cansReturned: 3, createdBy: agent });
    } catch (e) { blocked = e.statusCode === 409; }
    check('over-declared return refused without reason (409)', blocked);

    const reconciled = await dairyCanService.reconcileRun(runDoc._id, business._id, {
      cansReturned: 2,
      createdBy: agent,
    });
    check('balanced close succeeds with variance 0', reconciled.run.returnLeg.variance === 0,
      `got ${reconciled.run.returnLeg.variance}`);
    check('both empties returned to store', reconciled.returnedCount === 2, `got ${reconciled.returnedCount}`);
    check('nothing written off when balanced', reconciled.writtenOffCount === 0, `got ${reconciled.writtenOffCount}`);

    const walletFinal = await Wallet.findById(wallet._id);
    check('wallet back to opening balance ₹300', walletFinal.balance === 300, `got ${walletFinal.balance}`);

    // ---- 9. Shortfall write-off ----
    console.log('\n9. Shortfall write-off');
    const run2 = await deliveryRunService.createRun({
      business: business._id,
      serviceDate: day(),
      slot: { startTime: '06:00', endTime: '08:00' },
      stops: [
        { customer: customer._id, addressRaw: 'Can Test Address', receiverName: 'Can Test', cansOut: 2, amountDue: 12000 },
      ],
    });
    createdRuns.push(run2._id);
    await DeliveryRun.updateOne(
      { _id: run2._id },
      { $set: { status: 'in_progress', startedAt: new Date(), pickup: { completedAt: new Date(), cansLoaded: 2, cansLoadedForReturn: 2 } } }
    );
    const stop2Id = (await DeliveryStop.findOne({ run: run2._id }))._id;

    const c3 = [`${tag}-C1`, `${tag}-C2`];
    allCodes.push(...c3);
    for (const code of c3) {
      await DairyCan.create({
        canCode: code, business: business._id, canType: 'standard', capacityL: 1,
        depositAmount: DEPOSIT, status: 'in_store',
        currentHolder: { type: 'store', ref: null }, heldAt: business._id, condition: 'ready',
      });
    }

    await dairyCanService.applyScanBatch({
      eventType: 'pickup', clientRef: `${tag}-p2`, run: run2._id,
      agent, createdBy: agent, canCodes: c3,
    });
    await dairyCanService.issueCans({
      clientRef: `${tag}-i2`, run: run2._id, stop: stop2Id,
      customer: customer._id, agent, createdBy: agent, canCodes: c3.slice(0, 1),
    });

    // 2 sealed loaded, 1 issued, 0 empties collected → 1 undelivered full.
    const bal2 = await dairyCanService.getRunBalance(run2._id);
    check('second run expects 1 back (1 undelivered sealed can)',
      bal2.expectedBackOnAgent === 1, `got ${bal2.expectedBackOnAgent}`);

    let shortBlocked = false;
    try {
      await dairyCanService.reconcileRun(run2._id, business._id, { cansReturned: 0, createdBy: agent });
    } catch (e) { shortBlocked = e.statusCode === 409; }
    check('short return refused without a reason (409)', shortBlocked);

    const shortReconciled = await dairyCanService.reconcileRun(run2._id, business._id, {
      cansReturned: 0,
      reason: 'One sealed can left at the depot unaccounted',
      createdBy: agent,
    });
    check('shortfall variance = -1', shortReconciled.run.returnLeg.variance === -1,
      `got ${shortReconciled.run.returnLeg.variance}`);
    check('one can written off', shortReconciled.writtenOffCount === 1, `got ${shortReconciled.writtenOffCount}`);
    check('reason retained for admin review', !!shortReconciled.run.returnLeg.adjustmentReason);

    const notDangling = await DairyCan.countDocuments({
      canCode: { $in: c3 }, status: 'with_agent',
    });
    check('no can left dangling in with_agent', notDangling === 0, `got ${notDangling}`);
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message}`);
  } finally {
    const canIds = (await DairyCan.find({ canCode: { $in: allCodes } }).select('_id')).map((c) => c._id);
    await DairyCanLedger.deleteMany({ can: { $in: canIds } });
    await DairyCan.deleteMany({ canCode: { $in: allCodes } });
    for (const r of createdRuns) {
      await DeliveryStop.deleteMany({ run: r });
      await DeliveryRun.deleteMany({ _id: r });
    }
    await Wallet.deleteMany({ _id: wallet._id });
    await User.deleteMany({ _id: customer._id });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL CAN-LIFECYCLE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});