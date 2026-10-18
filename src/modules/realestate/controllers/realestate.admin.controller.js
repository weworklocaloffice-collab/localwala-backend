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

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const propertyService = require('../services/realestate.property.service');
const holdRefundService = require('../services/realestate.hold.refund.service');
const holdService = require('../services/realestate.hold.service');
const ruleService = require('../services/realestate.commission.rule.service');
const settlementService = require('../services/realestate.settlement.service');
const loanService = require('../services/realestate.loan.service');
const documentService = require('../services/realestate.document.service');
const categoryService = require('../services/realestate.category.service');
const holdPolicyService = require('../services/realestate.hold.policy.service');
const packageService = require('../services/realestate.listing.package.service');
const orderService = require('../services/realestate.listing.order.service');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');

/**
 * Admin controller — moderation, refunds, rules, settlements.
 * Every route carries a webAuth rights string (DEFECT-2 guard).
 * BR-10: this controller NEVER sets SANCTIONED/REJECTED/DISBURSED —
 * those live only in the bank controller with actorType 'bank'.
 */

const setPropertyStatus = catchAsync(async (req, res) => {
  const property = await propertyService.changeStatus(req.params.id, req.params.status, { actorType: 'admin' });
  res.status(httpStatus.OK).send(property);
});

const listVerificationQueue = catchAsync(async (req, res) => {
  const result = await propertyService.listVerificationQueue({
    page: parseInt(req.query.page, 10) || 1,
    limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
  });
  res.status(httpStatus.OK).send(result);
});

const completeRefund = catchAsync(async (req, res) => {
  // F-11: refund completion is multi-write (ledger CREDITs + refund + hold).
  const refund = await withOptionalTransaction((session) =>
    holdRefundService.completeRefund(req.params.id, req.user.id, session)
  );
  res.status(httpStatus.OK).send(refund);
});

const forfeitHold = catchAsync(async (req, res) => {
  holdService.assertForfeitureDualControl(req.body.requestedBy, req.user.id);
  const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
  const hold = await RealEstatePropertyHold.findById(req.params.id);
  if (!hold) return res.status(httpStatus.NOT_FOUND).send({ message: 'Hold not found' });
  hold.forfeitureRequestedBy = req.body.requestedBy;
  hold.forfeitureApprovedBy = req.user.id;
  hold.forfeitureReason = req.body.reason || '';
  await hold.save();
  res.status(httpStatus.OK).send(hold);
});

const createCommissionRule = catchAsync(async (req, res) => {
  const rule = await ruleService.createRule(req.body);
  res.status(httpStatus.CREATED).send(rule);
});

const activateCommissionRule = catchAsync(async (req, res) => {
  const rule = await ruleService.activateRule(req.params.id);
  res.status(httpStatus.OK).send(rule);
});

const updateCommissionRule = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const rule = await ruleService.updateDraftRule(req.params.id, req.body || {});
  await auditService.record({
    eventType: 'REALESTATE_COMMISSION_RULE_UPDATED',
    targetType: 'RealEstateCommissionRule',
    targetId: rule._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { type: rule.type, rate: rule.rate },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send(rule);
});

const retireCommissionRule = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const rule = await ruleService.retireRule(req.params.id, req.body.effectiveTo || new Date());
  await auditService.record({
    eventType: 'REALESTATE_COMMISSION_RULE_RETIRED',
    targetType: 'RealEstateCommissionRule',
    targetId: rule._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { type: rule.type },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send(rule);
});

const generateSettlement = catchAsync(async (req, res) => {
  // F-11: settlement creation counts frozen entries — one unit with its reads.
  const settlement = await withOptionalTransaction((session) => settlementService.generate(req.body, session));
  res.status(httpStatus.CREATED).send(settlement);
});

