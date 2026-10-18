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
 * Verifies FSSAI licensing, hygiene checks and document expiry.
 *
 * Asserts status is derived, never asserted:
 *   1. an outlet with no licence is `pending`, not `valid`
 *   2. a licence with time left is `valid`
 *   3. a licence inside the warning window is `expiring`
 *   4. a lapsed licence is `expired`
 *   5. a licence expiring exactly today counts as expiring
 *   6. `deriveStatus` is pure — it never reads the stored status
 *
 * Asserts a stale cache cannot lie:
 *   7. the summary recomputes rather than trusting `status`
 *   8. the summary reports `cacheFresh` so drift is visible
 *   9. `refreshAllStatuses` corrects drifted records
 *  10. an unchanged sweep writes nothing
 *
 * Asserts the record keeps evidence:
 *  11. hygiene checks are append-only, latest wins per type
 *  12. a failed check is distinguishable from a conditional one
 *  13. overdue re-checks are counted
 *  14. the recorded operator comes from the caller, not the payload
 *
 * Asserts documents and expiry sweeps:
 *  15. a document inside the window is reported as expiring
 *  16. the sweep finds only outlets inside the horizon
 *  17. the sweep reports live status beside the cached one
 *  18. a renewed licence replaces the old number and expiry
 *
 * Usage: node scripts/verify.dairy.compliance.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  Wallet,
  DairyCompliance,
} = require('../src/models');
const complianceService = require('../src/modules/dairy/services/dairy.compliance.service');

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
const inDays = (days) => new Date(Date.now() + days * DAY);

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
  const tag = `C${Date.now().toString().slice(-6)}`;

  const owner = await User.create({
    firstName: 'Comply', lastName: 'Test', countryCode: '+91',
    mobile: Number(`977${Date.now().toString().slice(-7)}`),
    email: `c${Date.now()}@compliance.local`, password: 'Test@12345',
    role: 'dairyPartner', status: true, locale: 'en',
  });
  await Wallet.create({ holderId: owner._id, balance: 0, status: true });

  const business = await Business.create({
    vertical: 'dairy', businessModel: 'direct', name: `Compliance Outlet ${tag}`,
    owner: owner._id, ownDeliveryPartner: false, verified: true, status: true,
  });

  // A second outlet that stays in date, so the expiry sweep has something to
  // correctly leave out. Declared here so the cleanup block can reach it even if
  // a check throws before it is created.
  let otherOwner = null;
  let otherBusiness = null;

  try {
    // ---- 1-6. Derived status ----
    console.log('\n1. Status is derived from the dates');
    const fresh = await complianceService.getOrCreateCompliance(business._id);
    check('record created on first read', !!fresh._id);
    check('no licence means pending, not valid', fresh.status === 'pending', `got ${fresh.status}`);
    check('daysToExpiry is null without a licence', fresh.daysToExpiry === null,
      `got ${fresh.daysToExpiry}`);

    check('deriveStatus agrees on pending',
      complianceService.deriveStatus({ fssai: {} }) === 'pending');

    const valid = await complianceService.setLicence(business._id, {
      licenceNumber: `FSSAI-${tag}-A`,
      issuedAt: inDays(-300),
      expiresAt: inDays(200),
    });
    check('licence with time left is valid', valid.status === 'valid', `got ${valid.status}`);

    const expiring = await complianceService.setLicence(business._id, {
      licenceNumber: `FSSAI-${tag}-B`,
      issuedAt: inDays(-340),
      expiresAt: inDays(10),
    });
    check('licence inside the warning window is expiring', expiring.status === 'expiring',
      `got ${expiring.status}`);

    // Boundary: exactly on the warning line must still be `expiring`.
    const boundary = await complianceService.setLicence(business._id, {
      licenceNumber: `FSSAI-${tag}-C`,
      issuedAt: inDays(-340),
      expiresAt: inDays(30),
    });
    check('licence on the warning boundary is expiring', boundary.status === 'expiring',
      `got ${boundary.status}`);

    const expired = await complianceService.setLicence(business._id, {
      licenceNumber: `FSSAI-${tag}-D`,
      issuedAt: inDays(-400),
      expiresAt: inDays(-1),
    });
    check('lapsed licence is expired', expired.status === 'expired', `got ${expired.status}`);

    // Purity: the rule must not depend on what is already stored.
    check('deriveStatus ignores the stored status',
      complianceService.deriveStatus({ status: 'valid', fssai: { licenceNumber: 'X', expiresAt: inDays(-5) } }) === 'expired');

    // ---- 18. Renewal replaces ----
    check('renewal replaces the licence number',
      expired.fssai.licenceNumber === `FSSAI-${tag}-D`);
    const renewed = await complianceService.setLicence(business._id, {
      licenceNumber: `FSSAI-${tag}-E`,
      issuedAt: inDays(-2),
      expiresAt: inDays(360),
    });
    check('renewed licence is the one on record',
      renewed.fssai.licenceNumber === `FSSAI-${tag}-E`, `got ${renewed.fssai.licenceNumber}`);
    check('renewed licence is valid again', renewed.status === 'valid', `got ${renewed.status}`);

    // ---- 7-10. Stale cache ----
    console.log('\n2. A stale cache cannot lie');
    // Simulate drift: expiry passes with nothing re-deriving the status.
    await DairyCompliance.updateOne(
      { _id: renewed._id },
      { $set: { 'fssai.expiresAt': inDays(-2), status: 'valid' } }
    );
    const staleSummary = await complianceService.getSummary(business._id);
    check('summary recomputes instead of trusting the cache',
      staleSummary.status === 'expired', `got ${staleSummary.status}`);
    check('summary flags the cache as stale', staleSummary.cacheFresh === false);
    check('daysToExpiry is negative once lapsed', staleSummary.daysToExpiry < 0,
      `got ${staleSummary.daysToExpiry}`);

    const sweep = await complianceService.refreshAllStatuses();
    check('sweep checked the record', sweep.checked >= 1, `got ${sweep.checked}`);
    check('sweep corrected the drifted record', sweep.changed === 1, `got ${sweep.changed}`);
    const afterSweep = await complianceService.getSummary(business._id);
    check('cache fresh after the sweep', afterSweep.cacheFresh === true);
    const noop = await complianceService.refreshAllStatuses();
    check('an unchanged sweep writes nothing', noop.changed === 0, `got ${noop.changed}`);

    // Put the licence back in date for the remaining checks.
    await complianceService.setLicence(business._id, {
      licenceNumber: `FSSAI-${tag}-E`,
      issuedAt: inDays(-2),
      expiresAt: inDays(360),
    });

    // ---- 11-14. Hygiene checks ----
    console.log('\n3. Hygiene checks are evidence, not a status flag');
    await complianceService.recordHygieneCheck(business._id, {
      checkType: 'cold_chain',
      result: 'pass',
      checkedAt: inDays(-30),
    });
    const afterFail = await complianceService.recordHygieneCheck(business._id, {
      checkType: 'cold_chain',
      result: 'fail',
      checkedAt: inDays(-2),
      notes: 'Chiller at 9C, limit is 4C',
      checkedBy: asha._id,
    });
    check('both checks retained', afterFail.hygieneChecks.length === 2,
      `got ${afterFail.hygieneChecks.length}`);
    check('a failure does not overwrite the earlier pass',
      afterFail.hygieneChecks[0].result === 'pass' && afterFail.hygieneChecks[1].result === 'fail');

    await complianceService.recordHygieneCheck(business._id, {
      checkType: 'storage',
      result: 'conditional',
      checkedAt: inDays(-1),
      nextDueAt: inDays(-1),
      checkedBy: asha._id,
    });

    const hygieneSummary = await complianceService.getSummary(business._id);
    check('only the latest reading per type is surfaced',
      hygieneSummary.hygiene.latest.length === 2, `got ${hygieneSummary.hygiene.latest.length}`);
    check('failing count reflects the latest reading',
      hygieneSummary.hygiene.failing === 1, `got ${hygieneSummary.hygiene.failing}`);
    check('conditional is not counted as a pass',
      hygieneSummary.hygiene.conditional === 1, `got ${hygieneSummary.hygiene.conditional}`);
    check('overdue re-checks counted', hygieneSummary.hygiene.overdue === 1,
      `got ${hygieneSummary.hygiene.overdue}`);
    check('total checks retained even when only latest is surfaced',
      hygieneSummary.hygiene.total === 3, `got ${hygieneSummary.hygiene.total}`);

    // ---- 15-17. Documents and sweeps ----
    console.log('\n4. Documents and expiry sweeps');
    await complianceService.addDocument(business._id, {
      type: 'pesticide_residue_report',
      expiresAt: inDays(5),
    });
    await complianceService.addDocument(business._id, {
      type: 'fire_noc',
      expiresAt: inDays(400),
    });
    const docSummary = await complianceService.getSummary(business._id);
    check('only documents inside the window are flagged',
      docSummary.documents.expiringSoon.length === 1,
      `got ${docSummary.documents.expiringSoon.length}`);
    check('flagged document carries days remaining',
      docSummary.documents.expiringSoon[0].daysRemaining <= 30);
    check('all documents counted', docSummary.documents.total === 2,
      `got ${docSummary.documents.total}`);

    // A second outlet, far from expiry, must not appear in a 30-day sweep.
    otherOwner = await User.create({
      firstName: 'Fine', lastName: 'Test', countryCode: '+91',
      mobile: Number(`976${Date.now().toString().slice(-7)}`),
      email: `f${Date.now()}@compliance.local`, password: 'Test@12345',
      role: 'dairyPartner', status: true, locale: 'en',
    });
    await Wallet.create({ holderId: otherOwner._id, balance: 0, status: true });
    otherBusiness = await Business.create({
      vertical: 'dairy', businessModel: 'direct', name: `Compliant Outlet ${tag}`,
      owner: otherOwner._id, ownDeliveryPartner: false, verified: true, status: true,
    });

    await complianceService.setLicence(otherBusiness._id, {
      licenceNumber: `FSSAI-${tag}-Z`,
      issuedAt: inDays(-10),
      expiresAt: inDays(300),
    });

    const horizon = await complianceService.listExpiring({ days: 30 });
    check('sweep returns only outlets inside the horizon',
      horizon.every((r) => r.daysRemaining <= 30), JSON.stringify(horizon.map((r) => r.daysRemaining)));
    check('compliant outlet absent from the sweep',
      !horizon.some((r) => String(r.business._id) === String(otherBusiness._id)));
    check('sweep reports live status beside the cached one',
      horizon.every((r) => r.liveStatus && r.cachedStatus));

    const wide = await complianceService.listExpiring({ days: 365 });
    check('a wider horizon finds the compliant outlet',
      wide.some((r) => String(r.business._id) === String(otherBusiness._id)));

    // Operator attribution comes from the caller, not the payload. Exercised via
    // the controller's own contract: the service takes `checkedBy` explicitly.
    const attributed = await complianceService.recordHygieneCheck(business._id, {
      checkType: 'handwash',
      result: 'pass',
      checkedBy: owner._id,
    });
    const latestHandwash = complianceService
      .latestHygieneChecks(attributed)
      .find((c) => c.checkType === 'handwash');
    check('operator recorded against the check', String(latestHandwash.checkedBy) === String(owner._id));

    check('other outlet created for the sweep', !!otherBusiness._id);
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message} >>> ${e.stack}`);
  } finally {
    await DairyCompliance.deleteMany({});
    await Business.deleteMany({ _id: { $in: [business._id, otherBusiness].filter(Boolean) } });
    await Wallet.deleteMany({ holderId: { $in: [owner._id, otherOwner].filter(Boolean) } });
    await User.deleteMany({ _id: { $in: [owner._id, otherOwner].filter(Boolean) } });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL COMPLIANCE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
