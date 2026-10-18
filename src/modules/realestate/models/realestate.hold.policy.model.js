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

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');
const moneyField = require('../../../utils/money.field');

/**
 * RealEstateHoldPolicy — versioned hold terms (plan §6.4).
 *
 * A future business change is a data edit, not a migration: the
 * version in force at hold creation is frozen onto the hold as
 * `policySnapshot` (BR-15). A hold created under the 15-day policy
 * keeps 15 days even if admin later sets 7.
 *
 * Defaults per plan: principal ₹50,000, fee 5%, 15 days, 72 h grace.
 * Policy defaults live in the DATABASE, not `.env` — admin must be
 * able to change fee and duration from the panel without a deploy.
 */
const realEstateHoldPolicySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },

    status: {
      type: String,
      required: true,
      default: 'DRAFT',
      // OD-01/OD-04 approval workflow: DRAFT -> PENDING_APPROVAL ->
      // APPROVED -> ACTIVE (live) -> RETIRED. Only ACTIVE backs new holds.
      enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED'],
    },

    // Shared approval controls (OD-01 §2 / OD-04 §2).
    // submittedBy tracks the requester for SoD (requester ≠ approver ≠
    // activator, enforced in the policy service).
    submittedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    submittedAt: { type: Date, required: false },
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    approvedAt: { type: Date, required: false },
    approvalReference: { type: String, required: false, trim: true },
    configurationVersion: { type: String, default: '1.0', trim: true },
    changeReason: { type: String, required: false, trim: true },
    updatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },

    principalAmount: moneyField(50000),

    /** Percent, e.g. 5.0 for 5%. */
    serviceFeePercent: {
      type: Number,
      required: true,
      default: 5.0,
      min: 0,
      max: 100,
    },

    serviceFeeMin: moneyField(500),
    serviceFeeMax: moneyField(0),

    durationDays: {
      type: Number,
      required: true,
      default: 15,
      min: 1,
    },

    /** Customer may extend before expiry. */
    gracePeriodHours: {
      type: Number,
      required: true,
      default: 72,
      min: 0,
    },