const setSettlementStatus = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const updated = await settlementService.setStatus(req.params.id, req.params.status, {
    actorId: req.user.id,
    payoutReference: req.body.payoutReference || '',
  });
  await auditService.record({
    eventType: 'REALESTATE_SETTLEMENT_STATUS',
    targetType: 'RealEstateSettlement',
    targetId: updated._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { status: updated.status, payoutReference: updated.payoutReference || null },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send({ data: updated });
});

const verifyDocument = catchAsync(async (req, res) => {
  const doc = await documentService.verify({
    documentId: req.params.id,
    decision: req.body.decision,
    verifiedBy: req.user.id,
  });
  res.status(httpStatus.OK).send(doc);
});

const viewLoan = catchAsync(async (req, res) => {
  const RealEstateLoanApplication = require('../models/realestate.loan.application.model');
  const app = await RealEstateLoanApplication.findById(req.params.id);
  if (!app) return res.status(httpStatus.NOT_FOUND).send({ message: 'Loan application not found' });
  res.status(httpStatus.OK).send(app);
});

const getSettings = catchAsync(async (req, res) => {
  const RealEstateSetting = require('../models/realestate.setting.model');
  let doc = await RealEstateSetting.findOne();
  if (!doc) doc = await RealEstateSetting.create({});
  res.status(httpStatus.OK).send({ data: doc });
});

// NOTE (Gap B follow-through): the settings document's approval-identity
// fields (`status` / `approvalStatus` / `approvedBy` / `approvedAt`) are
// deliberately NOT accepted here. Nothing gates on them — live custody and
// tax decisions are read off the hold POLICY, approved via the TAX_CONFIG /
// CUSTODY_CONFIG case workflow. Accepting them here would let the settings
// screen display "approved" while the gates stay shut (fail-confusing).
// Structural staging data (modes, refs, HSN/SAC, rates, GSTIN, series) and
// the memo linkage (`approvalReference`) stay editable.
const HOLD_CUSTODY_FIELDS = [
  'custodyMode',
  'custodianBankReference',
  'accountIdentifier',
  'principalReleaseConditions',
  'refundSLA',
  'reconciliationFrequency',
  'supportingDocuments',
  'effectiveFrom',
  'effectiveTo',
  'approvalReference',
  'configurationVersion',
  'changeReason',
];

const TAX_SUPPLY_FIELDS = [
  'hsnSac',
  'taxClassification',
  'approvedRate',
  'invoiceTreatment',
  'taxComponents',
  'inclusivePricing',
  'effectiveFrom',
  'effectiveTo',
  'approvalReference',
];

const TAX_SECTION_FIELDS = [
  'effectiveFrom',
  'effectiveTo',
  'approvalReference',
  'configurationVersion',
  'changeReason',
  'orgGstin',
  'defaultPlaceOfSupply',
];

const TAX_SERIES_FIELDS = ['holdServiceFee', 'propertySaleCommission', 'holdPrincipal', 'listingPackageFee'];

function pickFields(source, allowed) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const k of allowed) {
    if (source[k] !== undefined) out[k] = source[k];
  }
  return out;
}

