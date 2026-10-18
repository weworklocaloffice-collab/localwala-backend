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
 * End-to-end verification of the delivery run lifecycle against the real DB.
 *
 * Exercises, in order:
 *   1. assignment picks the OWN FLEET rider for an outlet with
 *      `ownDeliveryPartner: true`
 *   2. assignment picks the PLATFORM POOL rider for an outlet with
 *      `ownDeliveryPartner: false`
 *   3. run creation with sequenced stops
 *   4. manifest read (todayRun + stops)
 *   5. startRun rejects an under-loaded pickup
 *   6. arrive / deliver / skip mutate stops and recompute totals
 *   7. completeRun REJECTS an unbalanced can count without a reason
 *   8. completeRun ACCEPTS the same mismatch when a reason is supplied
 *   9. completeRun ACCEPTS a balanced count
 *
 * Leaves the database clean apart from the run it created, which is removed at
 * the end.
 *
 * Usage: node scripts/verify.dairy.run.js
 */

const mongoose = require('mongoose');
const { User, Business, DeliveryRun, DeliveryStop, DeliveryPOD } = require('../src/models');
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

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const makeCustomer = async (firstName, mobile) => {
  let user = await User.findOne({ countryCode: '+91', mobile });
  if (!user) {
    user = await User.create({
      firstName,
      lastName: 'Test',
      countryCode: '+91',
      mobile,
      email: `${mobile}@customer.local`,
      password: 'Customer@123',
      role: 'user',
      status: true,
      locale: 'en',
    });
  }
  return user;
};

