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

const RealEstateHoldPolicy = require('../models/realestate.hold.policy.model');

/**
 * Hold policy service — versioned terms, frozen at hold creation.
 *
 * `getActive()` returns the single ACTIVE policy. `freeze()` copies
 * it onto a hold as `policySnapshot` (BR-15) so later admin edits
 * never restate a live hold.
 */

async function getActive(at = new Date()) {
  const policy = await RealEstateHoldPolicy.findOne({
    status: 'ACTIVE',
    effectiveFrom: { $lte: at },
    $and: [{ $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }] }],
  }).sort({ version: -1 });
  if (!policy) throw new Error('No ACTIVE hold policy. Seed one before creating holds.');
  return policy;
}

/**
 * Admin listing — every policy (any status), newest version first.
 * The admin editor renders the latest ACTIVE and shows DRAFT/RETIRED
 * rows for the version timeline.
 */
async function listAll() {
  return RealEstateHoldPolicy.find({}).sort({ version: -1, createdAt: -1 }).lean();
}

async function getById(id) {
  if (!id) return null;
  return RealEstateHoldPolicy.findById(id).lean();
}

const UPDATABLE = [
  'name',
  'principalAmount',
  'serviceFeePercent',
  'serviceFeeMin',
  'serviceFeeMax',
  'durationDays',
  'gracePeriodHours',
  'cancellationRefundable',
  'expiryRefundable',
  'feeRefundableOnListingWithdrawal',
  'forfeitureRequiresDualControl',
  'cancellationFeeBorneBy',
  'effectiveFrom',
  'effectiveTo',
  // OD-01 custody (draft/edit by admin operator; approve/activate gated).
  'custodyMode',
  'custodianBankReference',
  'accountIdentifier',
  'principalReleaseConditions',
  'refundSLA',
  'reconciliationFrequency',
  'supportingDocuments',
  // NOTE: `custodyApprovalStatus` is deliberately NOT operator-editable.
  // Approval flips it via the CUSTODY_CONFIG case workflow only (Gap B
  // mirror) — otherwise one operator could self-approve live custody.
  'custodyEffectiveDate',
  'custodyApprovalReference',
  'custodyConfigurationVersion',
  'custodyChangeReason',
  'custodyAccount',
  // OD-04 tax is a nested object — patched via updateTaxSupply(), not here,
  // to force per-supply approval (never bulk-approve all four).
  // Shared approval workflow fields.
  'approvalReference',
  'configurationVersion',
  'changeReason',
];

// OD-01: only an APPROVED custody configuration may back live holds.
// PLATFORM_CURRENT without explicit approval is NOT compliant by default.
function isCustodyApprovedForLive(policy) {
  if (!policy) return false;
  // Legacy path: explicit custodyAccount string counts as configured,
  // but live use still requires custodyApprovalStatus === 'approved'.
  const hasAccount =
    !!(policy.custodyAccount || policy.custodianBankReference || policy.accountIdentifier);
  if (!hasAccount) return false;
  return policy.custodyApprovalStatus === 'approved';
}

function assertCustodyApprovedForLive(policy) {
  if (!isCustodyApprovedForLive(policy)) {
    throw new Error(
      'Hold payments disabled — custodial arrangement not approved. ' +
        'Configure custody (ESCROW/CUSTODIAL) with approval evidence and ' +
        'custodyApprovalStatus=approved before live hold transactions.'
    );
  }
}

// OD-04: tax for a supply is INACTIVE until written determination approved.
// Returns null when inactive — callers must use default/unconfigured
// treatment and must never auto-apply a rate.
function getActiveTaxForSupply(policy, supplyKey) {
  const supplies = ['holdServiceFee', 'propertySaleCommission', 'holdPrincipal', 'listingPackageFee'];
  if (!supplies.includes(supplyKey)) throw new Error(`Unknown tax supply: ${supplyKey}`);
  const node = policy && policy.taxConfiguration ? policy.taxConfiguration[supplyKey] : null;
  if (!node) return null;
  const plain = typeof node.toObject === 'function' ? node.toObject() : node;
  if (plain.approvalStatus !== 'approved') return null;
  if (plain.applicableRate == null || !plain.taxClassification) return null;
  return {
    hsnSac: plain.hsnSac || null,
    taxClassification: plain.taxClassification,
    applicableRate: plain.applicableRate,
    invoiceTreatment: plain.invoiceTreatment || null,
    taxComponents: plain.taxComponents || null,
    inclusivePricing: !!plain.inclusivePricing,
    effectiveFrom: plain.effectiveFrom || null,
    effectiveTo: plain.effectiveTo || null,
    approvalReference: plain.approvalReference || null,
    configurationVersion: plain.configurationVersion || '1.0',
  };
}