const updateSettings = catchAsync(async (req, res) => {
  const RealEstateSetting = require('../models/realestate.setting.model');
  const auditService = require('../services/realestate.audit.service');
  const allowed = [
    'enabled', 'enquiryRequiresContactVerified', 'autoAssignVisitRequests',
    'defaultCheckInRadiusMeters', 'defaultHoldDurationDays', 'searchMaxRadiusKm',
    'listingMaxImages', 'listingMaxVideos', 'documentMaxSizeBytes',
    'customerCanRequestLoan', 'customerCanHoldProperty',
    'referralCommissionEnabled', 'promotionsEnabled', 'notificationsEnabled',
  ];
  const patch = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) patch[k] = req.body[k];
  }
  // OD-01: Hold & Custody (draft/edit by operator; approve/activate gated).
  if (req.body.holdCustody && typeof req.body.holdCustody === 'object') {
    patch.holdCustody = pickFields(req.body.holdCustody, HOLD_CUSTODY_FIELDS);
  }
  // OD-04: Tax & Invoicing — per-supply sub-configs, never merged.
  if (req.body.taxInvoicing && typeof req.body.taxInvoicing === 'object') {
    const src = req.body.taxInvoicing;
    const taxPatch = pickFields(src, TAX_SECTION_FIELDS);
    for (const supply of ['holdServiceFee', 'propertySaleCommission', 'holdPrincipal', 'listingPackageFee']) {
      if (src[supply] && typeof src[supply] === 'object') {
        taxPatch[supply] = pickFields(src[supply], TAX_SUPPLY_FIELDS);
      }
    }
    if (src.invoiceSeries && typeof src.invoiceSeries === 'object') {
      taxPatch.invoiceSeries = pickFields(src.invoiceSeries, TAX_SERIES_FIELDS);
    }
    patch.taxInvoicing = taxPatch;
  }
  patch.updatedBy = req.user.id;
  let doc = await RealEstateSetting.findOne();
  const before = doc ? doc.toObject() : null;
  if (!doc) doc = await RealEstateSetting.create({ ...patch });
  else {
    // Merge nested sections — a partial must not wipe the other section.
    // Updating settings must never rewrite historical invoices/txns:
    // history lives in frozen snapshots (policySnapshot/taxSnapshot),
    // not in this live document, so editing here only affects NEW txns.
    if (patch.holdCustody) {
      doc.holdCustody = { ...(doc.holdCustody ? doc.holdCustody.toObject() : {}), ...patch.holdCustody };
      delete patch.holdCustody;
    }
    if (patch.taxInvoicing) {
      const current = doc.taxInvoicing ? doc.taxInvoicing.toObject() : {};
      const merged = { ...current, ...patch.taxInvoicing };
      for (const supply of ['holdServiceFee', 'propertySaleCommission', 'holdPrincipal', 'listingPackageFee']) {
        if (patch.taxInvoicing[supply]) {
          merged[supply] = { ...(current[supply] || {}), ...patch.taxInvoicing[supply] };
        }
      }
      if (patch.taxInvoicing.invoiceSeries) {
        merged.invoiceSeries = { ...(current.invoiceSeries || {}), ...patch.taxInvoicing.invoiceSeries };
      }
      doc.taxInvoicing = merged;
      delete patch.taxInvoicing;
    }
    Object.assign(doc, patch);
    await doc.save();
  }
  // Audit trail for sensitive config changes (never throws into save).
  await auditService.record({
    eventType: 'REALESTATE_SETTINGS_UPDATED',
    targetType: 'RealEstateSetting',
    targetId: doc._id,
    actor: req.user.id,
    actorType: 'admin',
    reason: (req.body.holdCustody && req.body.holdCustody.changeReason) || (req.body.taxInvoicing && req.body.taxInvoicing.changeReason) || '',
    before: before ? { holdCustody: before.holdCustody, taxInvoicing: before.taxInvoicing } : null,
    after: { holdCustody: doc.holdCustody, taxInvoicing: doc.taxInvoicing },
    metadata: { sections: [req.body.holdCustody ? 'holdCustody' : null, req.body.taxInvoicing ? 'taxInvoicing' : null].filter(Boolean) },
    ip: req.ip,
    userAgent: req.headers && req.headers['user-agent'],
  });
  res.status(httpStatus.OK).send({ data: doc });
});

// ── Hold-policy approval workflow (role-separated) ──────────────
// Operator: draft/edit (updateActiveHoldPolicy). Finance/legal approver:
// submit -> approve (within authority). Authorized administrator:
// activate. Auditor: list (read-only). Approval and activation are
// separate steps — never auto-activate on approve.

const createHoldPolicyVersion = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const created = await holdPolicyService.createNewVersion(
    { name: req.body.name, changeReason: req.body.changeReason },
    req.user || {}
  );
  await auditService.record({
    eventType: 'REALESTATE_HOLD_POLICY_VERSIONED',
    targetType: 'RealEstateHoldPolicy',
    targetId: created._id,
    actor: req.user.id,
    actorType: 'admin',
    reason: req.body.changeReason || '',
    metadata: { version: created.version },
    ip: req.ip,
  });
  res.status(httpStatus.CREATED).send({ data: created });
});