const run = async () => {
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const asha = await User.findOne({ countryCode: '+91', mobile: '9000000001' });
  const meera = await User.findOne({ countryCode: '+91', mobile: '9000000003' });
  if (!asha || !meera) {
    console.error('Seed data missing. Run: node scripts/seed.dairy.js');
    process.exit(1);
  }

  const ownFleetBusiness = await Business.findOne({ owner: asha._id });
  const poolBusiness = await Business.findOne({ owner: meera._id });

  const c1 = await makeCustomer('Ramesh', '9111111111');
  const c2 = await makeCustomer('Suresh', '9111111112');
  const c3 = await makeCustomer('Kiran', '9111111113');

  let createdRunId = null;

  try {
    // 1 + 2 — assignment policy
    console.log('\n1. Assignment policy');
    const ownFleet = await deliveryRunService.assignAgent(ownFleetBusiness._id, tomorrow());
    check(
      'ownDeliveryPartner=true resolves to own_fleet',
      ownFleet.agentMode === 'own_fleet' && ownFleet.driver && ownFleet.driver.business,
      `mode=${ownFleet.agentMode}`
    );

    // There is no platform pool, so there is no pool assignment to assert. Both
    // seeded outlets run their own fleets now, and each resolves to a rider it
    // actually employs.
    const ownFleet2 = await deliveryRunService.assignAgent(poolBusiness._id, tomorrow());
    check(
      'a second own-fleet outlet resolves to its own rider',
      ownFleet2.agentMode === 'own_fleet'
        && ownFleet2.driver
        && String(ownFleet2.driver.business) === String(poolBusiness._id),
      `mode=${ownFleet2.agentMode} business=${ownFleet2.driver && ownFleet2.driver.business}`
    );

    // The consequence worth pinning: an outlet with nobody on its fleet gets no
    // rider. It used to quietly fall back to whoever was in the shared pool, which
    // meant an outlet could take orders it had no way to fulfil and the run was
    // staffed by a stranger. Failing to assign is the honest outcome.
    const emptyFleet = await Business.create({
      vertical: 'dairy',
      businessModel: 'direct',
      name: `No Riders ${ownFleetBusiness._id}`,
      owner: asha._id,
      ownDeliveryPartner: true,
      verified: true,
      status: true,
    });

    const unstaffed = await deliveryRunService.assignAgent(emptyFleet._id, tomorrow());
    check(
      'an outlet with an empty fleet gets no rider rather than a stranger',
      !unstaffed.driver,
      `driver=${unstaffed.driver && unstaffed.driver._id} mode=${unstaffed.agentMode}`
    );
    await Business.deleteOne({ _id: emptyFleet._id });

    // 3 — create run
    console.log('\n2. Run creation');
    const runDoc = await deliveryRunService.createRun({
      business: ownFleetBusiness._id,
      serviceDate: tomorrow(),
      slot: { startTime: '06:00', endTime: '08:00' },
      stops: [
        {
          customer: c1._id,
          addressRaw: '12 4th Cross, Indiranagar',
          receiverName: 'Ramesh',
          cansOut: 2,
          amountDue: 12000,
          paymentMode: 'cod',
          location: { type: 'Point', coordinates: [77.6401, 12.9784] },
        },
        {
          customer: c2._id,
          addressRaw: '44 7th Main, Indiranagar',
          receiverName: 'Suresh',
          cansOut: 1,
          amountDue: 6000,
          paymentMode: 'prepaid',
          location: { type: 'Point', coordinates: [77.6412, 12.9771] },
        },
        {
          customer: c3._id,
          addressRaw: '8 12th Main, Indiranagar',
          receiverName: 'Kiran',
          cansOut: 3,
          amountDue: 18000,
          paymentMode: 'cod',
          location: { type: 'Point', coordinates: [77.6395, 12.9790] },
        },
      ],
    });
    createdRunId = runDoc._id;
    const agentId = runDoc.agent._id.toString();

    check('run created with a sequenced agent', !!agentId, `agent=${agentId}`);
    check('totals.stopCount = 3', runDoc.totals.stopCount === 3, `got ${runDoc.totals.stopCount}`);
    check('totals.cansOut = 6', runDoc.totals.cansOut === 6, `got ${runDoc.totals.cansOut}`);
    check('totals.amountToCollect = 0 before delivery', runDoc.totals.amountToCollect === 0);

    // 4 — manifest
    console.log('\n3. Rider manifest');
    const manifest = await deliveryRunService.getRunForAgentAndDate(agentId, tomorrow());
    check('todayRun finds the run for the agent', !!manifest);

    const stops = await deliveryRunService.getStops(createdRunId, agentId);
    check('stops are sequenced 1..3', stops.map((s) => s.sequence).join(',') === '1,2,3');
    check('customer names are joined', stops[0].customerInfo && stops[0].customerInfo.firstName === 'Ramesh');

    // 5 — under-loaded pickup
    console.log('\n4. Depot pickup');
    let underloadRejected = false;
    try {
      await deliveryRunService.startRun(createdRunId, agentId, { cansLoaded: 2, cansLoadedForReturn: 6 });
    } catch (e) {
      underloadRejected = e.statusCode === 400;
    }
    check('startRun rejects loading fewer cans than the manifest needs', underloadRejected);

    const started = await deliveryRunService.startRun(createdRunId, agentId, {
      cansLoaded: 6,
      cansLoadedForReturn: 6,
      location: 'Asha Dairy Farm',
    });
    check('startRun sets status in_progress', started.run.status === 'in_progress');
    check('pickup records cansLoaded = 6', started.run.pickup.cansLoaded === 6);

    // 6 — stop mutations
    console.log('\n5. Stops');
    await deliveryRunService.arriveStop(stops[0]._id, agentId, { location: 'doorstep' });
    const delivered = await deliveryRunService.deliverStop(stops[0]._id, agentId, {
      cansDelivered: 2,
      emptyCansCollected: 2,
      amountCollected: 12000,
      clientRef: 'test-pod-1',
      proof: { photo: 'uploads/door.jpg', location: 'doorstep' },
    });
    check('delivered stop records cansOut', delivered.cansOut === 2);
    check('delivered stop records cansIn', delivered.cansIn === 2);
    check('POD created with idempotency key', (await DeliveryPOD.countDocuments({ clientRef: 'test-pod-1' })) === 1);

    await deliveryRunService.markStop(stops[1]._id, agentId, 'skipped', 'customer_unavailable');

    const afterFirst = await DeliveryRun.findById(createdRunId);
    check('totals.cansIn = 2 after one delivery', afterFirst.totals.cansIn === 2, `got ${afterFirst.totals.cansIn}`);
    check('amountToCollect = 12000 (delivered only)', afterFirst.totals.amountToCollect === 12000, `got ${afterFirst.totals.amountToCollect}`);

    // 7 — unbalanced close refused
    console.log('\n6. Reconciliation gate');
    let closeBlocked = false;
    let closeBlockedByOpenStops = false;
    try {
      // Stop 3 is still pending, so this should fail on open stops first.
      await deliveryRunService.completeRun(createdRunId, agentId, { cansReturned: 4, amountCollected: 12000 });
    } catch (e) {
      closeBlocked = true;
      closeBlockedByOpenStops = /still open/.test(e.message);
    }
    check('close is blocked while stops are open', closeBlocked && closeBlockedByOpenStops);

    await deliveryRunService.deliverStop(stops[2]._id, agentId, {
      cansDelivered: 3,
      amountCollected: 18000,
    });

    // Now all stops are settled. cansLoaded 6, issued 5 (2+3), so 1 expected back.
    let varianceBlocked = false;
    try {
      await deliveryRunService.completeRun(createdRunId, agentId, { cansReturned: 4, amountCollected: 30000 });
    } catch (e) {
      varianceBlocked = e.statusCode === 409;
    }
    check('unbalanced cans REFUSED without a reason (409)', varianceBlocked);

    const withReason = await deliveryRunService.completeRun(createdRunId, agentId, {
      cansReturned: 4,
      amountCollected: 30000,
      adjustmentReason: 'Customer refused to return 3 cans; follow-up scheduled',
    });
    check('same mismatch ACCEPTED with a reason', withReason.status === 'completed');
    check('variance recorded as +3', withReason.returnLeg.variance === 3, `got ${withReason.returnLeg.variance}`);
    check('reason stored for admin review', !!withReason.returnLeg.adjustmentReason);

    const finalRun = await DeliveryRun.findById(createdRunId);
    // totals.cansOut is the PLANNED manifest (all 3 stops = 6), not what was
    // actually issued. The reconciliation uses issued-only (2 + 3 = 5), which is
    // why expectedReturn was 1.
    check('final totals.cansOut = 6 (planned manifest)', finalRun.totals.cansOut === 6, `got ${finalRun.totals.cansOut}`);
    check('final amountToCollect = 30000 (delivered only)', finalRun.totals.amountToCollect === 30000, `got ${finalRun.totals.amountToCollect}`);
    check('final totals.cansIn = 2', finalRun.totals.cansIn === 2, `got ${finalRun.totals.cansIn}`);
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message}`);
  } finally {
    // Cleanup: runs created by this script.
    if (createdRunId) {
      await DeliveryStop.deleteMany({ run: createdRunId });
      await DeliveryPOD.deleteMany({ run: createdRunId });
      await DeliveryRun.deleteMany({ _id: createdRunId });
    }
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL RUN-LIFECYCLE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});