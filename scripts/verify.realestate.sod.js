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
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.realestate.sod.js — separation-of-duties hardening gate.
 *
 * Covers the two Gap A/B fixes plus the custody mirror:
 *
 *   Gap A — three distinct people end to end:
 *     [1] requester cannot approve their own case
 *     [2] requester cannot activate their own case (case leg)
 *     [3] approver cannot activate (case + policy legs, pre-existing)
 *     [4] requester cannot activate the policy (policy leg)
 *
 *   Gap B — operator tax route stages pending only:
 *     [5] operator-supplied approvalStatus:'approved' is ignored (node stays pending)
 *     [6] unknown tax supply keys rejected
 *     [7] ACTIVE policies refuse tax edits (version instead)
 *     [8] approval applies the FROZEN staged values, per supply, independently
 *     [9] post-approval operator edits reset the node to pending
 *
 *   Custody mirror:
 *     [10] operator cannot set custodyApprovalStatus (stays pending)
 *     [11] custody gate false before approval, true after (with account ref)
 *
 *   Invariants:
 *     [12] frozen snapshots keep working (BR-15)
 *
 * Run: node scripts/verify.realestate.sod.js
 *
 * Live DB with exact cleanup: probe policies are named SOD-PROBE-*, all
 * probe cases/audit rows reference them and are removed in `finally`. A
 * start-of-run sweep heals leftovers from a previously crashed run.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

const SVC = (...parts) => path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'services', ...parts);
const MDL = (...parts) => path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'models', ...parts);

const approvalService = require(SVC('realestate.approval.service.js'));
const holdPolicyService = require(SVC('realestate.hold.policy.service.js'));

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m) => {
  failed++;
  console.log('  FAIL ' + m);
};

const expectThrow = async (fn, label, pattern) => {
  try {
    await fn();
    bad(label + ' -> was ALLOWED but should have been REJECTED');
    return false;
  } catch (e) {
    if (pattern && !pattern.test(e.message)) {
      bad(label + ' -> rejected but wrong error: ' + e.message);
      return false;
    }
    ok(label + ' -> REJECTED (' + e.message.slice(0, 90) + ')');
    return true;
  }
};

