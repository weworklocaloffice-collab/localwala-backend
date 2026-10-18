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
 * Unauthorized copying, redistribution, resale, public republication,
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const express = require('express');
const webAuth = require('../../../middlewares/webAuth');
const validate = require('../../../middlewares/validate');
const controller = require('../controllers/realestate.vendor.controller');
const adminController = require('../controllers/realestate.admin.controller');
const executiveAdminController = require('../controllers/realestate.executive.admin.controller');
const listController = require('../controllers/realestate.admin.list.controller');
const V = require('../validations/realestate.admin.validation');

const router = express.Router();

/**
 * Admin-area Real Estate routes. Mounted at `/v1/realestate/admin`.
 *
 * ## Every route here carries an explicit rights string
 *
 * This is not ceremony. Doc §0A.3 DEFECT-2 records that `auth.factory.js` rejects an
 * unannotated route *by accident*:
 *
 *     if (!hasRequiredRights && req.params.userId !== user.id) { ...reject... }
 *
 * With no `userId` in the path the second clause is `undefined !== user.id`, which is
 * true, so the guard happens to fire. That is luck, not design. Change the param name —
 * `:id`, `:vendorId`, `:key` — and the clause inverts, and a route with no rights string
 * admits every authenticated caller including a customer. So: no route in this file is
 * ever mounted without one, and `verify.realestate.roles.js` fails the build if that slips.
 *
 * ## These were moved out of `realestate.vendor.route.js`
 *
 * Three `/admin/vendor/*` routes lived on the vendor file with no rights string. Mounting
 * admin powers on the file a vendor authenticates against is the wrong shape even when
 * the check happens to work.
 */

/** Admin may act on vendors. */
const MANAGE_VENDORS = 'realestate.admin_manage_vendors';

/**
 * Read-only audit access (Phase A). Every GET below admits this as an
 * alternative right (factory OR semantics), so the `auditor` role reads
 * everything. Writes stay single-right — no write path admits it.
 */
const AUDIT_VIEW = 'realestate.audit_view';

/** Admin may verify vendor KYC documents. */
const MANAGE_VERIFICATIONS = 'realestate.admin_manage_verifications';

router.get('/vendors/active', webAuth(MANAGE_VENDORS, AUDIT_VIEW), controller.listActive);
// Verification queue (plan §10.2 row 8). Declared before any
// `/vendors/:vendorId` pattern so the literal is never captured as an id.
router.get('/vendors/verification-queue', webAuth(MANAGE_VERIFICATIONS, AUDIT_VIEW), controller.listVerificationQueue);
router.get('/vendors/:vendorId/documents', webAuth(MANAGE_VERIFICATIONS, AUDIT_VIEW), controller.listVendorDocuments);
router.post('/vendors/:vendorId/approve', webAuth(MANAGE_VENDORS), controller.approve);
router.post('/vendors/:vendorId/reject', webAuth(MANAGE_VENDORS), controller.reject);
router.post('/vendors/:vendorId/suspend', webAuth(MANAGE_VENDORS), controller.suspend);
router.put(
  '/vendors/:vendorId/documents/:category/verify',
  webAuth(MANAGE_VERIFICATIONS),
  controller.verifyDocument
);
// PATCH alias — Admin_panel ApiService exposes get/post/patch/delete only.
router.patch(
  '/vendors/:vendorId/documents/:category/verify',
  webAuth(MANAGE_VERIFICATIONS),
  controller.verifyDocument
);

// Property moderation (BR-03). Target state is a route parameter,
// allow-listed in Joi AND the service table.
router.patch(
  '/properties/:id/status/:status',
  webAuth('realestate.admin_property_verify'),
  validate(V.setPropertyStatus),
  adminController.setPropertyStatus
);

// Hold refunds + dual-control forfeiture (plan §6.2, §6.5).
router.post('/refunds/:id/complete', webAuth('realestate.admin_hold_refund_manage'), adminController.completeRefund);
router.post('/holds/:id/forfeit', webAuth('realestate.admin_hold_refund_manage'), validate(V.forfeitHold), adminController.forfeitHold);

