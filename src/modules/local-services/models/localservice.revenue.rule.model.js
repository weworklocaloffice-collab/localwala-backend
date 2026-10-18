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
const {
  REVENUE_MODELS,
  CALCULATION_BASES,
  FEE_PAYERS,
  QUALIFYING_EVENTS,
  RULE_STATUSES,
} = require('../constants/revenue.modes');

/**
 * LocalServiceRevenueRule — versioned, never mutated once used.
 *
 * Every qualifying transaction freezes `toSnapshot()` — a rate change creates a
 * NEW row (old one retired/archived), never an edit, so history is restated
 * only via an explicit adjustment entry (BR: rule change never rewrites history).
 *
 * Mandatory toggles (§13.5): `bookingFeeEnabled` and `commissionEnabled` are
 * independent per scope. OFF forces ₹0 in NEW transactions. Engine enforces,
 * not just Admin UI.
 *
 * Scope precedence (deterministic): platform(0) < category(1) < subcategory(2)
 * < service(3) < provider(4). Empty scope keys = platform default.
 */
const localServiceRevenueRuleSchema = mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: false, trim: true },
    revenueModel: { type: String, required: true, enum: REVENUE_MODELS, default: 'COMBINED' },
    vertical: { type: String, required: true, default: 'local_services' },
    // Scope keys are STRINGS (not ObjectIds) on purpose: Admin adds categories
    // without backend changes. Empty/null = platform default level.
    categoryKey: { type: String, required: false, trim: true, lowercase: true, default: null },
    subcategoryKey: { type: String, required: false, trim: true, lowercase: true, default: null },
    serviceKey: { type: String, required: false, trim: true, lowercase: true, default: null },
    provider: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: false, default: null },
    payer: { type: String, required: true, enum: FEE_PAYERS, default: 'customer' },
    // --- Mandatory independent toggles ---
    bookingFeeEnabled: { type: Boolean, required: true, default: true },
    bookingFee: moneyField(60),
    commissionEnabled: { type: Boolean, required: true, default: true },
    commissionType: { type: String, required: false, enum: ['percentage', 'fixed'], default: 'percentage' },
    commissionRatePercent: { type: Number, required: false, min: 0, max: 100, default: 5 },
    commissionFixedAmount: moneyField(0),
    calculationBasis: { type: String, required: true, enum: CALCULATION_BASES, default: 'LABOUR_ONLY' },
    qualifyingEvent: { type: String, required: true, enum: QUALIFYING_EVENTS, default: 'COMPLETION_VERIFIED' },
    partsCommissionable: { type: Boolean, required: false, default: false },
    allowFeeAndCommissionStack: { type: Boolean, required: false, default: true },
    minimumCharge: moneyField(0),
    maximumCharge: moneyField(0),
    currency: { type: String, required: true, default: 'INR', uppercase: true, trim: true },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, required: false, default: undefined },
    refundReversalPolicy: {
      type: String,
      required: false,
      enum: ['full_reverse', 'prorated', 'no_reverse'],
      default: 'full_reverse',
    },
    stackingPolicy: { type: String, required: false, enum: ['exclusive', 'stackable'], default: 'exclusive' },
    taxTreatment: { type: String, required: false, trim: true },
    version: { type: Number, required: false, default: 1 },
    supersedes: { type: mongoose.SchemaTypes.ObjectId, ref: 'LocalServiceRevenueRule', required: false },
    status: { type: String, required: false, enum: RULE_STATUSES, default: 'draft' },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    updatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    approvedAt: { type: Date, required: false },
    approvalNote: { type: String, required: false, trim: true },
    activatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    activatedAt: { type: Date, required: false },
    suspendReason: { type: String, required: false, trim: true },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceRevenueRuleSchema.plugin(toJSON);
localServiceRevenueRuleSchema.plugin(paginate);

localServiceRevenueRuleSchema.index({ code: 1, version: 1 }, { unique: true });
localServiceRevenueRuleSchema.index({ status: 1, effectiveFrom: -1 });
localServiceRevenueRuleSchema.index({ vertical: 1, status: 1 });
localServiceRevenueRuleSchema.index({ categoryKey: 1, subcategoryKey: 1, serviceKey: 1, status: 1 });

/**
 * Specificity 0-4 for precedence resolution. Provider override is most specific.
 */
localServiceRevenueRuleSchema.methods.scopeSpecificity = function () {
  if (this.provider) return 4;
  if (this.serviceKey) return 3;
  if (this.subcategoryKey) return 2;
  if (this.categoryKey) return 1;
  return 0;
};

localServiceRevenueRuleSchema.methods.isInForceOn = function (date = new Date()) {
  const d = new Date(date);
  if (d < new Date(this.effectiveFrom)) return false;
  if (this.effectiveTo && d >= new Date(this.effectiveTo)) return false;
  return true;
};

/**
 * Frozen copy of exactly what the calculator reads — no _id, no timestamps.
 */
localServiceRevenueRuleSchema.methods.toSnapshot = function () {
  return {
    code: this.code,
    name: this.name,
    revenueModel: this.revenueModel,
    categoryKey: this.categoryKey || null,
    subcategoryKey: this.subcategoryKey || null,
    serviceKey: this.serviceKey || null,
    payer: this.payer,
    bookingFeeEnabled: this.bookingFeeEnabled,
    bookingFee: this.bookingFee,
    commissionEnabled: this.commissionEnabled,
    commissionType: this.commissionType,
    commissionRatePercent: this.commissionRatePercent,
    commissionFixedAmount: this.commissionFixedAmount,
    calculationBasis: this.calculationBasis,
    qualifyingEvent: this.qualifyingEvent,
    partsCommissionable: this.partsCommissionable,
    minimumCharge: this.minimumCharge,
    maximumCharge: this.maximumCharge,
    currency: this.currency,
    version: this.version,
    effectiveFrom: this.effectiveFrom,
    frozenAt: new Date(),
  };
};

/**
 * @typedef LocalServiceRevenueRule
 */
const LocalServiceRevenueRule = mongoose.model('LocalServiceRevenueRule', localServiceRevenueRuleSchema);

module.exports = LocalServiceRevenueRule;