const submitHoldPolicy = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const updated = await holdPolicyService.submitForApproval(req.user || {}, {
    changeReason: req.body.changeReason,
    supportingDocuments: req.body.supportingDocuments || [],
  });
  await auditService.record({
    eventType: 'REALESTATE_HOLD_POLICY_SUBMITTED',
    targetType: 'RealEstateHoldPolicy',
    targetId: updated._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { version: updated.version },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send({ data: updated });
});

const approveHoldPolicy = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const updated = await holdPolicyService.approvePolicy(
    req.params.id,
    {
      approvedBy: req.body.approvedBy,
      approvalReference: req.body.approvalReference,
      changeReason: req.body.changeReason,
    },
    req.user || {}
  );
  await auditService.record({
    eventType: 'REALESTATE_HOLD_POLICY_APPROVED',
    targetType: 'RealEstateHoldPolicy',
    targetId: updated._id,
    actor: req.user.id,
    actorType: 'admin',
    reason: req.body.changeReason || '',
    metadata: { approvalReference: req.body.approvalReference || null },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send({ data: updated });
});

const activateHoldPolicy = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const updated = await holdPolicyService.activatePolicy(req.params.id, req.user || {});
  await auditService.record({
    eventType: 'REALESTATE_HOLD_POLICY_ACTIVATED',
    targetType: 'RealEstateHoldPolicy',
    targetId: updated._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { version: updated.version },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send({ data: updated });
});

// ── Approval cases (Phase A governance) ───────────────────────
// The queue finance/legal works from. Approve/reject carry the
// approve right; decide paths enforce requester ≠ approver in the
// service. Cancellation is requester-only.
const approvalService = require('../services/realestate.approval.service');

const listApprovalCases = catchAsync(async (req, res) => {
  const result = await approvalService.listCases({
    status: req.query.status,
    category: req.query.category,
    page: parseInt(req.query.page, 10) || 1,
    limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
  });
  res.status(httpStatus.OK).send(result);
});

const approveApprovalCase = catchAsync(async (req, res) => {
  const updated = await approvalService.approveCase(
    req.params.id,
    req.user || {},
    { note: req.body.note, approvalReference: req.body.approvalReference }
  );
  res.status(httpStatus.OK).send({ data: updated });
});

const rejectApprovalCase = catchAsync(async (req, res) => {
  const updated = await approvalService.rejectCase(req.params.id, req.user || {}, { note: req.body.note });
  res.status(httpStatus.OK).send({ data: updated });
});

const cancelApprovalCase = catchAsync(async (req, res) => {
  const updated = await approvalService.cancelCase(req.params.id, req.user || {});
  res.status(httpStatus.OK).send({ data: updated });
});

const commentApprovalCase = catchAsync(async (req, res) => {
  const updated = await approvalService.addComment(req.params.id, req.user || {}, req.body.text);
  res.status(httpStatus.OK).send({ data: updated });
});

// ── Reconciliation (Phase B) ────────────────────────────────────
// Latest money-match report plus history, and a manual run. Reads
// admit the auditor; the manual run stays finance-gated.
const reconciliationService = require('../services/realestate.reconciliation.service');

const latestReconciliation = catchAsync(async (req, res) => {
  const report = await reconciliationService.latestReport();
  res.status(httpStatus.OK).send({ data: report });
});

const listReconciliations = catchAsync(async (req, res) => {
  const result = await reconciliationService.listReports({
    page: parseInt(req.query.page, 10) || 1,
    limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
  });
  res.status(httpStatus.OK).send(result);
});

const runReconciliation = catchAsync(async (req, res) => {
  const report = await reconciliationService.runReconciliation('manual');
  res.status(httpStatus.CREATED).send({ data: report });
});

