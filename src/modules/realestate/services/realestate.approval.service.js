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

const RealEstateApprovalCase = require('../models/realestate.approval.case.model');
const auditService = require('./realestate.audit.service');
const sequence = require('../models/realestate.sequence.model');

// Production: case numbers must be unique across restarts and processes.
// The old in-memory counter + timestamp slice collided after a restart
// (counter reset) and under concurrent requests (same ms slice), failing
// on the unique index. `sequence.next` is one atomic $inc + upsert.
async function nextCaseNo() {
  const seq = await sequence.next('approvalCase');
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `APR-${period}-${String(seq).padStart(6, '0')}`;
}

const sameId = (a, b) => a && b && String(a) === String(b);

const DEFAULT_SLA_HOURS = 72;

/**
 * Approval service — SoD-enforced decisions with a frozen diff.
 *
 * Invariants (all enforced here, all throw):
 *  - one open REQUESTED case per (category, target, detail);
 *  - approver ≠ requester (four-eyes);
 *  - only REQUESTED cases can be decided;
 *  - ACTIVATED only from APPROVED, by someone ≠ approver AND ≠ requester;
 *  - TAX_CONFIG / CUSTODY_CONFIG approvals apply the frozen staged values,
 *    never the live document (which may have moved since the request).
 */

/**
 * Open a case. `diffAfter` is the proposed state, `diffBefore` the
 * current — the approver reviews these frozen copies.
 */
async function requestApproval(
  {
    category,
    targetModel,
    targetId,
    detail = null,
    diffBefore = {},
    diffAfter = {},
    changeReason = '',
    supportingDocuments = [],
    slaHours = DEFAULT_SLA_HOURS,
  },
  actor = {}
) {
  if (!actor._id) throw new Error('requestApproval requires an actor.');
  const doc = {
    caseNo: await nextCaseNo(),
    category,
    targetModel,
    targetId,
    requester: actor._id,
    diffBefore,
    diffAfter,
    changeReason,
    supportingDocuments,
    slaDue: new Date(Date.now() + slaHours * 60 * 60 * 1000),
  };
  if (detail) doc.detail = detail;
  const created = await RealEstateApprovalCase.create(doc);
  await auditService.record({
    eventType: 'REALESTATE_APPROVAL_REQUESTED',
    targetType: 'RealEstateApprovalCase',
    targetId: created._id,
    actor: actor._id,
    actorType: 'admin',
    reason: changeReason,
    metadata: { caseNo: created.caseNo, category },
  });
  return created.toObject({ getters: true });
}

async function approveCase(caseId, actor = {}, { note = '', approvalReference = '' } = {}) {
  const c = await RealEstateApprovalCase.findById(caseId);
  if (!c) throw new Error('Approval case not found.');
  if (c.status !== 'REQUESTED') throw new Error(`Case is ${c.status} and cannot be approved.`);
  if (sameId(actor._id, c.requester)) {
    throw new Error('Segregation of duties: the requester cannot approve their own case.');
  }
  // TAX_CONFIG / CUSTODY_CONFIG carry their effect: apply the FROZEN staged
  // values (diffAfter), never the live document — the operator may have
  // edited it after requesting. A throw here leaves the case REQUESTED.
  if (c.category === 'TAX_CONFIG' || c.category === 'CUSTODY_CONFIG') {
    await applyConfigApproval(c, actor, { approvalReference });
  }
  c.status = 'APPROVED';
  c.approver = actor._id;
  c.decidedAt = new Date();
  if (note) c.decisionNote = note;
  if (approvalReference) c.approvalReference = approvalReference;
  await c.save();
  await auditService.record({
    eventType: 'REALESTATE_APPROVAL_DECIDED',
    targetType: 'RealEstateApprovalCase',
    targetId: c._id,
    actor: actor._id,
    actorType: 'admin',
    reason: note,
    metadata: { caseNo: c.caseNo, decision: 'APPROVED', approvalReference: approvalReference || null },
  });
  return c.toObject({ getters: true });
}

