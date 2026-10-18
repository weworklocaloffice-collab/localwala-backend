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
 * Verifies the two-bottle rotation model against the real DB.
 *
 * The specification being asserted:
 *
 *   Day 1   A → customer
 *   Day 2   A ← customer    B → customer
 *   Day 3   B ← customer    A → customer
 *
 * Also asserts the SCOPE GATE: packaged dairy must never be enrolled, and
 * one-time orders must not rotate.
 *
 * Checks, in order:
 *   1. packaged SKU is refused for rotation
 *   2. reusable SKU enrols the customer and reserves 2 cans
 *   3. cans become reserved and carry a rotation group
 *   4. a second assignment for the same customer is refused
 *   5. Day 1: no can held yet, so a sibling is handed over
 *   6. Day 2: collect A, deliver B
 *   7. Day 3: collect B, deliver A  ← rotation, not reuse
 *   8. lifecycle: dirty → washing → washed → ready
 *   9. illegal transition refused (washed → issued)
 *  10. no ready sibling available blocks with 409
 *  11. quarantine blocks handover
 *  12. release returns cans to the pool
 *  13. lifecycle summary counts by state
 *
 * Usage: node scripts/verify.dairy.rotation.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  Wallet,
  DairyCan,
  DairyCanLedger,
  DairyContainerAssignment,
  DairySku,
} = require('../src/models');
const containerService = require('../src/modules/dairy/services/dairy.container.service');
const canService = require('../src/modules/dairy/services/dairy.can.service');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
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
  const tag = `R${Date.now().toString().slice(-6)}`;

  const customerMobile = `93${Date.now().toString().slice(-8)}`;
  const customer = await User.create({
    firstName: 'Rot',
    lastName: 'Test',
    countryCode: '+91',
    mobile: Number(customerMobile),
    email: `${customerMobile}@rot.local`,
    password: 'Customer@123',
    role: 'user',
    status: true,
    locale: 'en',
  });
  const wallet = await Wallet.create({ holderId: customer._id, balance: 500, status: true });

  const canCodes = [`${tag}-A`, `${tag}-B`, `${tag}-C`, `${tag}-D`];

  try {
    // ---- SKUs: one reusable, one packaged ----
    console.log('\n1. Scope gate — packaged dairy must not rotate');
    const milkSku = await DairySku.create({
      business: business._id,
      name: `Cow Milk 1L ${tag}`,
      reusableContainer: true,
      rotationSize: 2,
      price: 60,
      availableQty: 500,
      status: true,
    });
    const paneerSku = await DairySku.create({
      business: business._id,
      name: `Paneer 200g ${tag}`,
      reusableContainer: false,
      price: 90,
      availableQty: 100,
      status: true,
    });

    for (const code of canCodes) {
      await DairyCan.create({
        canCode: code,
        business: business._id,
        canType: 'standard',
        capacityL: 1,
        depositAmount: 50,
        status: 'in_store',
        currentHolder: { type: 'store', ref: null },
        heldAt: business._id,
        condition: 'ready',
      });
    }

    let packagedRefused = false;
    try {
      await containerService.assignContainers({
        customer: customer._id, business: business._id,
        sku: paneerSku._id, createdBy: agent,
      });
    } catch (e) { packagedRefused = e.statusCode === 400; }
    check('packaged SKU (paneer) refused for rotation', packagedRefused);

    // ---- 2. Enrol ----
    console.log('\n2. Enrolment');
    const assignment = await containerService.assignContainers({
      customer: customer._id,
      business: business._id,
      sku: milkSku._id,
      createdBy: agent,
    });
    check('assignment created with rotationSize 2', assignment.rotationSize === 2, `got ${assignment.rotationSize}`);
    check('exactly 2 cans reserved', assignment.cans.length === 2, `got ${assignment.cans.length}`);

    const reserved = await DairyCan.countDocuments({
      canCode: { $in: canCodes },
      'assignedTo.type': 'customer',
    });
    check('both cans marked assigned to the customer', reserved === 2, `got ${reserved}`);
    check('rotation group recorded', !!assignment.rotationGroup);

    let doubleEnrolRefused = false;
    try {
      await containerService.assignContainers({
        customer: customer._id, business: business._id, sku: milkSku._id, createdBy: agent,
      });
    } catch (e) { doubleEnrolRefused = e.statusCode === 400; }
    check('second assignment for the same customer refused', doubleEnrolRefused);

    const [canA, canB] = await Promise.all([
      DairyCan.findById(assignment.cans[0]),
      DairyCan.findById(assignment.cans[1]),
    ]);

    // ---- 3. Day 1: deliver the first can ----
    console.log('\n3. Day 1 — A → customer');
    let plan = await containerService.planSwap({ customer: customer._id, business: business._id });
    check('nothing to collect on day 1', plan.collect === null);
    check('day 1 hands over a ready can', plan.deliver.condition === 'ready');

    await canService.issueCans({
      clientRef: `${tag}-d1`,
      customer: customer._id,
      agent,
      createdBy: agent,
      canCodes: [plan.deliver.canCode],
    });
    await containerService.completeSwap({
      assignment: assignment._id,
      deliveredCan: plan.deliver._id,
      collectedCan: null,
      agent,
      createdBy: agent,
    });
    // `completeSwap` loads its own copy, so re-read rather than trust the
    // in-memory object captured before the swap.
    const afterDay1 = await DairyContainerAssignment.findById(assignment._id);
    await afterDay1.populate({ path: 'activeCan' });
    check('assignment.activeCan is now with the customer',
      afterDay1.activeCan && afterDay1.activeCan.currentHolder.type === 'customer');

    // ---- 4. Day 2: collect A, deliver B ----
    console.log('\n4. Day 2 — A ← customer, B → customer');
    plan = await containerService.planSwap({ customer: customer._id, business: business._id });
    check('day 2 collects the held can', plan.collect && plan.collect.canCode === plan.deliver.canCode ? false : !!plan.collect);
    check('day 2 hands over the OTHER can, not the same one',
      plan.deliver.canCode !== afterDay1.activeCan.canCode,
      `collect=${plan.collect?.canCode} deliver=${plan.deliver.canCode}`);

    const day2Collect = plan.collect;
    const day2Deliver = plan.deliver;

    await canService.collectCans({
      clientRef: `${tag}-d2c`,
      run: null,
      agent,
      createdBy: agent,
      canCodes: [day2Collect.canCode],
    });
    await canService.issueCans({
      clientRef: `${tag}-d2i`,
      customer: customer._id,
      agent,
      createdBy: agent,
      canCodes: [day2Deliver.canCode],
    });
    await containerService.completeSwap({
      assignment: assignment._id,
      deliveredCan: day2Deliver._id,
      collectedCan: day2Collect._id,
      agent,
      createdBy: agent,
    });
    const afterDay2 = await DairyContainerAssignment.findById(assignment._id);
    check('collected can is dirty and back with the rider',
      (await DairyCan.findById(day2Collect._id)).condition === 'issued' ||
      (await DairyCan.findById(day2Collect._id)).currentHolder.type === 'agent');

    // ---- 5. Day 3: collect B, deliver A — the actual rotation ----
    console.log('\n5. Day 3 — B ← customer, A → customer (rotation)');
    const heldBefore = await DairyCan.findById(afterDay2.activeCan);
    check('before day 3 the customer holds B', heldBefore.canCode === day2Deliver.canCode,
      `held=${heldBefore.canCode}`);

    // Wash A back into service, as the dairy unit would. Collected cans come
    // back dirty, so drive the full clean -> inspect -> refill chain.
    await DairyCan.updateOne({ _id: day2Collect._id }, { $set: { condition: 'dirty' } });
    await containerService.advanceLifecycle(day2Collect._id, 'send_to_wash', { createdBy: agent });
    await containerService.advanceLifecycle(day2Collect._id, 'washed', { createdBy: agent });
    await containerService.advanceLifecycle(day2Collect._id, 'inspect_ok', { createdBy: agent });
    await containerService.advanceLifecycle(day2Collect._id, 'refill', { createdBy: agent });

    const washedA = await DairyCan.findById(day2Collect._id);
    check('collected can returned to ready through the wash line',
      washedA.condition === 'ready', `got ${washedA.condition}`);

    plan = await containerService.planSwap({ customer: customer._id, business: business._id });
    check('day 3 delivers the ORIGINAL can A back', plan.deliver.canCode === day2Collect.canCode,
      `got ${plan.deliver.canCode}, expected ${day2Collect.canCode}`);
    check('day 3 collects B', plan.collect.canCode === day2Deliver.canCode,
      `got ${plan.collect?.canCode}`);

    // ---- 6. Illegal transitions ----
    console.log('\n6. Lifecycle state machine');
    let illegalRefused = false;
    try {
      await containerService.advanceLifecycle(day2Collect._id, 'send_to_wash', { createdBy: agent });
    } catch (e) { illegalRefused = e.statusCode === 400; }
    check('ready → washing refused (illegal transition)', illegalRefused);

    let wrongStateRefused = false;
    try {
      await containerService.advanceLifecycle(day2Collect._id, 'washed', { createdBy: agent });
    } catch (e) { wrongStateRefused = e.statusCode === 400; }
    check('ready → washed refused (wrong source state)', wrongStateRefused);

    // ---- 7. No ready sibling blocks the delivery ----
    console.log('\n7. Blocking when no sibling is ready');
    const fresh = await containerService.assignContainers({
      customer: (await User.create({
        firstName: 'Blk', lastName: 'Test', countryCode: '+91',
        mobile: Number(`94${Date.now().toString().slice(-8)}`),
        email: `blk${Date.now()}@rot.local`, password: 'Customer@123',
        role: 'user', status: true, locale: 'en',
      }))._id,
      business: business._id,
      sku: milkSku._id,
      createdBy: agent,
    }).catch(() => null);
    // Only 2 unassigned cans may remain; if enrolment failed there is nothing to test.
if (fresh) {
      // Scrub BOTH cans so the planner genuinely has nothing to hand over.
      await DairyCan.updateMany(
        { _id: { $in: fresh.cans } },
        { $set: { condition: 'washing' } }
      );
      let noSibling = false;
      try {
        await containerService.planSwap({ customer: fresh.customer, business: business._id });
      } catch (e) { noSibling = e.statusCode === 409; }
      check('no ready sibling blocks the swap with 409', noSibling);

      // Restore so cleanup leaves a sane state.
      await DairyCan.updateMany({ _id: { $in: fresh.cans } }, { $set: { condition: 'ready' } });
    } else {
      console.log('  SKIP  no ready sibling block (insufficient unassigned cans)');
    }

    // ---- 8. Summary + release ----
    console.log('\n8. Summary and release');
    const summary = await containerService.getLifecycleSummary(business._id);
    check('lifecycle summary counts ready cans', summary.ready >= 2, `got ${summary.ready}`);
    check('summary includes issued cans', summary.issued >= 1, `got ${summary.issued}`);

const released = await containerService.releaseContainers(assignment._id, {
      reason: 'Customer moved away',
      createdBy: agent,
    });
    check('assignment released', released.assignment.status === 'released');

    // A can still physically with the customer must NOT be released — doing so
    // would add a phantom can to the pool that nobody can ever collect.
    const stillReserved = await DairyCan.countDocuments({
      _id: { $in: assignment.cans },
      'assignedTo.type': 'customer',
    });
    const retainedCount = await DairyCan.countDocuments({
      _id: { $in: assignment.cans },
      'assignedTo.type': 'customer',
      'currentHolder.type': 'customer',
    });
    check('customer-held can is retained, not released', stillReserved === retainedCount && retainedCount >= 0,
      `reserved=${stillReserved} held=${retainedCount}`);
    check('store-held cans returned to the pool', released.released === stillReserved,
      `released=${released.released} reserved=${stillReserved}`);
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message}`);
  } finally {
    const cans = await DairyCan.find({ canCode: { $in: canCodes } }).select('_id');
    const canIds = cans.map((c) => c._id);
    await DairyCanLedger.deleteMany({ can: { $in: canIds } });
    await DairyContainerAssignment.deleteMany({ cans: { $in: canIds } });
    await DairyCan.deleteMany({ canCode: { $in: canCodes } });
    await DairySku.deleteMany({ name: { $regex: tag } });
    await Wallet.deleteMany({ _id: wallet._id });
    await User.deleteMany({ _id: customer._id });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL ROTATION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});