function snapshotCustody(policy) {
  if (!policy) return {};
  return {
    custodyMode: policy.custodyMode || 'PLATFORM_CURRENT',
    custodianBankReference: policy.custodianBankReference || null,
    // Store reference only — never full account details in snapshots/logs.
    accountIdentifier: policy.accountIdentifier ? '***masked***' : null,
    custodyAccount: policy.custodyAccount || null,
    principalReleaseConditions: policy.principalReleaseConditions || null,
    refundSLA: policy.refundSLA || null,
    reconciliationFrequency: policy.reconciliationFrequency || null,
    custodyApprovalStatus: policy.custodyApprovalStatus || 'pending',
    custodyApprovalReference: policy.custodyApprovalReference || null,
    custodyConfigurationVersion: policy.custodyConfigurationVersion || '1.0',
    policyStatus: policy.status || null,
    policyVersion: policy.version || null,
  };
}

function snapshotTax(policy) {
  const out = {};
  for (const k of ['holdServiceFee', 'propertySaleCommission', 'holdPrincipal', 'listingPackageFee']) {
    const active = getActiveTaxForSupply(policy, k);
    // Inactive => explicit null (not zero, not 18) so readers can see
    // no determination was in force. Never auto-apply a rate.
    out[k] = active || { inactive: true, reason: 'no approved written determination' };
  }
  return out;
}

/**
 * Admin update — partial PATCH. Only the latest ACTIVE policy is
 * editable in place; an admin can also retire the current and create
 * a new DRAFT, but that's a future flow.
 *
 * A partial that does not include `effectiveTo` leaves it open-ended.
 * A partial that flips `status` to DRAFT retires the policy; the editor
 * calls [retire] for that.
 */
// Custody substance keys. A change to any of these stages a new custody
// determination and opens a CUSTODY_CONFIG case — approval flips the
// status via the case workflow, never via this operator route.
const CUSTODY_DETERMINATION_KEYS = [
  'custodyMode',
  'custodianBankReference',
  'accountIdentifier',
  'principalReleaseConditions',
  'refundSLA',
  'reconciliationFrequency',
  'supportingDocuments',
  'custodyEffectiveDate',
  'custodyApprovalReference',
  'custodyConfigurationVersion',
  'custodyChangeReason',
  'custodyAccount',
];

function pickCustody(policyLike) {
  const out = {};
  for (const k of CUSTODY_DETERMINATION_KEYS) out[k] = policyLike[k];
  return JSON.parse(JSON.stringify(out));
}

async function updateActive(patch = {}, actor = {}) {
  const current = await RealEstateHoldPolicy.findOne({ status: 'ACTIVE' }).sort({ version: -1 });
  if (!current) {
    throw new Error('No ACTIVE hold policy to update');
  }
  const touchedCustody = Object.keys(patch).filter((k) => CUSTODY_DETERMINATION_KEYS.includes(k));
  const beforeCustody = touchedCustody.length ? pickCustody(current) : null;
  for (const [k, v] of Object.entries(patch)) {
    if (UPDATABLE.includes(k)) {
      current[k] = v;
    }
  }
  current.updatedBy = actor._id;
  await current.save();
  // Stage + evidence: a custody edit opens the approval case the approver
  // decides. Scoped to THIS patch (routine edits while a case is open do
  // not throw) — but a second custody proposal while one is pending is a
  // duplicate, surfaced readably like the HOLD_POLICY submit path.
  if (touchedCustody.length) {
    const approvalService = require('./realestate.approval.service');
    try {
      await approvalService.requestApproval(
        {
          category: 'CUSTODY_CONFIG',
          targetModel: 'RealEstateHoldPolicy',
          targetId: current._id,
          detail: 'custody',
          diffBefore: beforeCustody,
          diffAfter: pickCustody(current),
          changeReason: patch.custodyChangeReason || current.custodyChangeReason || '',
          supportingDocuments: Array.isArray(patch.supportingDocuments)
            ? patch.supportingDocuments
            : [],
        },
        actor
      );
    } catch (e) {
      if (e && e.code === 11000) {
        throw new Error('A custody approval case is already open for this policy. Cancel it or wait for a decision before editing custody again.');
      }
      throw e;
    }
  }
  return current;
}

