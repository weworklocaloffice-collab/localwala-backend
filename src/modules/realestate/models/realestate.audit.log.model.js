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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * RealEstateAuditLog — an append-only record of consequential actions.
 *
 * ## Why this exists (BR-20, F-2)
 *
 * BR-20: "An audit record exists for every state transition that moves money or changes a
 * permission-bearing fact."
 *
 * `RealEstateLeadActivity` covers part of that — but only for leads. It cannot record that a
 * vendor's entitlement was manually restored, that a package order was marked paid, or that
 * a listing was published, because those are not lead events. So the rule had no home for
 * most of what it describes, and nothing recorded it.
 *
 * ## Append-only, and not deletable by convention either
 *
 * BR-17 makes the *ledger* append-only; this inherits the same discipline. There is no
 * `updatedAt`, no status, and no delete path in the service. The only way a row changes is
 * if something writes directly to the collection, which `verify.realestate.audit.js` checks
 * for by inspecting the schema for update/enable hooks.
 *
 * ## `actor` is optional on purpose
 *
 * A system action — the expiry cron, the assignment engine — has no user behind it. Making
 * `actor` required would mean either refusing to log system events or inventing a user id
 * for them. `actorType: 'SYSTEM'` is the honest encoding, and `actor` stays empty.
 *
 * ## Why `amount` is not on this row
 *
 * It looks like it should be. But BR-02 keeps listing-package money and sale commission in
 * separate financial event types, and BR-15 requires the rule version and rate frozen at
 * resolution time. An audit row that carried an amount would become a fourth place where
 * money totals live, and a settlement could then be reconciled against it — which is
 * precisely what §1.1 forbids.
 *
 * So this records *that* something happened and *what changed*. The amounts live on the
 * order, the entitlement and the ledger entry that the action references by id.
 */