// ── Invoices + GSTR-1 (Phase C) ─────────────────────────────────
// Reads admit the auditor; cancellation stays finance-gated. Issue
// paths live in the money services (next step), never here — this
// controller only lists, cancels via credit note, and exports.
const invoiceService = require('../services/realestate.invoice.service');

const listInvoices = catchAsync(async (req, res) => {
  const result = await invoiceService.listInvoices({
    supply: req.query.supply,
    status: req.query.status,
    page: parseInt(req.query.page, 10) || 1,
    limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
  });
  res.status(httpStatus.OK).send(result);
});

const getInvoice = catchAsync(async (req, res) => {
  const RealEstateInvoice = require('../models/realestate.invoice.model');
  const doc = await RealEstateInvoice.findById(req.params.id).lean();
  if (!doc) return res.status(httpStatus.NOT_FOUND).send({ message: 'Invoice not found' });
  res.status(httpStatus.OK).send({ data: doc });
});

const cancelInvoice = catchAsync(async (req, res) => {
  const note = await invoiceService.cancelInvoice(
    req.params.id,
    { reason: req.body.reason, actorId: req.user.id }
  );
  res.status(httpStatus.CREATED).send({ data: note });
});

const exportGstr1 = catchAsync(async (req, res) => {
  const rows = await invoiceService.gstr1Scope({ from: req.query.from, to: req.query.to });
  res.status(httpStatus.OK).send({
    from: req.query.from,
    to: req.query.to,
    count: rows.length,
    csv: invoiceService.gstr1Csv(rows),
    rows,
  });
});

// ── Custody statements (Phase B external leg) ───────────────────
// ManualCustody provider: bank CSV upload + strict matching against
// ledger rows. Upload/match stay finance-gated; listing admits audit.
const custodyService = require('../services/realestate.custody.service');

const uploadCustodyStatement = catchAsync(async (req, res) => {
  const result = await custodyService.uploadStatement(
    { filename: req.body.filename, csvText: req.body.csvText },
    req.user || {}
  );
  res.status(httpStatus.CREATED).send({ data: result.statement, skipped: result.skipped, errors: result.errors });
});

const listCustodyStatements = catchAsync(async (req, res) => {
  const result = await custodyService.listStatements({
    page: parseInt(req.query.page, 10) || 1,
    limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
  });
  res.status(httpStatus.OK).send(result);
});

const getCustodyStatement = catchAsync(async (req, res) => {
  const doc = await custodyService.getStatement(req.params.id);
  if (!doc) return res.status(httpStatus.NOT_FOUND).send({ message: 'Custody statement not found' });
  res.status(httpStatus.OK).send({ data: doc });
});

const matchCustodyStatement = catchAsync(async (req, res) => {
  const doc = await custodyService.matchStatement(req.params.id, req.user || {});
  res.status(httpStatus.OK).send({ data: doc });
});

const updateHoldPolicyTaxSupply = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const updated = await holdPolicyService.updateTaxSupply(req.params.id, req.params.supply, req.body || {}, req.user || {});
  await auditService.record({
    eventType: 'REALESTATE_HOLD_POLICY_TAX_UPDATED',
    targetType: 'RealEstateHoldPolicy',
    targetId: updated._id,
    actor: req.user.id,
    actorType: 'admin',
    reason: (req.body && req.body.changeReason) || '',
    metadata: { supply: req.params.supply },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send({ data: updated });
});

const agreementService = require('../services/realestate.bank.agreement.service');

const createBankAgreement = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const created = await agreementService.createAgreement(req.body || {});
  await auditService.record({
    eventType: 'REALESTATE_BANK_AGREEMENT_CREATED',
    targetType: 'RealEstateBankAgreement',
    targetId: created._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { bank: String(created.bank), rate: created.rate },
    ip: req.ip,
  });
  res.status(httpStatus.CREATED).send({ data: created });
});