async function retire(policyId, actor = {}) {
  if (!policyId) throw new Error('policyId is required');
  const updated = await RealEstateHoldPolicy.findByIdAndUpdate(
    policyId,
    {
      $set: {
        status: 'RETIRED',
        effectiveTo: new Date(),
        updatedBy: actor._id,
      },
    },
    { new: true }
  );
  return updated;
}

function freeze(policy) {
  return {
    policyId: policy._id,
    version: policy.version,
    principalAmount: policy.principalAmount,
    serviceFeePercent: policy.serviceFeePercent,
    serviceFeeMin: policy.serviceFeeMin,
    serviceFeeMax: policy.serviceFeeMax,
    durationDays: policy.durationDays,
    gracePeriodHours: policy.gracePeriodHours,
    cancellationRefundable: policy.cancellationRefundable,
    expiryRefundable: policy.expiryRefundable,
    feeRefundableOnListingWithdrawal: policy.feeRefundableOnListingWithdrawal,
    forfeitureRequiresDualControl: policy.forfeitureRequiresDualControl,
    cancellationFeeBorneBy: policy.cancellationFeeBorneBy,
    effectiveFrom: policy.effectiveFrom,
    // OD-01/OD-04: frozen custody + tax. Later Admin edits must never
    // restate a live hold — invoices/refunds/settlements read these.
    custodySnapshot: snapshotCustody(policy),
    taxSnapshot: snapshotTax(policy),
  };
}

/**
 * Admin: open a new DRAFT version off the latest row. Terms, custody
 * and tax carry over; approvals reset to pending. Live holds keep
 * reading the ACTIVE row until the draft is approved + activated —
 * history is never restated (BR-15).
 */
async function createNewVersion({ name = '', changeReason = '' } = {}, actor = {}) {
  const latest = await RealEstateHoldPolicy.findOne({}).sort({ version: -1 });
  if (!latest) throw new Error('No hold policy to version — seed one first.');
  const src = latest.toObject();
  delete src._id;
  delete src.createdAt;
  delete src.updatedAt;
  delete src.__v;
  const copy = {
    ...src,
    name: name || `${src.name || 'Hold policy'} v${(src.version || 1) + 1}`,
    version: (src.version || 1) + 1,
    status: 'DRAFT',
    effectiveFrom: new Date(),
    effectiveTo: null,
    approvedBy: null,
    approvedAt: null,
    approvalReference: null,
    changeReason: changeReason || '',
    custodyApprovalStatus: 'pending',
    custodyApprovedBy: null,
    custodyApprovedAt: null,
    updatedBy: actor._id,
  };
  if (copy.taxConfiguration) {
    for (const k of ['holdServiceFee', 'propertySaleCommission', 'holdPrincipal', 'listingPackageFee']) {
      if (copy.taxConfiguration[k]) {
        copy.taxConfiguration[k] = {
          ...copy.taxConfiguration[k],
          approvalStatus: 'pending',
          approvedBy: null,
          approvedAt: null,
        };
      }
    }
  }
  const created = await RealEstateHoldPolicy.create(copy);
  return created.toObject({ getters: true });
}

/**
 * Approval workflow transitions (role-separated):
 * - Admin operator: DRAFT <-> PENDING_APPROVAL (draft/edit, submit).
 * - Finance/legal approver: PENDING_APPROVAL -> APPROVED (within authority).
 * - Authorized administrator: APPROVED -> ACTIVE (activate), any -> RETIRED.
 * - Auditor: read-only (listAll/getById).
 * Separate approval from activation — never auto-activate on approve.
 */