async function rejectCase(caseId, actor = {}, { note = '' } = {}) {
  const c = await RealEstateApprovalCase.findById(caseId);
  if (!c) throw new Error('Approval case not found.');
  if (c.status !== 'REQUESTED') throw new Error(`Case is ${c.status} and cannot be rejected.`);
  if (sameId(actor._id, c.requester)) {
    throw new Error('Segregation of duties: the requester cannot reject their own case — cancel it instead.');
  }
  if (!note || !note.trim()) throw new Error('A rejection reason is required.');
  c.status = 'REJECTED';
  c.approver = actor._id;
  c.decidedAt = new Date();
  c.decisionNote = note.trim();
  await c.save();
  await auditService.record({
    eventType: 'REALESTATE_APPROVAL_DECIDED',
    targetType: 'RealEstateApprovalCase',
    targetId: c._id,
    actor: actor._id,
    actorType: 'admin',
    reason: note.trim(),
    metadata: { caseNo: c.caseNo, decision: 'REJECTED' },
  });
  return c.toObject({ getters: true });
}

async function cancelCase(caseId, actor = {}) {
  const c = await RealEstateApprovalCase.findById(caseId);
  if (!c) throw new Error('Approval case not found.');
  if (c.status !== 'REQUESTED') throw new Error(`Case is ${c.status} and cannot be cancelled.`);
  if (!sameId(actor._id, c.requester)) {
    throw new Error('Only the requester can cancel their case.');
  }
  c.status = 'CANCELLED';
  c.decidedAt = new Date();
  await c.save();
  return c.toObject({ getters: true });
}

async function markActivated(caseId, actor = {}) {
  const c = await RealEstateApprovalCase.findById(caseId);
  if (!c) throw new Error('Approval case not found.');
  if (c.status !== 'APPROVED') throw new Error(`Case is ${c.status} — only APPROVED cases activate.`);
  // Gap A: activation needs a third pair of hands — neither the approver
  // nor the requester may activate their own case.
  if (sameId(actor._id, c.requester)) {
    throw new Error('Segregation of duties: the requester cannot activate their own case — a different person must activate.');
  }
  if (sameId(actor._id, c.approver)) {
    throw new Error('Segregation of duties: the approver cannot activate — a second pair of hands is required.');
  }
  c.status = 'ACTIVATED';
  await c.save();
  return c.toObject({ getters: true });
}

// Per-supply tax keys, mirroring the hold-policy taxConfiguration nodes.
const TAX_SUPPLIES = ['holdServiceFee', 'propertySaleCommission', 'holdPrincipal', 'listingPackageFee'];