const run = async () => {
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) throw new Error('MONGODB_URL not set');
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });

  const RealEstateHoldPolicy = require(MDL('realestate.hold.policy.model.js'));
  const RealEstateApprovalCase = require(MDL('realestate.approval.case.model.js'));
  const AuditLog = require(MDL('realestate.audit.log.model.js'));

  const R = new mongoose.Types.ObjectId(); // requester / operator
  const A = new mongoose.Types.ObjectId(); // approver (finance/legal)
  const D = new mongoose.Types.ObjectId(); // activator (third person)
  const RA = { _id: R };
  const AA = { _id: A };
  const DA = { _id: D };

  const probeNames = [];
  const tag = `SOD-PROBE-${Date.now()}`;

  // Self-healing sweep: remove leftovers from a crashed run first.
  const sweep = async () => {
    const probes = await RealEstateHoldPolicy.find({ name: /^SOD-PROBE-/ }).select('_id');
    const ids = probes.map((p) => p._id);
    if (ids.length) {
      await RealEstateApprovalCase.deleteMany({ targetId: { $in: ids } });
      await AuditLog.deleteMany({ targetId: { $in: ids } });
      await RealEstateHoldPolicy.deleteMany({ _id: { $in: ids } });
    }
  };
  const sweepAuditForCases = async (caseIds) => {
    if (caseIds.length) await AuditLog.deleteMany({ targetId: { $in: caseIds } });
  };
  await sweep();

  const caseIds = [];
  try {
    console.log('\n[1] requester cannot approve their own case');
    {
      const c = await approvalService.requestApproval(
        { category: 'HOLD_POLICY', targetModel: 'RealEstateHoldPolicy', targetId: new mongoose.Types.ObjectId(), changeReason: 'sod probe' },
        RA
      );
      caseIds.push(c._id);
      await expectThrow(
        () => approvalService.approveCase(c._id, RA, {}),
        'approve-as-requester',
        /requester cannot approve/
      );
      const approved = await approvalService.approveCase(c._id, AA, { note: 'reviewed', approvalReference: 'SOD-1' });
      if (approved.status === 'APPROVED' && String(approved.approver) === String(A)) ok('approve-as-approver works');
      else bad('approve-as-approver did not record correctly');
    }

    console.log('\n[2] activation needs a third person (Gap A, case leg)');
    {
      const c = await approvalService.requestApproval(
        { category: 'HOLD_POLICY', targetModel: 'RealEstateHoldPolicy', targetId: new mongoose.Types.ObjectId(), changeReason: 'sod probe 2' },
        RA
      );
      caseIds.push(c._id);
      await approvalService.approveCase(c._id, AA, {});
      await expectThrow(
        () => approvalService.markActivated(c._id, RA),
        'activate-as-requester',
        /requester cannot activate/
      );
      await expectThrow(
        () => approvalService.markActivated(c._id, AA),
        'activate-as-approver',
        /approver cannot activate/
      );
      const done = await approvalService.markActivated(c._id, DA);
      if (done.status === 'ACTIVATED') ok('activate-as-third-person works');
      else bad('third-person activation did not record');
    }

    console.log('\n[3] policy legs: requester approves/activates nothing');
    const p2name = `${tag}-P2`;
    probeNames.push(p2name);
    // Absurdly high version so submitForApproval deterministically picks
    // this probe and never a seeded draft.
    const P2 = await RealEstateHoldPolicy.create({ name: p2name, version: 999999 });
    await holdPolicyService.submitForApproval(RA, { changeReason: 'sod probe policy' });
    await expectThrow(
      () => holdPolicyService.approvePolicy(P2._id, {}, RA),
      'policy approve-as-requester',
      /requester cannot approve/
    );
    await holdPolicyService.approvePolicy(P2._id, { approvalReference: 'SOD-P' }, AA);
    await expectThrow(
      () => holdPolicyService.activatePolicy(P2._id, RA),
      'policy activate-as-requester (Gap A)',
      /requester cannot activate/
    );
    await expectThrow(
      () => holdPolicyService.activatePolicy(P2._id, AA),
      'policy activate-as-approver',
      /approver cannot activate/
    );
    // No successful activation here by design: activating would retire the
    // shared ACTIVE row. P2 stays APPROVED and is deleted in cleanup.
    ok('policy left APPROVED (no ACTIVE flip, shared row untouched)');

    console.log('\n[4] operator tax edit stages pending only (Gap B)');
    {
      const updated = await holdPolicyService.updateTaxSupply(
        P2._id,
        'holdServiceFee',
        { taxClassification: 'service', applicableRate: 18, hsnSac: '998311', approvalStatus: 'approved' },
        RA
      );
      const node = updated.taxConfiguration.holdServiceFee;
      const plain = typeof node.toObject === 'function' ? node.toObject() : node;
      if (plain.approvalStatus === 'pending' && plain.approvedBy == null) ok('operator approvalStatus ignored — node pending');
      else bad('operator self-approved the node: ' + JSON.stringify({ status: plain.approvalStatus, by: plain.approvedBy }));
      if (plain.taxClassification === 'service' && plain.applicableRate === 18) ok('staged substance kept (pending, awaiting approval)');
      else bad('staged substance lost');
      const openCase = await approvalService.findOpenForTarget('TAX_CONFIG', P2._id, 'tax:holdServiceFee');
      if (openCase && String(openCase.requester) === String(R)) {
        ok('TAX_CONFIG case auto-opened for the supply');
        caseIds.push(openCase._id);
      } else bad('no TAX_CONFIG case opened for the staged supply');
      await expectThrow(
        () => holdPolicyService.updateTaxSupply(P2._id, 'holdServiceFee', { hsnSac: '998312' }, RA),
        'second edit while case open',
        /already open/
      );
    }

    console.log('\n[5] unknown supply keys stay rejected');
    await expectThrow(
      () => holdPolicyService.updateTaxSupply(P2._id, 'nope', { taxClassification: 'service' }, RA),
      'unknown supply',
      /Unknown tax supply/
    );

    console.log('\n[6] approval applies frozen values, per supply, independently');
    {
      const openCase = await approvalService.findOpenForTarget('TAX_CONFIG', P2._id, 'tax:holdServiceFee');
      await approvalService.approveCase(openCase._id, AA, { approvalReference: 'TAX-MEMO-1' });
      const fresh = await RealEstateHoldPolicy.findById(P2._id);
      const node = fresh.taxConfiguration.holdServiceFee;
      const plain = typeof node.toObject === 'function' ? node.toObject() : node;
      const good =
        plain.approvalStatus === 'approved' &&
        String(plain.approvedBy) === String(A) &&
        !!plain.approvedAt &&
        plain.taxClassification === 'service' &&
        plain.applicableRate === 18 &&
        plain.approvalReference === 'TAX-MEMO-1';
      if (good) ok('fee node approved with frozen staged values + approver identity');
      else bad('fee node wrong after approval: ' + JSON.stringify(plain));
      const live = await RealEstateHoldPolicy.findById(P2._id).lean();
      const feeTax = holdPolicyService.getActiveTaxForSupply(live, 'holdServiceFee');
      const commTax = holdPolicyService.getActiveTaxForSupply(live, 'propertySaleCommission');
      if (feeTax && feeTax.applicableRate === 18) ok('fee supply now gates OPEN (would invoice)');
      else bad('fee supply still gated after approval');
      if (commTax === null) ok('commission supply still gated (independent, untouched)');
      else bad('commission supply leaked open');
    }

    console.log('\n[7] post-approval operator edits reset to pending');
    {
      const updated = await holdPolicyService.updateTaxSupply(P2._id, 'holdServiceFee', { hsnSac: '998399' }, RA);
      const node = updated.taxConfiguration.holdServiceFee;
      const plain = typeof node.toObject === 'function' ? node.toObject() : node;
      if (plain.approvalStatus === 'pending') ok('mutate-after-approval reset to pending (re-approval required)');
      else bad('mutated node kept its approval');
    }

    console.log('\n[8] custody mirror: operator cannot self-approve custody');
    const p3name = `${tag}-P3`;
    probeNames.push(p3name);
    // Transient second ACTIVE row: this script never calls getActive() or
    // creates holds, so no reader can observe it; removed in `finally`.
    const P3 = await RealEstateHoldPolicy.create({ name: p3name, version: 999998, status: 'ACTIVE' });
    {
      const updated = await holdPolicyService.updateActive(
        { custodyMode: 'ESCROW', custodianBankReference: 'BANK-REF-1', custodyApprovalStatus: 'approved' },
        RA
      );
      if (updated.custodyApprovalStatus === 'pending') ok('operator custodyApprovalStatus ignored — stays pending');
      else bad('operator self-approved custody: ' + updated.custodyApprovalStatus);
      const pre = await RealEstateHoldPolicy.findById(P3._id).lean();
      if (!holdPolicyService.isCustodyApprovedForLive(pre)) ok('custody gate false before approval');
      else bad('custody gate open before approval');
      const openCase = await approvalService.findOpenForTarget('CUSTODY_CONFIG', P3._id, 'custody');
      if (openCase) {
        ok('CUSTODY_CONFIG case auto-opened');
        caseIds.push(openCase._id);
        await expectThrow(
          () => approvalService.approveCase(openCase._id, RA, {}),
          'custody approve-as-requester',
          /requester cannot approve/
        );
        await approvalService.approveCase(openCase._id, AA, { approvalReference: 'CUSTODY-MEMO-1' });
        const post = await RealEstateHoldPolicy.findById(P3._id).lean();
        if (
          post.custodyApprovalStatus === 'approved' &&
          String(post.custodyApprovedBy) === String(A) &&
          holdPolicyService.isCustodyApprovedForLive(post)
        ) {
          ok('custody approved via case — gate now true (mode + account + approved)');
        } else {
          bad('custody node wrong after approval: ' + JSON.stringify({ status: post.custodyApprovalStatus, by: post.custodyApprovedBy }));
        }
      } else bad('no CUSTODY_CONFIG case opened');
    }

    console.log('\n[9] ACTIVE policies still refuse tax edits');
    await expectThrow(
      () => holdPolicyService.updateTaxSupply(P3._id, 'holdServiceFee', { taxClassification: 'service' }, RA),
      'tax edit on ACTIVE',
      /ACTIVE/
    );

    console.log('\n[10] frozen snapshots keep working (BR-15)');
    {
      const live = await RealEstateHoldPolicy.findById(P2._id).lean();
      const snap = holdPolicyService.freeze({ ...live, _id: live._id });
      if (snap.custodySnapshot && snap.taxSnapshot && snap.taxSnapshot.holdServiceFee) ok('freeze() renders custody + tax snapshots');
      else bad('freeze() snapshot shape broken');
    }

    console.log('\n' + (failed === 0 ? 'ALL SOD CHECKS PASSED' : failed + ' CHECK(S) FAILED'));
  } catch (e) {
    failed++;
    console.error('\nUNEXPECTED ERROR: ' + ((e && e.stack) || e));
  } finally {
    try {
      const probes = await RealEstateHoldPolicy.find({ name: /^SOD-PROBE-/ }).select('_id');
      const ids = probes.map((p) => p._id);
      const allCaseIds = [...caseIds];
      if (ids.length) {
        const cs = await RealEstateApprovalCase.find({ targetId: { $in: ids } }).select('_id');
        for (const c of cs) allCaseIds.push(c._id);
        await RealEstateApprovalCase.deleteMany({ targetId: { $in: ids } });
        await RealEstateHoldPolicy.deleteMany({ _id: { $in: ids } });
      }
      // Approval + tax/custody application audit rows point at cases/policies.
      await sweepAuditForCases(allCaseIds);
      if (ids.length) await AuditLog.deleteMany({ targetId: { $in: ids } });
      // Orphan sweep for the two hand-made HOLD_POLICY cases (random targets).
      await RealEstateApprovalCase.deleteMany({ changeReason: /^sod probe/ });
      console.log(`\ncleanup: removed probe policies/cases/audit rows (probes: ${probeNames.join(', ') || 'none'})`);
    } catch (e) {
      console.error('CLEANUP FAILED — check for leftover SOD-PROBE rows:', e.message);
    }
    await mongoose.disconnect().catch(() => {});
    process.exit(failed === 0 ? 0 : 1);
  }
};

run().catch((e) => {
  console.error('\nSOD VERIFY FAILED:', e.message);
  process.exit(1);
});