async function submitForApproval(actor = {}, opts = {}) {
  const approvalService = require('./realestate.approval.service');
  const current = await RealEstateHoldPolicy.findOne({
    status: { $in: ['DRAFT', 'APPROVED'] },
  }).sort({ version: -1 });
  if (!current) throw new Error('No DRAFT/APPROVED hold policy to submit');
  const before = current.toObject({ getters: true });
  current.status = 'PENDING_APPROVAL';
  current.submittedBy = actor._id;
  current.submittedAt = new Date();
  current.updatedBy = actor._id;
  if (opts.changeReason !== undefined) current.changeReason = opts.changeReason;
  await current.save();
  // Open the evidence case. A second submit while one is open is a
  // duplicate (unique index) — surfaced as a readable error.
  try {
    await approvalService.requestApproval(
      {
        category: 'HOLD_POLICY',
        targetModel: 'RealEstateHoldPolicy',
        targetId: current._id,
        detail: `v${current.version}`,
        diffBefore: before,
        diffAfter: current.toObject({ getters: true }),
        changeReason: opts.changeReason || current.changeReason || '',
        supportingDocuments: opts.supportingDocuments || [],
      },
      actor
    );
  } catch (e) {
    if (e && e.code === 11000) {
      throw new Error('An approval case is already open for this policy version.');
    }
    throw e;
  }
  return current;
}

async function approvePolicy(policyId, { approvedBy, approvalReference, changeReason, note = '' } = {}, actor = {}) {
  const approvalService = require('./realestate.approval.service');
  const doc = await RealEstateHoldPolicy.findById(policyId);
  if (!doc) throw new Error('Hold policy not found');
  if (doc.status !== 'PENDING_APPROVAL') throw new Error('Only PENDING_APPROVAL policies can be approved');
  const approverId = approvedBy || actor._id;
  const requesterId = doc.submittedBy || doc.updatedBy;
  if (requesterId && String(requesterId) === String(approverId)) {
    throw new Error('Segregation of duties: the requester cannot approve their own policy.');
  }
  doc.status = 'APPROVED';
  doc.approvedBy = approverId;
  doc.approvedAt = new Date();
  if (approvalReference !== undefined) doc.approvalReference = approvalReference;
  if (changeReason !== undefined) doc.changeReason = changeReason;
  doc.updatedBy = actor._id;
  await doc.save();
  // Resolve the open case with the same approver — the case-level
  // requester check mirrors the one above.
  const openCase = await approvalService.findOpenForTarget('HOLD_POLICY', doc._id);
  if (openCase) {
    await approvalService.approveCase(openCase._id, { _id: approverId }, { note: note || changeReason || '', approvalReference: approvalReference || '' });
  }
  return doc;
}

async function activatePolicy(policyId, actor = {}) {
  const approvalService = require('./realestate.approval.service');
  const doc = await RealEstateHoldPolicy.findById(policyId);
  if (!doc) throw new Error('Hold policy not found');
  if (doc.status !== 'APPROVED') throw new Error('Only APPROVED policies can be activated');
  // Gap A: activation needs a third pair of hands — neither the approver
  // nor the requester (submittedBy) may activate. submittedBy is absent
  // only for rows approved outside the submit flow; with no requester on
  // record there is nothing to compare, so that leg stays open by design.
  if (doc.submittedBy && actor._id && String(doc.submittedBy) === String(actor._id)) {
    throw new Error('Segregation of duties: the requester cannot activate — a different person must activate.');
  }
  if (doc.approvedBy && actor._id && String(doc.approvedBy) === String(actor._id)) {
    throw new Error('Segregation of duties: the approver cannot activate — a second pair of hands is required.');
  }
  // Retire current ACTIVE so exactly one ACTIVE exists.
  await RealEstateHoldPolicy.updateMany({ status: 'ACTIVE' }, { $set: { status: 'RETIRED', effectiveTo: new Date() } });
  doc.status = 'ACTIVE';
  doc.updatedBy = actor._id;
  await doc.save();
  const RealEstateApprovalCase = require('../models/realestate.approval.case.model');
  const approvedCase = await RealEstateApprovalCase.findOne({
    category: 'HOLD_POLICY',
    targetId: doc._id,
    status: 'APPROVED',
  }).sort({ createdAt: -1 });
  if (approvedCase) {
    await approvalService.markActivated(approvedCase._id, actor);
  }
  return doc;
}