const updateBankAgreement = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const updated = await agreementService.updateDraftAgreement(req.params.id, req.body || {});
  await auditService.record({
    eventType: 'REALESTATE_BANK_AGREEMENT_UPDATED',
    targetType: 'RealEstateBankAgreement',
    targetId: updated._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { rate: updated.rate },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send({ data: updated });
});

const activateBankAgreement = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const updated = await agreementService.activateAgreement(req.params.id);
  await auditService.record({
    eventType: 'REALESTATE_BANK_AGREEMENT_ACTIVATED',
    targetType: 'RealEstateBankAgreement',
    targetId: updated._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { bank: String(updated.bank), version: updated.version },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send({ data: updated });
});

const expireBankAgreement = catchAsync(async (req, res) => {
  const updated = await agreementService.expireAgreement(req.params.id);
  res.status(httpStatus.OK).send({ data: updated });
});

const createBank = catchAsync(async (req, res) => {
  const bankService = require('../services/realestate.bank.service');
  const bank = await bankService.createBank({ name: req.body.name, code: req.body.code });
  if (req.body.contactEmail) bank.contactEmail = req.body.contactEmail;
  if (req.body.contactPhone) bank.contactPhone = req.body.contactPhone;
  await bank.save();
  res.status(httpStatus.CREATED).send({ data: bank });
});

const listBanks = catchAsync(async (req, res) => {
  const RealEstateBank = require('../models/realestate.bank.model');
  const banks = await RealEstateBank.find({}).sort({ createdAt: -1 }).limit(100);
  res.status(httpStatus.OK).send({ results: banks });
});

const addBankMember = catchAsync(async (req, res) => {
  const bankService = require('../services/realestate.bank.service');
  const member = await bankService.addMember({
    user: req.body.user,
    bank: req.params.id,
    designation: req.body.designation || '',
  });
  res.status(httpStatus.CREATED).send({ data: member });
});