// Determination substance the approver actually reviews. Approval identity
// fields (approvalStatus/approvedBy/approvedAt) are stamped here, never
// taken from operator input.
const TAX_SUBSTANCE_KEYS = [
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

const CUSTODY_SUBSTANCE_KEYS = [
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

/**
 * Apply a TAX_CONFIG / CUSTODY_CONFIG approval to the target hold policy.
 *
 * Writes the case's FROZEN diffAfter values plus the approval identity —
 * the operator route can only stage pending determinations (Gap B), so
 * this is the sole path that flips a supply or custody to approved.
 * Fail-closed: unknown category detail, missing target, or missing staged
 * values all throw and the case stays REQUESTED.
 */
async function applyConfigApproval(caseDoc, approver, { approvalReference = '' } = {}) {
  // Lazy require: hold.policy.service requires this module inside its own
  // functions, so a top-level import would risk a load-order cycle.
  const RealEstateHoldPolicy = require('../models/realestate.hold.policy.model');
  if (caseDoc.targetModel !== 'RealEstateHoldPolicy') {
    throw new Error(`Cannot apply ${caseDoc.category} approval: unexpected target ${caseDoc.targetModel}.`);
  }
  const policy = await RealEstateHoldPolicy.findById(caseDoc.targetId);
  if (!policy) throw new Error('Cannot apply approval: target hold policy not found.');
  const staged =
    caseDoc.diffAfter && typeof caseDoc.diffAfter === 'object' ? caseDoc.diffAfter : null;
  if (!staged) throw new Error('Cannot apply approval: case carries no staged determination.');
  const now = new Date();
  if (caseDoc.category === 'TAX_CONFIG') {
    const match = /^tax:([A-Za-z]+)$/.exec(String(caseDoc.detail || ''));
    const supplyKey = match && match[1];
    if (!TAX_SUPPLIES.includes(supplyKey)) {
      throw new Error(`Cannot apply TAX_CONFIG approval: unknown supply in case detail ${JSON.stringify(caseDoc.detail)}.`);
    }
    const node = (policy.taxConfiguration && policy.taxConfiguration[supplyKey]) || {};
    const plain = typeof node.toObject === 'function' ? node.toObject() : node;
    const next = { ...plain };
    for (const k of TAX_SUBSTANCE_KEYS) {
      if (staged[k] !== undefined) next[k] = staged[k];
    }
    next.approvalStatus = 'approved';
    next.approvedBy = approver._id;
    next.approvedAt = now;
    if (approvalReference) next.approvalReference = approvalReference;
    policy.taxConfiguration[supplyKey] = next;
    policy.markModified('taxConfiguration');
    policy.updatedBy = approver._id;
    await policy.save();
    await auditService.record({
      eventType: 'REALESTATE_HOLD_POLICY_TAX_UPDATED',
      targetType: 'RealEstateHoldPolicy',
      targetId: policy._id,
      actor: approver._id,
      actorType: 'admin',
      reason: `TAX_CONFIG case ${caseDoc.caseNo} approved`,
      metadata: { supply: supplyKey, caseNo: caseDoc.caseNo },
    });
    return;
  }
  // CUSTODY_CONFIG (detail 'custody').
  if (String(caseDoc.detail || '') !== 'custody') {
    throw new Error(`Cannot apply CUSTODY_CONFIG approval: unexpected case detail ${JSON.stringify(caseDoc.detail)}.`);
  }
  for (const k of CUSTODY_SUBSTANCE_KEYS) {
    if (staged[k] !== undefined) policy[k] = staged[k];
  }
  policy.custodyApprovalStatus = 'approved';
  policy.custodyApprovedBy = approver._id;
  policy.custodyApprovedAt = now;
  if (approvalReference) policy.custodyApprovalReference = approvalReference;
  policy.updatedBy = approver._id;
  await policy.save();
  await auditService.record({
    eventType: 'REALESTATE_HOLD_POLICY_CUSTODY_UPDATED',
    targetType: 'RealEstateHoldPolicy',
    targetId: policy._id,
    actor: approver._id,
    actorType: 'admin',
    reason: `CUSTODY_CONFIG case ${caseDoc.caseNo} approved`,
    metadata: { caseNo: caseDoc.caseNo },
  });
}

async function addComment(caseId, actor = {}, text = '') {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Comment text is required.');
  const c = await RealEstateApprovalCase.findById(caseId);
  if (!c) throw new Error('Approval case not found.');
  c.comments.push({ author: actor._id, text: clean.slice(0, 2000) });
  await c.save();
  return c.toObject({ getters: true });
}

async function findOpenForTarget(category, targetId, detail = null) {
  const filter = { category, targetId, status: 'REQUESTED' };
  if (detail !== null && detail !== undefined) filter.detail = detail;
  return RealEstateApprovalCase.findOne(filter).lean();
}

async function listCases({ status, category, page = 1, limit = 20 } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;
  const [docs, total] = await Promise.all([
    RealEstateApprovalCase.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('requester', 'firstName lastName email')
      .populate('approver', 'firstName lastName email')
      .lean(),
    RealEstateApprovalCase.countDocuments(filter),
  ]);
  return { results: docs, total, page, limit };
}

/**
 * Expire past-SLA REQUESTED cases. Called from the cron sweep —
 * expiry is a timeout, not a decision, so it never approves.
 */
async function expireOverdue(now = new Date()) {
  const res = await RealEstateApprovalCase.updateMany(
    { status: 'REQUESTED', slaDue: { $lt: now } },
    { $set: { status: 'EXPIRED', decidedAt: now } }
  );
  return { expired: res.modifiedCount || 0 };
}

const realEstateApprovalService = {
  DEFAULT_SLA_HOURS,
  requestApproval,
  approveCase,
  rejectCase,
  cancelCase,
  markActivated,
  addComment,
  findOpenForTarget,
  listCases,
  expireOverdue,
};

module.exports = realEstateApprovalService;