const realEstateAuditLogSchema = mongoose.Schema(
  {
    /**
     * What happened. A closed vocabulary, because an open one is not an audit trail — it is
     * a log that can be extended by whoever forgot to add an entry to the enum.
     */
    eventType: {
      type: String,
      required: true,
      enum: [
        // Money movement
        'LISTING_PACKAGE_ORDER_CREATED',
        'LISTING_PACKAGE_ORDER_PAID',
        'LISTING_PACKAGE_ORDER_CANCELLED',
        'LISTING_PACKAGE_REFUNDED',
        'ENTITLEMENT_GRANTED',
        'ENTITLEMENT_CONSUMED',
        'ENTITLEMENT_RESTORED',
        'HOLD_CREATED',
        'HOLD_RELEASED',
        'HOLD_REFUNDED',
        'SALE_COMPLETED',
        'COMMISSION_RECORDED',
        'SETTLEMENT_GENERATED',
        // Permission-bearing facts
        'VENDOR_REGISTERED',
        'VENDOR_APPROVED',
        'VENDOR_REJECTED',
        'VENDOR_SUSPENDED',
        'EXECUTIVE_ASSIGNED',
        'EXECUTIVE_REASSIGNED',
        // Listing moderation (STATUS_CHANGED / AVAILABILITY_CHANGED are
        // recorded by property.service — they were missing here, so
        // those rows failed validation silently; see service doc)
        'LISTING_SUBMITTED',
        'LISTING_APPROVED',
        'LISTING_REJECTED',
        'LISTING_PUBLISHED',
        'LISTING_ARCHIVED',
        'LISTING_SUSPENDED',
        'LISTING_STATUS_CHANGED',
        'LISTING_AVAILABILITY_CHANGED',
        // Bank / loan (BR-10 — bank-only transitions)
        'LOAN_SANCTIONED',
        'LOAN_REJECTED',
        'LOAN_DISBURSED',
        // Governance (OD-01/OD-04, Phase A–B). Closed additions, not an
        // open vocabulary: every writer above is enumerated here, and
        // the auditor script asserts no record() call site uses an
        // event outside this list.
        'REALESTATE_SETTINGS_UPDATED',
        'REALESTATE_HOLD_POLICY_VERSIONED',
        'REALESTATE_HOLD_POLICY_SUBMITTED',
        'REALESTATE_HOLD_POLICY_APPROVED',
        'REALESTATE_HOLD_POLICY_ACTIVATED',
        'REALESTATE_HOLD_POLICY_TAX_UPDATED',
        'REALESTATE_HOLD_POLICY_CUSTODY_UPDATED',
        'REALESTATE_APPROVAL_REQUESTED',
        'REALESTATE_APPROVAL_DECIDED',
        'REALESTATE_BANK_AGREEMENT_CREATED',
        'REALESTATE_BANK_AGREEMENT_UPDATED',
        'REALESTATE_BANK_AGREEMENT_ACTIVATED',
        'REALESTATE_BANK_UPDATED',
        'REALESTATE_BANK_MEMBER_STATUS',
        'REALESTATE_LISTING_PACKAGE_CREATED',
        'REALESTATE_LISTING_PACKAGE_UPDATED',
        'REALESTATE_COMMISSION_RULE_UPDATED',
        'REALESTATE_COMMISSION_RULE_RETIRED',
        'REALESTATE_SETTLEMENT_STATUS',
        'REALESTATE_RECONCILIATION',
        'REALESTATE_CUSTODY_STATEMENT_UPLOADED',
        'REALESTATE_CUSTODY_STATEMENT_MATCHED',
        'REALESTATE_INVOICE_ISSUED',
        'REALESTATE_INVOICE_CANCELLED',
      ],
    },

    /**
     * The document this concerns. Refs the model by name in a string field rather than as a
     * populated ref, because one audit row must be able to point at a property, an order, an
     * entitlement or a hold, and a single `ref` cannot do that.
     */
    targetType: {
      type: String,
      required: true,
      enum: [
        'Property',
        'ListingPackage',
        'ListingOrder',
        'ListingEntitlement',
        'Lead',
        'Visit',
        'Vendor',
        'Executive',
        'PropertyHold',
        'Sale',
        'Commission',
        'Settlement',
        'LoanApplication',
        // Governance targets (OD-01/OD-04, Phase A–B). Model names, so
        // the row points at the exact document version decided upon.
        'RealEstateSetting',
        'RealEstateHoldPolicy',
        'RealEstateApprovalCase',
        'RealEstateBankAgreement',
        'RealEstateBank',
        'RealEstateBankMember',
        'RealEstateListingPackage',
        'RealEstateCommissionRule',
        'RealEstateSettlement',
        'RealEstateReconciliation',
        'RealEstateCustodyStatement',
        'RealEstateInvoice',
      ],
    },

    targetId: {
      type: mongoose.SchemaTypes.ObjectId,
      required: true,
    },

    /**
     * Who did it. Empty for a system action — see the class doc.
     */
    actor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },

    actorType: {
      type: String,
      required: true,
      enum: ['CUSTOMER', 'VENDOR', 'EXECUTIVE', 'BANK', 'ADMIN', 'SYSTEM'],
    },

    /**
     * A free-text reason, where the action needs one. A rejection or suspension with no
     * reason is unanswerable in support.
     */
    reason: { type: String, required: false, trim: true },

    /**
     * Before and after values of the fields that changed.
     *
     * `before` / `after` rather than a single `diff`, so a reader can reconstruct the prior
     * state without re-deriving it, and so a missing field is distinguishable from a field
     * set to null.
     */
    before: { type: mongoose.Schema.Types.Mixed, required: false },
    after: { type: mongoose.Schema.Types.Mixed, required: false },

    /**
     * Anything else worth keeping: a payment reference, a consumed count, a referral code.
     */
    metadata: { type: mongoose.Schema.Types.Mixed, required: false },

    /**
     * Client IP and user agent, when the action came from a request.
     *
     * Recorded but not required, for the same reason `actor` is not: the expiry cron has
     * neither.
     */
    ip: { type: String, required: false },
    userAgent: { type: String, required: false },

    /**
     * Tamper-evident chain (Phase D). Each row commits to its
     * predecessor: `hash = sha256(canonical(core fields + prevHash))`.
     * The first row uses 'GENESIS'. Rewriting history breaks the link,
     * which `verifyChain` (audit service) detects; deleting rows shows
     * as a gap. Writers never set these — the service does.
     */
    prevHash: { type: String, required: false, default: 'GENESIS', trim: true },
    hash: { type: String, required: false, trim: true },
  },
  {
    // No `timestamps.updatedAt` on purpose — see the class doc on append-only.
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { getters: true },
    strict: true,
  }
);

realEstateAuditLogSchema.plugin(toJSON);
realEstateAuditLogSchema.plugin(paginate);

// ---- indexes ----

/**
 * "Show me everything that happened to this property", which is the question support asks.
 */
realEstateAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

/**
 * "Show me everything this user did", for a permission or misconduct question.
 */
realEstateAuditLogSchema.index({ actor: 1, createdAt: -1 });

/**
 * "What happened on this day, of this kind?" — the reconciliation and compliance query.
 *
 * Compound with `eventType` leading so a date range scan stays selective; without the leading
 * field a month-wide query would walk the whole collection.
 */
realEstateAuditLogSchema.index({ eventType: 1, createdAt: -1 });

/**
 * Every money movement, newest first, regardless of target. BR-17's append-only ledger
 * reconciles against this view, so it has to be cheap to read.
 */
realEstateAuditLogSchema.index({ createdAt: -1 });

/**
 * @typedef RealEstateAuditLog
 */
const RealEstateAuditLog = mongoose.model('RealEstateAuditLog', realEstateAuditLogSchema);

module.exports = RealEstateAuditLog;