cancellationRefundable: { type: Boolean, default: true },
    expiryRefundable: { type: Boolean, default: true },
    feeRefundableOnListingWithdrawal: { type: Boolean, default: true },
    forfeitureRequiresDualControl: { type: Boolean, default: true },

    /** Who pays the cancellation deduction in a rental hold — OD-02. */
    cancellationFeeBorneBy: {
      type: String,
      required: true,
      default: 'CUSTOMER',
      enum: ['CUSTOMER', 'VENDOR'],
    },

    // ── OD-01: Hold Custody Configuration ──────────────────────
    // Only an APPROVED custody configuration may be ACTIVATEd for live
    // hold transactions. Do not present an unapproved PLATFORM_CURRENT
    // option as compliant by default (see hold.service createHold gate).
    custodyMode: {
      type: String,
      enum: ['ESCROW', 'CUSTODIAL', 'PLATFORM_CURRENT'],
      default: 'PLATFORM_CURRENT',
    },
    custodianBankReference: { type: String, required: false, trim: true },
    // Secure reference only — UI must mask, never log full details.
    accountIdentifier: { type: String, required: false, trim: true },
    principalReleaseConditions: { type: String, required: false, trim: true },
    refundSLA: { type: String, required: false, trim: true },
    reconciliationFrequency: { type: String, required: false, trim: true, default: 'weekly' },
    supportingDocuments: { type: [String], default: [] },
    custodyApprovalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    custodyEffectiveDate: { type: Date, required: false },
    custodyApprovedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    custodyApprovedAt: { type: Date, required: false },
    custodyApprovalReference: { type: String, required: false, trim: true },
    custodyConfigurationVersion: { type: String, default: '1.0', trim: true },
    custodyChangeReason: { type: String, required: false, trim: true },

    /** Nodal/escrow or platform account reference — OD-01 (legacy alias). */
    custodyAccount: {
      type: String,
      description: 'Nodal/escrow or platform account reference',
      default: null,
    },

    // ── OD-04: Tax & Invoice Configuration ──────────────────────
    // One sub-config per supply. Classification + rate stay INACTIVE
    // until a written determination is recorded and approved
    // (approvalStatus === 'approved'). Until then use default /
    // unconfigured treatment — never auto-apply a rate. The four
    // supplies must never be merged: LISTING_PACKAGE_PAYMENT,
    // PROPERTY_SALE_COMMISSION, PROPERTY_HOLD, PROPERTY_HOLD_SERVICE_FEE.
    taxConfiguration: {
      holdServiceFee: {
        hsnSac: { type: String, default: null, trim: true },
        taxClassification: { type: String, enum: ['service', 'deposit', 'refundableDeposit'], default: null },
        applicableRate: { type: Number, default: null },
        invoiceTreatment: { type: String, default: null },
        taxComponents: { type: String, default: null }, // e.g. 'CGST + SGST'
        inclusivePricing: { type: Boolean, default: false },
        effectiveFrom: { type: Date, default: Date.now },
        effectiveTo: { type: Date, default: null },
        approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
        approvedAt: { type: Date, default: null },
        approvalReference: { type: String, default: null, trim: true },
        configurationVersion: { type: String, default: '1.0', trim: true },
        changeReason: { type: String, default: null, trim: true },
      },
      propertySaleCommission: {
        hsnSac: { type: String, default: null, trim: true },
        taxClassification: { type: String, enum: ['service', 'commission'], default: null },
        applicableRate: { type: Number, default: null },
        invoiceTreatment: { type: String, default: null },
        taxComponents: { type: String, default: null },
        inclusivePricing: { type: Boolean, default: false },
        effectiveFrom: { type: Date, default: Date.now },
        effectiveTo: { type: Date, default: null },
        approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
        approvedAt: { type: Date, default: null },
        approvalReference: { type: String, default: null, trim: true },
        configurationVersion: { type: String, default: '1.0', trim: true },
        changeReason: { type: String, default: null, trim: true },
      },
      holdPrincipal: {
        hsnSac: { type: String, default: null, trim: true },
        taxClassification: { type: String, enum: ['deposit', 'consideration'], default: null },
        applicableRate: { type: Number, default: null },
        invoiceTreatment: { type: String, default: null },
        taxComponents: { type: String, default: null },
        inclusivePricing: { type: Boolean, default: false },
        effectiveFrom: { type: Date, default: Date.now },
        effectiveTo: { type: Date, default: null },
        approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
        approvedAt: { type: Date, default: null },
        approvalReference: { type: String, default: null, trim: true },
        configurationVersion: { type: String, default: '1.0', trim: true },
        changeReason: { type: String, default: null, trim: true },
      },
      listingPackageFee: {
        hsnSac: { type: String, default: null, trim: true },
        taxClassification: { type: String, enum: ['service', 'entitlement'], default: null },
        applicableRate: { type: Number, default: null },
        invoiceTreatment: { type: String, default: null },
        taxComponents: { type: String, default: null },
        inclusivePricing: { type: Boolean, default: false },
        effectiveFrom: { type: Date, default: Date.now },
        effectiveTo: { type: Date, default: null },
        approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', default: null },
        approvedAt: { type: Date, default: null },
        approvalReference: { type: String, default: null, trim: true },
        configurationVersion: { type: String, default: '1.0', trim: true },
        changeReason: { type: String, default: null, trim: true },
      },
    },

    effectiveFrom: {
      type: Date,
      required: true,
      default: Date.now,
    },

    effectiveTo: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateHoldPolicySchema.plugin(toJSON);
realEstateHoldPolicySchema.plugin(paginate);

realEstateHoldPolicySchema.index({ status: 1, effectiveFrom: -1 });
realEstateHoldPolicySchema.index({ version: 1 }, { unique: true });

/**
 * @typedef RealEstateHoldPolicy
 */
const RealEstateHoldPolicy = mongoose.model('RealEstateHoldPolicy', realEstateHoldPolicySchema);

module.exports = RealEstateHoldPolicy;