// Commission rules + settlements (Phase 7). BR-15 snapshots, BR-17 entryIds[].
// Rates are versioned: DRAFT rows editable, ACTIVE immutable (new version
// instead), retire closes the window. History is never restated.
router.post('/commission-rules', webAuth('realestate.admin_commission_rule_manage'), validate(V.createCommissionRule), adminController.createCommissionRule);
router.patch(
  '/commission-rules/:id',
  webAuth('realestate.admin_commission_rule_manage'),
  validate(V.updateCommissionRule),
  adminController.updateCommissionRule
);
router.post('/commission-rules/:id/activate', webAuth('realestate.admin_commission_rule_manage'), adminController.activateCommissionRule);
router.post(
  '/commission-rules/:id/retire',
  webAuth('realestate.admin_commission_rule_manage'),
  validate(V.retireCommissionRule),
  adminController.retireCommissionRule
);
router.post('/settlements/generate', webAuth('realestate.admin_settlement_manage'), validate(V.generateSettlement), adminController.generateSettlement);
router.post(
  '/settlements/:id/status/:status',
  webAuth('realestate.admin_settlement_manage'),
  validate(V.setSettlementStatus),
  adminController.setSettlementStatus
);

// Documents (BR-18) + loan view (read-only; BR-10 lives in bank route).
router.post('/documents/:id/verify', webAuth('realestate.admin_document_verify'), validate(V.verifyDocument), adminController.verifyDocument);
router.get('/loans/:id', webAuth('realestate.admin_loan_view', AUDIT_VIEW), adminController.viewLoan);

// Read-only paginated lists for the real-estate-management panel.
// Writes live on the routes above, never here.
router.get('/properties', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), listController.listProperties);
// Verification queue (plan §10.2 row 3). One paginated endpoint for
// every property in a state that needs admin action; the row's
// set-status route does the actual transition.
router.get('/properties/verification-queue', webAuth('realestate.admin_property_verify', AUDIT_VIEW), adminController.listVerificationQueue);
router.get('/holds', webAuth('realestate.admin_hold_refund_manage', AUDIT_VIEW), listController.listHolds);
router.get('/hold-payments', webAuth('realestate.admin_hold_refund_manage', AUDIT_VIEW), listController.listHoldPayments);
router.get('/refunds', webAuth('realestate.admin_hold_refund_manage', AUDIT_VIEW), listController.listRefunds);
router.get('/commissions', webAuth('realestate.admin_settlement_manage', AUDIT_VIEW), listController.listCommissions);
router.get('/sales', webAuth('realestate.admin_settlement_manage', AUDIT_VIEW), listController.listSales);
router.get('/commission-rules', webAuth('realestate.admin_commission_rule_manage', AUDIT_VIEW), listController.listCommissionRules);
router.get('/settlements', webAuth('realestate.admin_settlement_manage', AUDIT_VIEW), listController.listSettlements);
router.get('/ledger', webAuth('realestate.admin_settlement_manage', AUDIT_VIEW), listController.listLedger);
router.get('/loans', webAuth('realestate.admin_loan_view', AUDIT_VIEW), listController.listLoans);
router.get('/leads', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), listController.listLeads);
router.get('/referrals', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), listController.listReferrals);
router.get('/bank-offers', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), listController.listBankOffers);
router.get('/bank-agreements', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), listController.listBankAgreements);
router.get('/visits', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), listController.listVisits);
router.get('/vendors', webAuth('realestate.admin_manage_vendors', AUDIT_VIEW), listController.listVendors);
router.get('/documents', webAuth('realestate.admin_document_verify', AUDIT_VIEW), listController.listDocuments);
router.get('/audit-logs', webAuth('realestate.admin_settlement_manage', AUDIT_VIEW), listController.listAuditLogs);
router.get('/promotions', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), listController.listPromotions);

// Vertical-wide configuration (plan §15.7). Single document, partial update.
// OD-01 (Hold & Custody) + OD-04 (Tax & Invoicing) live here as nested
// sections with their own approval controls. Editing here only affects
// NEW transactions — history is frozen in snapshots (BR-15).
router.get('/settings', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), adminController.getSettings);
router.patch(
  '/settings',
  webAuth('realestate.admin_manage_listings'),
  validate(V.settingsPatch),
  adminController.updateSettings
);

// Hold policy editor (plan §10.2 row 20). The version timeline — a
// PATCH updates the latest ACTIVE row; a POST retires it and the next
// hold creation reads the new one.
//
// Role separation (OD-01 §2 / OD-04 §2):
// - Operator (manage): draft/edit.
// - Finance/legal approver (approve): submit -> approve within authority.
// - Authorized administrator (activate): activate an APPROVED version.
// - Auditor (read): list/get only.
router.get('/hold-policy', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), adminController.listHoldPolicies);
router.patch('/hold-policy/active', webAuth('realestate.admin_hold_policy_manage'), validate(V.holdPolicyPatch), adminController.updateActiveHoldPolicy);
router.post(
  '/hold-policy/versions',
  webAuth('realestate.admin_hold_policy_manage'),
  validate(V.holdPolicyNewVersion),
  adminController.createHoldPolicyVersion
);
router.post(
  '/hold-policy/submit',
  webAuth('realestate.admin_hold_policy_manage'),
  validate(V.holdPolicySubmit),
  adminController.submitHoldPolicy
);
router.post(
  '/hold-policy/:id/approve',
  webAuth('realestate.admin_hold_policy_approve'),
  validate(V.holdPolicyApprove),
  adminController.approveHoldPolicy
);
router.post(
  '/hold-policy/:id/activate',
  webAuth('realestate.admin_hold_policy_activate'),
  validate(V.holdPolicyIdParam),
  adminController.activateHoldPolicy
);
router.patch(
  '/hold-policy/:id/tax/:supply',
  webAuth('realestate.admin_hold_policy_manage'),
  validate(V.taxSupplyPatch),
  adminController.updateHoldPolicyTaxSupply
);

