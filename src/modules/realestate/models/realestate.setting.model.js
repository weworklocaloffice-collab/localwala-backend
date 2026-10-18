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
const { toJSON } = require('../../../models/plugins');

/**
 * RealEstateSetting — the single vertical-wide configuration document.
 *
 * Lives in `bussiness-setup/real-estate-settings` in the panel, not in
 * `real-estate-management/` (plan §15.7): an operator looks for
 * settings alongside order/driver/restaurant settings. Versioned,
 * auditable business rules (hold terms, commission slabs, packages,
 * bank agreements) stay in the vertical — this holds only flags,
 * defaults and limits. Feature switches here, not in `.env`,
 * because toggling a customer-visible capability must be an audited
 * action, not a deploy.
 */
const APPROVAL_STATUS = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'RETIRED'];

const approvalFields = {
  status: { type: String, enum: APPROVAL_STATUS, default: 'DRAFT' },
  approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  approvedAt: { type: Date, required: false },
  effectiveFrom: { type: Date, required: false },
  effectiveTo: { type: Date, required: false },
  approvalReference: { type: String, required: false, trim: true },
  configurationVersion: { type: String, default: '1.0', trim: true },
  changeReason: { type: String, required: false, trim: true },
};

// OD-01: Hold & Custody configuration.
// Only an APPROVED + ACTIVE custody configuration may back live hold
// transactions (enforced in hold.service createHold). An unapproved
// PLATFORM_CURRENT option must never be presented as compliant by default.
const holdCustodySchema = new mongoose.Schema(
  {
    custodyMode: {
      type: String,
      enum: ['ESCROW', 'CUSTODIAL', 'PLATFORM_CURRENT'],
      default: 'PLATFORM_CURRENT',
    },
    custodianBankReference: { type: String, required: false, trim: true },
    // Secure reference only — UI must mask this value, never log it.
    accountIdentifier: { type: String, required: false, trim: true },
    principalReleaseConditions: { type: String, required: false, trim: true },
    refundSLA: { type: String, required: false, trim: true },
    reconciliationFrequency: { type: String, required: false, trim: true, default: 'weekly' },
    supportingDocuments: { type: [String], default: [] },
    ...approvalFields,
  },
  { _id: false }
);

const taxSupplySchema = new mongoose.Schema(
  {
    // Tax classification stays INACTIVE until a written determination is
    // recorded and approved (approvalStatus === 'approved'). Until then
    // services must use default/unconfigured treatment — never auto-apply
    // a rate (e.g. 18%) or classify without basis (OD-04).
    // hsnSac is structural (decided with the determination, not a rate).
    hsnSac: { type: String, required: false, trim: true },
    taxClassification: { type: String, required: false, trim: true },
    approvedRate: { type: Number, required: false, min: 0, max: 100 },
    invoiceTreatment: { type: String, required: false, trim: true },
    taxComponents: { type: String, required: false, trim: true },
    inclusivePricing: { type: Boolean, default: false },
    effectiveFrom: { type: Date, required: false },
    effectiveTo: { type: Date, required: false },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    approvedAt: { type: Date, required: false },
    approvalReference: { type: String, required: false, trim: true },
  },
  { _id: false }
);

// OD-04: Tax & Invoicing — one sub-config per supply. The four supplies
// must never be merged (BR-02/BR-15): LISTING_PACKAGE_PAYMENT,
// PROPERTY_SALE_COMMISSION, PROPERTY_HOLD, PROPERTY_HOLD_SERVICE_FEE.
//
// Phase C structure: organisation GSTIN, per-supply invoice series and
// default place-of-supply live here (admin-configured, approval-gated
// with the section). Per-supply HSN/SAC lives on each supply node;
// rates stay inactive until a written determination is approved.
const taxInvoicingSchema = new mongoose.Schema(
  {
    holdServiceFee: { type: taxSupplySchema, default: () => ({}) },
    propertySaleCommission: { type: taxSupplySchema, default: () => ({}) },
    holdPrincipal: { type: taxSupplySchema, default: () => ({}) },
    listingPackageFee: { type: taxSupplySchema, default: () => ({}) },
    orgGstin: { type: String, required: false, trim: true, uppercase: true },
    defaultPlaceOfSupply: { type: String, required: false, trim: true },
    invoiceSeries: {
      holdServiceFee: { type: String, default: 'RE-HOLD-FEE', trim: true },
      propertySaleCommission: { type: String, default: 'RE-SALE-COMM', trim: true },
      holdPrincipal: { type: String, default: 'RE-HOLD-PRIN', trim: true },
      listingPackageFee: { type: String, default: 'RE-PKG-FEE', trim: true },
    },
    ...approvalFields,
  },
  { _id: false }
);

const realEstateSettingSchema = mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    enquiryRequiresContactVerified: { type: Boolean, default: false },
    autoAssignVisitRequests: { type: Boolean, default: true },
    defaultCheckInRadiusMeters: { type: Number, default: 200, min: 1 },
    defaultHoldDurationDays: { type: Number, default: 15, min: 1 },
    searchMaxRadiusKm: { type: Number, default: 50, min: 1 },
    listingMaxImages: { type: Number, default: 20, min: 1 },
    listingMaxVideos: { type: Number, default: 3, min: 0 },
    documentMaxSizeBytes: { type: Number, default: 1048576, min: 1 },
    customerCanRequestLoan: { type: Boolean, default: true },
    customerCanHoldProperty: { type: Boolean, default: true },
    referralCommissionEnabled: { type: Boolean, default: false },
    promotionsEnabled: { type: Boolean, default: false },
    notificationsEnabled: { type: Boolean, default: true },
    // OD-01 + OD-04 structured configuration (plan §15.7 home).
    holdCustody: { type: holdCustodySchema, default: () => ({}) },
    taxInvoicing: { type: taxInvoicingSchema, default: () => ({}) },
    updatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateSettingSchema.plugin(toJSON);

/**
 * @typedef RealEstateSetting
 */
const RealEstateSetting = mongoose.model('RealEstateSetting', realEstateSettingSchema);

module.exports = RealEstateSetting;
