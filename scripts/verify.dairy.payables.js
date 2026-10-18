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
 * Verifies provider payable statements.
 *
 * The whole point of this model is that a figure stops moving, so most of these
 * checks are about immutability rather than arithmetic.
 *
 * Asserts what is claimable:
 *   1. a draft statement is created for accepted, unsettled collections
 *   2. litres and gross are totalled from the frozen lines
 *   3. `netAmount` is POSITIVE — the platform owes the provider
 *   4. rejected milk is never claimed
 *   5. milk still awaiting QC is never claimed
 *   6. milk outside the period is never claimed
 *   7. an empty period is refused rather than producing a zero statement
 *   8. a reversed period is refused
 *   9. a second statement for the same period start is refused
 *
 * Asserts the figure is frozen:
 *  10. claimed collections move off `pending`, so they cannot be claimed twice
 *  11. a rate change after generation does not restate the statement
 *  12. a later collection for the same period is not added to it
 *
 * Asserts adjustments:
 *  13. a deduction lowers `netAmount` and is kept with its reason
 *  14. a deduction with no reason is refused
 *  15. an approved statement cannot be adjusted
 *
 * Asserts the lifecycle:
 *  16. draft -> approved -> paid
 *  17. illegal transitions refused
 *  18. paying an unapproved statement refused
 *  19. paying twice refused
 *  20. payment settles the underlying collections
 *  21. payment records the amount paid and a reference
 *  22. voiding releases the collections so they can be re-stated
 *  23. a paid statement cannot be voided
 *
 * Usage: node scripts/verify.dairy.payables.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  Wallet,
  DairyMilkProvider,
  DairyMilkCollection,
  DairyProviderPayable,
} = require('../src/models');
const payableService = require('../src/modules/dairy/services/dairy.provider.payable.service');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const DAY = 86400000;

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
  const tag = `P${Date.now().toString().slice(-6)}`;

  const owner = await User.create({
    firstName: 'Payable', lastName: 'Test', countryCode: '+91',
    mobile: Number(`975${Date.now().toString().slice(-7)}`),
    email: `p${Date.now()}@payable.local`, password: 'Test@12345',
    role: 'dairyPartner', status: true, locale: 'en',
  });
  await Wallet.create({ holderId: owner._id, balance: 0, status: true });

  const business = await Business.create({
    vertical: 'dairy', businessModel: 'direct', name: `Payable Outlet ${tag}`,
    owner: owner._id, ownDeliveryPartner: false, verified: true, status: true,
  });

  const provider = await DairyMilkProvider.create({
    business: business._id, code: `PRV-${tag}`, name: `Supplier ${tag}`,
    mobile: 9000000111, milkType: 'cow', ratePerLitre: 40, status: true,
  });

  // The period under test. Collections are placed at fixed offsets inside it so the
  // suite never depends on today's date.
  const base = new Date();
  const from = new Date(base.getFullYear(), base.getMonth(), 1);
  const to = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const at = (day) => new Date(base.getFullYear(), base.getMonth(), day, 6, 0, 0);

  // `collectionNo` is numeric on the intake model, so the fixture numbers are too.
  let nextCollectionNo = 700000 + (Date.now() % 20000);
  const makeCollection = async (overrides = {}) =>
    DairyMilkCollection.create({
      business: business._id,
      provider: provider._id,
      collectionNo: nextCollectionNo++,
      quantityL: 10,
      fat: 4.0,
      snf: 8.5,
      temperature: 4,
      amount: 400,
      collectedAt: at(2),
      qualityStatus: 'accepted',
      payableStatus: 'pending',
      ...overrides,
    });

  const collections = [];

  try {
    // ---- 1-9. What is claimable ----
    console.log('\n1. Only accepted, unsettled, in-period milk is claimable');
    collections.push(await makeCollection({ quantityL: 10, amount: 400 }));
    collections.push(await makeCollection({ quantityL: 5, amount: 200, collectedAt: at(3) }));
    // Must never be claimed.
    collections.push(await makeCollection({ qualityStatus: 'rejected' }));
    collections.push(await makeCollection({ qualityStatus: 'pending' }));
    collections.push(await makeCollection({ collectedAt: new Date(to.getTime() + 5 * DAY) }));

    const draft = await payableService.generatePayable({
      business: business._id, provider: provider._id, from, to,
    });
    check('draft statement created', !!draft._id && !!draft.payableNo, `no=${draft.payableNo}`);
    check('starts as a draft', draft.status === 'draft');
    check('rejected milk not claimed', draft.totals.collectionCount === 2,
      `got ${draft.totals.collectionCount}`);
    check('litres totalled from the frozen lines', draft.totals.litres === 15,
      `got ${draft.totals.litres}`);
    check('gross totalled from the frozen lines', draft.totals.grossAmount === 600,
      `got ${draft.totals.grossAmount}`);
    check('netAmount POSITIVE — the platform owes the provider',
      draft.totals.netAmount === 600, `got ${draft.totals.netAmount}`);
    check('rejected collection still unsettled',
      (await DairyMilkCollection.findById(collections[2]._id)).payableStatus === 'pending');
    check('QC-pending collection still unsettled',
      (await DairyMilkCollection.findById(collections[3]._id)).payableStatus === 'pending');
    check('out-of-period collection still unsettled',
      (await DairyMilkCollection.findById(collections[4]._id)).payableStatus === 'pending');

    // ---- 10-12. Frozen ----
    console.log('\n2. The figure is frozen at generation');
    check('claimed collections move off pending',
      (await DairyMilkCollection.findById(collections[0]._id)).payableStatus === 'approved');

    let secondRefused = false;
    try {
      await payableService.generatePayable({
        business: business._id, provider: provider._id, from, to,
      });
    } catch (e) { secondRefused = e.statusCode === 409; }
    check('second statement for the same period refused', secondRefused);

    // A rate change and a late intake must both leave the statement alone.
    await DairyMilkProvider.updateOne({ _id: provider._id }, { $set: { ratePerLitre: 90 } });
    collections.push(await makeCollection({ quantityL: 7, amount: 630, collectedAt: at(4) }));

    const afterDrift = await payableService.getPayable(draft._id);
    check('a rate change does not restate the statement',
      afterDrift.totals.grossAmount === 600, `got ${afterDrift.totals.grossAmount}`);
    check('a later collection is not added to the statement',
      afterDrift.totals.collectionCount === 2, `got ${afterDrift.totals.collectionCount}`);
    check('the late collection remains claimable',
      (await DairyMilkCollection.findById(collections[5]._id)).payableStatus === 'pending');

    // ---- 13-15. Adjustments ----
    console.log('\n3. Deductions are visible, not silently netted off');
    let noReasonRefused = false;
    try {
      await payableService.addAdjustment(draft._id, { amount: 50 });
    } catch (e) { noReasonRefused = e.statusCode === 400; }
    check('a deduction with no reason refused', noReasonRefused);

    const adjusted = await payableService.addAdjustment(draft._id, {
      amount: 50, reason: 'Rejected can returned', recordedBy: owner._id,
    });
    check('adjustmentsTotal recorded', adjusted.totals.adjustmentsTotal === 50,
      `got ${adjusted.totals.adjustmentsTotal}`);
    check('netAmount reduced by the deduction', adjusted.totals.netAmount === 550,
      `got ${adjusted.totals.netAmount}`);
    check('the deduction keeps its reason', adjusted.adjustments[0].reason === 'Rejected can returned');

    // ---- 16-21. Lifecycle ----
    console.log('\n4. Approval and settlement');
    let illegalRefused = false;
    try {
      await payableService.updateStatus(draft._id, 'paid', {});
    } catch (e) { illegalRefused = e.statusCode === 400; }
    check('draft -> paid refused', illegalRefused);

    let payUnapprovedRefused = false;
    try {
      await payableService.payPayable(draft._id, {});
    } catch (e) { payUnapprovedRefused = e.statusCode === 400; }
    check('paying an unapproved statement refused', payUnapprovedRefused);

    const approved = await payableService.updateStatus(draft._id, 'approved', { actor: asha._id });
    check('draft -> approved', approved.status === 'approved');
    check('approver recorded', String(approved.approvedBy) === String(asha._id));

    let adjustApprovedRefused = false;
    try {
      await payableService.addAdjustment(draft._id, { amount: 10, reason: 'late deduction' });
    } catch (e) { adjustApprovedRefused = e.statusCode === 400; }
    check('an approved statement cannot be adjusted', adjustApprovedRefused);

    const paid = await payableService.payPayable(draft._id, { reference: 'NEFT-9911' });
    check('approved -> paid', paid.status === 'paid');
    check('amountPaid recorded', paid.totals.amountPaid === 550, `got ${paid.totals.amountPaid}`);
    check('payment reference recorded', paid.paymentReference === 'NEFT-9911');
    check('paidAt stamped', !!paid.paidAt);
    check('payment settles the underlying collections',
      (await DairyMilkCollection.findById(collections[0]._id)).payableStatus === 'paid');
    check('settled collections stamped',
      !!(await DairyMilkCollection.findById(collections[0]._id)).payableSettledAt);

    let payTwiceRefused = false;
    try {
      await payableService.payPayable(draft._id, {});
    } catch (e) { payTwiceRefused = e.statusCode === 400; }
    check('paying twice refused', payTwiceRefused);

    // ---- 22-23. Void releases ----
    console.log('\n5. Voiding releases the milk');
    // The late collection is still unclaimed, so a second statement covering the
    // same period must fail — the first statement already owns that milk.
    const duplicate = await payableService.generatePayable({
      business: business._id, provider: provider._id, from, to, label: 'replacement',
    }).catch(() => null);
    check('claimed milk cannot be re-stated for the same period', duplicate === null);

    let voidPaidRefused = false;
    try {
      await payableService.voidPayable(draft._id, { reason: 'too late' });
    } catch (e) { voidPaidRefused = e.statusCode === 400; }
    check('a paid statement cannot be voided', voidPaidRefused);

    // Void an open statement and confirm its collections become claimable again.
    const openPayable = await payableService.generatePayable({
      business: business._id,
      provider: provider._id,
      from: new Date(base.getFullYear(), base.getMonth() + 1, 1),
      to: new Date(base.getFullYear(), base.getMonth() + 2, 1),
    });
    const openCollectionId = openPayable.collections[0].intake;
    check('open statement claimed its collection',
      (await DairyMilkCollection.findById(openCollectionId)).payableStatus === 'approved');

    const voided = await payableService.voidPayable(openPayable._id, { reason: 'wrong rate' });
    const reread = await DairyProviderPayable.findById(openPayable._id);
    check('voided status recorded', voided.status === 'void' && reread.status === 'void',
      `returned=${voided.status} stored=${reread.status}`);
    check('void reason recorded', reread.statusReason === 'wrong rate',
      `stored="${reread.statusReason}"`);
    check('void releases the collection',
      (await DairyMilkCollection.findById(openCollectionId)).payableStatus === 'pending');
    check('voided statement cannot be paid',
      await payableService.payPayable(openPayable._id, {}).then(() => false).catch((e) => e.statusCode === 400));

    // ---- 7-8. Refusals ----
    console.log('\n6. Empty and reversed periods');
    let emptyRefused = false;
    try {
      await payableService.generatePayable({
        business: business._id,
        provider: provider._id,
        from: new Date(base.getFullYear(), base.getMonth() + 5, 1),
        to: new Date(base.getFullYear(), base.getMonth() + 6, 1),
      });
    } catch (e) { emptyRefused = e.statusCode === 400; }
    check('an empty period is refused', emptyRefused);

    let reversedRefused = false;
    try {
      await payableService.generatePayable({
        business: business._id, provider: provider._id, from: to, to: from,
      });
    } catch (e) { reversedRefused = e.statusCode === 400; }
    check('a reversed period is refused', reversedRefused);
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message} >>> ${e.stack}`);
  } finally {
    await DairyProviderPayable.deleteMany({});
    await DairyMilkCollection.deleteMany({});
    await DairyMilkProvider.deleteMany({ _id: provider._id });
    await Business.deleteMany({ _id: business._id });
    await Wallet.deleteMany({ holderId: owner._id });
    await User.deleteMany({ _id: owner._id });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL PROVIDER PAYABLE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