// Approval cases (Phase A governance). List is visible to operators
// and approvers; decide paths carry the approve right; cancel/comment
// follow the service rules (requester-only cancel, open commenting).
router.get(
  '/approval-cases',
  webAuth('realestate.admin_manage_listings', AUDIT_VIEW),
  validate(V.approvalCaseListQuery),
  adminController.listApprovalCases
);
router.post(
  '/approval-cases/:id/approve',
  webAuth('realestate.admin_hold_policy_approve'),
  validate(V.approvalCaseDecide),
  adminController.approveApprovalCase
);
router.post(
  '/approval-cases/:id/reject',
  webAuth('realestate.admin_hold_policy_approve'),
  validate(V.approvalCaseReject),
  adminController.rejectApprovalCase
);
router.post(
  '/approval-cases/:id/cancel',
  webAuth('realestate.admin_hold_policy_manage'),
  validate(V.approvalCaseIdParam),
  adminController.cancelApprovalCase
);
router.post(
  '/approval-cases/:id/comments',
  webAuth('realestate.admin_manage_listings'),
  validate(V.approvalCaseComment),
  adminController.commentApprovalCase
);

// Reconciliation (Phase B). Nightly three-way money match plus manual
// runs; reports admit the auditor, the manual run stays finance-gated.
router.get('/reconciliation/latest', webAuth('realestate.admin_settlement_manage', AUDIT_VIEW), adminController.latestReconciliation);
router.get('/reconciliation', webAuth('realestate.admin_settlement_manage', AUDIT_VIEW), adminController.listReconciliations);
router.post('/reconciliation/run', webAuth('realestate.admin_settlement_manage'), adminController.runReconciliation);

// Invoices + GSTR-1 (Phase C). Reads admit the auditor; cancellation
// stays finance-gated with a mandatory reason. Issue paths live in
// the money services, never here.
router.get(
  '/invoices',
  webAuth('realestate.admin_settlement_manage', AUDIT_VIEW),
  validate(V.invoiceListQuery),
  adminController.listInvoices
);
router.get(
  '/invoices/gstr1',
  webAuth('realestate.admin_settlement_manage', AUDIT_VIEW),
  validate(V.gstr1Query),
  adminController.exportGstr1
);
router.get(
  '/invoices/:id',
  webAuth('realestate.admin_settlement_manage', AUDIT_VIEW),
  validate(V.invoiceIdParam),
  adminController.getInvoice
);
router.post(
  '/invoices/:id/cancel',
  webAuth('realestate.admin_settlement_manage'),
  validate(V.invoiceCancel),
  adminController.cancelInvoice
);

// Custody statements (Phase B external leg). Upload/match stay
// finance-gated; list/detail admit the auditor.
router.post(
  '/custody-statements/upload',
  webAuth('realestate.admin_settlement_manage'),
  validate(V.custodyStatementUpload),
  adminController.uploadCustodyStatement
);
router.get(
  '/custody-statements',
  webAuth('realestate.admin_settlement_manage', AUDIT_VIEW),
  adminController.listCustodyStatements
);
router.get(
  '/custody-statements/:id',
  webAuth('realestate.admin_settlement_manage', AUDIT_VIEW),
  validate(V.custodyStatementIdParam),
  adminController.getCustodyStatement
);
router.post(
  '/custody-statements/:id/match',
  webAuth('realestate.admin_settlement_manage'),
  validate(V.custodyStatementIdParam),
  adminController.matchCustodyStatement
);