const updateBank = catchAsync(async (req, res) => {
  const bankService = require('../services/realestate.bank.service');
  const auditService = require('../services/realestate.audit.service');
  const updated = await bankService.updateBank(req.params.id, req.body || {});
  await auditService.record({
    eventType: 'REALESTATE_BANK_UPDATED',
    targetType: 'RealEstateBank',
    targetId: updated._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { status: updated.status },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send({ data: updated });
});

const listBankMembers = catchAsync(async (req, res) => {
  const bankService = require('../services/realestate.bank.service');
  const members = await bankService.listMembers(req.params.id);
  res.status(httpStatus.OK).send({ results: members });
});

const setBankMemberStatus = catchAsync(async (req, res) => {
  const bankService = require('../services/realestate.bank.service');
  const auditService = require('../services/realestate.audit.service');
  const updated = await bankService.setMemberStatus(req.params.memberId, {
    status: req.body.status,
    designation: req.body.designation,
  });
  await auditService.record({
    eventType: 'REALESTATE_BANK_MEMBER_STATUS',
    targetType: 'RealEstateBankMember',
    targetId: updated._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { status: updated.status },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send({ data: updated });
});

// ---------------------------------------------------------------- categories
//
// The catalog screen in the admin panel needs read (paginated, status
// filter), upsert (create + edit in one endpoint, keyed on `key`),
// and delete. Delete is hard — categories are versioned data
// (`specSchema` is a runtime contract) so callers should soft-delete
// via `status: false` if they want to keep the descriptor around.

const listCategories = catchAsync(async (req, res) => {
  const { status, group } = req.query;
  const result = await categoryService.listAll({
    status: status === undefined ? undefined : status === 'true',
    group,
    page: parseInt(req.query.page, 10) || 1,
    limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
  });
  res.status(httpStatus.OK).send(result);
});

const upsertCategory = catchAsync(async (req, res) => {
  const result = await categoryService.upsert(req.body, req.user || {});
  res.status(httpStatus.OK).send({ data: result });
});

const deleteCategory = catchAsync(async (req, res) => {
  const result = await categoryService.remove(req.params.id);
  res.status(httpStatus.OK).send(result);
});

// ---------------------------------------------------------------- hold policy

const listHoldPolicies = catchAsync(async (req, res) => {
  const list = await holdPolicyService.listAll();
  res.status(httpStatus.OK).send({ data: list });
});

const updateActiveHoldPolicy = catchAsync(async (req, res) => {
  const updated = await holdPolicyService.updateActive(req.body || {}, req.user || {});
  res.status(httpStatus.OK).send({ data: updated });
});

// ---------------------------------------------------------------- listing packages + orders

const listListingPackages = catchAsync(async (req, res) => {
  const list = await packageService.listAll(req.query.status ? { status: req.query.status } : {});
  res.status(httpStatus.OK).send({ data: list });
});

const createListingPackage = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const created = await packageService.createPackage(req.body || {});
  await auditService.record({
    eventType: 'REALESTATE_LISTING_PACKAGE_CREATED',
    targetType: 'RealEstateListingPackage',
    targetId: created._id,
    actor: req.user.id,
    actorType: 'admin',
    metadata: { code: created.code },
    ip: req.ip,
  });
  res.status(httpStatus.CREATED).send({ data: created });
});

const updateListingPackage = catchAsync(async (req, res) => {
  const auditService = require('../services/realestate.audit.service');
  const before = await packageService.findByCode(req.params.code);
  const updated = await packageService.updatePackage(req.params.code, req.body || {});
  await auditService.record({
    eventType: 'REALESTATE_LISTING_PACKAGE_UPDATED',
    targetType: 'RealEstateListingPackage',
    targetId: updated._id,
    actor: req.user.id,
    actorType: 'admin',
    before: before ? { name: before.name, status: before.status } : null,
    after: { name: updated.name, status: updated.status },
    ip: req.ip,
  });
  res.status(httpStatus.OK).send({ data: updated });
});

const recommendListingPackage = catchAsync(async (req, res) => {
  await packageService.setRecommended(req.params.code);
  const updated = await packageService.findByCode(req.params.code);
  res.status(httpStatus.OK).send({ data: updated });
});

const listPackagePayments = catchAsync(async (req, res) => {
  const result = await orderService.listAll({
    status: req.query.status,
    page: parseInt(req.query.page, 10) || 1,
    limit: Math.min(parseInt(req.query.limit, 10) || 20, 100),
  });
  res.status(httpStatus.OK).send(result);
});

module.exports = {
  setPropertyStatus,
  listVerificationQueue,
  completeRefund,
  forfeitHold,
  createCommissionRule,
  updateCommissionRule,
  activateCommissionRule,
  retireCommissionRule,
  generateSettlement,
  setSettlementStatus,
  verifyDocument,
  viewLoan,
  getSettings,
  updateSettings,
  createBank,
  listBanks,
  updateBank,
  addBankMember,
  listBankMembers,
  setBankMemberStatus,
  createBankAgreement,
  updateBankAgreement,
  activateBankAgreement,
  expireBankAgreement,
  listCategories,
  upsertCategory,
  deleteCategory,
  listHoldPolicies,
  updateActiveHoldPolicy,
  createHoldPolicyVersion,
  createListingPackage,
  updateListingPackage,
  recommendListingPackage,
  submitHoldPolicy,
  approveHoldPolicy,
  activateHoldPolicy,
  updateHoldPolicyTaxSupply,
  listApprovalCases,
  approveApprovalCase,
  rejectApprovalCase,
  cancelApprovalCase,
  commentApprovalCase,
  latestReconciliation,
  listReconciliations,
  runReconciliation,
  listInvoices,
  getInvoice,
  cancelInvoice,
  exportGstr1,
  uploadCustodyStatement,
  listCustodyStatements,
  getCustodyStatement,
  matchCustodyStatement,
  listListingPackages,
  listPackagePayments,
};