// OD-04: per-supply tax update. Each supply needs its own written
// determination + approval — never bulk-approve all four at once.
//
// Gap B: this OPERATOR route stages pending determinations only. It never
// accepts approval identity (`approvalStatus`/`approvedBy`/`approvedAt`
// are stripped even if sent), and every touch resets the node to pending
// — so a post-approval operator edit can never silently keep an approval
// alive on changed substance. Approval flips the node via the TAX_CONFIG
// case workflow (approveCase), never here.
async function updateTaxSupply(policyId, supplyKey, patch = {}, actor = {}) {
  const allowed = [
    'hsnSac',
    'taxClassification',
    'applicableRate',
    'invoiceTreatment',
    'taxComponents',
    'inclusivePricing',
    'effectiveFrom',
    'effectiveTo',
    'approvalReference',
    'configurationVersion',
    'changeReason',
  ];
  const supplies = ['holdServiceFee', 'propertySaleCommission', 'holdPrincipal', 'listingPackageFee'];
  if (!supplies.includes(supplyKey)) throw new Error(`Unknown tax supply: ${supplyKey}`);
  const doc = await RealEstateHoldPolicy.findById(policyId);
  if (!doc) throw new Error('Hold policy not found');
  if (doc.status === 'ACTIVE') throw new Error('Cannot edit tax on ACTIVE policy — create a new version instead');
  const rawNode = doc.taxConfiguration[supplyKey] || {};
  const plainNode =
    rawNode && typeof rawNode.toObject === 'function' ? rawNode.toObject() : rawNode;
  const beforeNode = JSON.parse(JSON.stringify(plainNode));
  const node = { ...beforeNode };
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.includes(k)) node[k] = v;
  }
  node.approvalStatus = 'pending';
  node.approvedBy = null;
  node.approvedAt = null;
  doc.taxConfiguration[supplyKey] = node;
  doc.markModified('taxConfiguration');
  doc.updatedBy = actor._id;
  await doc.save();
  // Stage + evidence: every staged determination opens the TAX_CONFIG case
  // the approver decides (mirrors the HOLD_POLICY submit path). A second
  // edit while the supply's case is open is a duplicate, surfaced readably.
  const approvalService = require('./realestate.approval.service');
  try {
    await approvalService.requestApproval(
      {
        category: 'TAX_CONFIG',
        targetModel: 'RealEstateHoldPolicy',
        targetId: doc._id,
        detail: `tax:${supplyKey}`,
        diffBefore: beforeNode,
        diffAfter: JSON.parse(JSON.stringify(node)),
        changeReason: patch.changeReason || '',
        supportingDocuments: [],
      },
      actor
    );
  } catch (e) {
    if (e && e.code === 11000) {
      throw new Error(`An approval case is already open for ${supplyKey}. Cancel it or wait for a decision before editing again.`);
    }
    throw e;
  }
  return doc;
}

/** Fee = principal × percent, clamped by min/max. Rupees in/out. */
function computeServiceFee(principalRupees, policyLike) {
  let fee = (principalRupees * policyLike.serviceFeePercent) / 100;
  if (policyLike.serviceFeeMin > 0 && fee < policyLike.serviceFeeMin) fee = policyLike.serviceFeeMin;
  if (policyLike.serviceFeeMax > 0 && fee > policyLike.serviceFeeMax) fee = policyLike.serviceFeeMax;
  return Number(fee.toFixed(2));
}

const realEstateHoldPolicyService = {
  getActive,
  listAll,
  getById,
  updateActive,
  createNewVersion,
  retire,
  freeze,
  computeServiceFee,
  UPDATABLE,
  isCustodyApprovedForLive,
  assertCustodyApprovedForLive,
  getActiveTaxForSupply,
  snapshotCustody,
  snapshotTax,
  submitForApproval,
  approvePolicy,
  activatePolicy,
  updateTaxSupply,
};

module.exports = realEstateHoldPolicyService;