// Banks + officers. Admin creates the bank and links a role-'bank'
// user as an officer; without this the /auth/bank/login member check
// would fail for every bank user.
router.get('/banks', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), adminController.listBanks);
router.post('/banks', webAuth('realestate.admin_manage_listings'), adminController.createBank);
router.patch(
  '/banks/:id',
  webAuth('realestate.admin_manage_listings'),
  validate(V.bankUpdate),
  adminController.updateBank
);
router.post('/banks/:id/members', webAuth('realestate.admin_manage_listings'), adminController.addBankMember);
router.get(
  '/banks/:id/members',
  webAuth('realestate.admin_manage_listings', AUDIT_VIEW),
  validate(V.bankIdParam),
  adminController.listBankMembers
);
router.patch(
  '/banks/:id/members/:memberId',
  webAuth('realestate.admin_manage_listings'),
  validate(V.bankMemberStatus),
  adminController.setBankMemberStatus
);

// Bank agreements (plan §10.2 row 19, §5.10). Versioned terms: create a
// DRAFT version, edit it while draft, activate (retires competing
// ACTIVE rows for the bank), expire. ACTIVE rows are never edited.
router.post(
  '/bank-agreements',
  webAuth('realestate.admin_manage_listings'),
  validate(V.bankAgreementCreate),
  adminController.createBankAgreement
);
router.patch(
  '/bank-agreements/:id',
  webAuth('realestate.admin_manage_listings'),
  validate(V.bankAgreementUpdate),
  adminController.updateBankAgreement
);
router.post(
  '/bank-agreements/:id/activate',
  webAuth('realestate.admin_manage_listings'),
  validate(V.bankAgreementIdParam),
  adminController.activateBankAgreement
);
router.post(
  '/bank-agreements/:id/expire',
  webAuth('realestate.admin_manage_listings'),
  validate(V.bankAgreementIdParam),
  adminController.expireBankAgreement
);

// Category catalog (plan §10.2 row 5). The descriptor lives on the
// category; a `specSchema` edit invalidates the runtime validator
// cache automatically (keyed on `(_id, updatedAt)`).
router.get('/categories', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), validate(V.categoryListQuery), adminController.listCategories);
router.post('/categories', webAuth('realestate.admin_manage_listings'), validate(V.categoryUpsert), adminController.upsertCategory);
router.patch('/categories/:id', webAuth('realestate.admin_manage_listings'), validate(V.categoryIdParam), validate(V.categoryUpsert), adminController.upsertCategory);
router.delete('/categories/:id', webAuth('realestate.admin_manage_listings'), validate(V.categoryIdParam), adminController.deleteCategory);

// Listing packages + payments (plan §10.2 rows 9, 10). The catalogue is
// seeded, and orders flow through the vendor purchase + payment stack —
// but the admin owns the catalogue: create, edit-in-place (code + price
// immutable, BR-15) and highlight one package. Payments stay read-only.
router.get('/listing-packages', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), adminController.listListingPackages);
router.post(
  '/listing-packages',
  webAuth('realestate.admin_manage_listings'),
  validate(V.packageCreate),
  adminController.createListingPackage
);
router.patch(
  '/listing-packages/:code',
  webAuth('realestate.admin_manage_listings'),
  validate(V.packageUpdate),
  adminController.updateListingPackage
);
router.post(
  '/listing-packages/:code/recommend',
  webAuth('realestate.admin_manage_listings'),
  validate(V.packageCodeParam),
  adminController.recommendListingPackage
);
router.get('/package-payments', webAuth('realestate.admin_manage_listings', AUDIT_VIEW), adminController.listPackagePayments);

// Executive management (plan §10.2 rows 14, 15). The admin sees the
// pool, can flip `available` to put an exec on the bench, and can
// mark an exec SUSPENDED/TERMINATED with a reason.
router.get('/executives', webAuth('realestate.admin_executive_manage', AUDIT_VIEW), executiveAdminController.listExecutives);
router.patch('/executives/:id/availability', webAuth('realestate.admin_executive_manage'), executiveAdminController.updateExecutiveAvailability);
router.patch('/executives/:id/status', webAuth('realestate.admin_executive_manage'), executiveAdminController.updateExecutiveStatus);
// Executive assignment queue (plan §10.2 row 15, §10.3). PENDING_ASSIGNMENT
// backlog + auto-assign preview + manual override. Every route carries an
// explicit rights string (DEFECT-2 guard).
router.get(
  '/visit-requests',
  webAuth('realestate.admin_executive_manage', AUDIT_VIEW),
  validate(V.visitRequestListQuery),
  executiveAdminController.listVisitRequests
);
router.get(
  '/visit-requests/:id/preview',
  webAuth('realestate.admin_executive_manage', AUDIT_VIEW),
  validate(V.visitRequestIdParam),
  executiveAdminController.previewAssignment
);
router.post(
  '/visit-requests/:id/assign',
  webAuth('realestate.admin_executive_manage'),
  validate(V.assignVisitRequest),
  executiveAdminController.assignVisitRequestOverride
);

module.exports = router;