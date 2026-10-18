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
const { franchiseActivationBlockers } = require('../utils/commercial.arithmetic');

/**
 * JhatkaFranchise — a territory and an operating business granted to a franchisee.
 *
 * ## Modelled on `DairyFranchise`, but with ENUMS
 *
 * Dairy's franchise model declares `status` as a trailing comment
 * (`// pending|active|suspended|expired|terminated`) rather than an `enum`, so
 * nothing stops a typo from becoming an unmatchable status. That looseness is not
 * inherited here: every enumerated field below is a real `enum`.
 *
 * ## BR-03: there is no franchise app
 *
 * A franchisee is an operator of a Jhatka outlet. They use the regular Partner
 * app. This document is admin-created and admin-approved; a franchisee never
 * self-registers into one.
 *
 * ## `supplyModel: 'local_procurement'` exists but is UNREACHABLE
 *
 * BR-05 makes LocalWala the supplier to every operator. `local_procurement` and
 * `mixed` are declared because the agreement is versioned and a future agreement
 * may permit them — but the *code path* is gated by
 * `Vertical.settings.enabledFeatures.selfProcurement`, which ships `false`.
 *
 * Declaring an enum value that cannot be used is a deliberate choice, not an
 * oversight: a franchise agreement negotiated today may be signed in two years,
 * and retro-fitting a new value into a closed enum later means a deploy during a
 * commercial negotiation.
 *
 * ## `status` is `pending` until three separate things are true
 *
 * Agreement dated, compliance documents valid, joining fee paid. All three.
 * `canActivate()` returns the same shape as
 * `commercial.arithmetic.franchiseActivationBlockers`, and the service calls both.
 */
const FRANCHISE_STATUSES = ['pending', 'active', 'suspended', 'expired', 'terminated'];

const jhatkaFranchiseSchema = mongoose.Schema(
  {
    franchiseCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    /** The partner entity. Kernel `Business` with `vertical: 'jhatka'`. */
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /** The human who runs it. */
    operator: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    operatorName: { type: String, required: false, trim: true },
    /** The outlet this franchise operates. One franchise, one outlet. */
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * Territory. Mirrors `Business.territory` field-for-field so a reader of either
     * means the same thing.
     */
    territory: {
      city: { type: mongoose.SchemaTypes.ObjectId, ref: 'City', required: false },
      localities: [
        {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'Locality',
          required: false,
        },
      ],
      polygon: {
        type: {
          type: String,
          enum: ['Polygon'],
          default: undefined,
        },
        coordinates: {
          type: [[[Number]]],
          required: false,
        },
      },
    },
    /**
     * §10.4. Percentage as a NUMBER (8 = 8%). Read by a human at a negotiation.
     */
    revenueSharePercentage: {
      type: Number,
      required: false,
      min: 0,
      max: 100,
      default: 0,
    },
    revenueShareBasis: {
      type: String,
      required: false,
      enum: ['product_only', 'product_and_delivery'],
      default: 'product_only',
    },
    /** §6. Must be paid before activation. JH-03. */
    joiningFee: moneyField(0),
    joiningFeePaid: {
      type: Boolean,
      required: false,
      default: false,
    },
    joiningFeePaidAt: { type: Date, required: false },
    joiningFeePaymentRef: { type: String, required: false, trim: true },
    /**
     * Royalty is FLAT, not a percentage of anything. The `frequency` is about how
     * often it is charged, not how it is computed — a franchise agreement's royalty
     * is a fixed monthly fee, and treating it as a rate would be a different
     * commercial product.
     */
    royalty: {
      ratePercent: { type: Number, required: false, min: 0, default: 0 },
      frequency: {
        type: String,
        required: false,
        enum: ['monthly', 'quarterly', 'annual'],
        default: 'monthly',
      },
    },
    agreement: {
      startDate: {
        type: Date,
        // Required — a franchise with no dated agreement has no enforceable
        // territory and no agreed commercial terms.
        required: true,
      },
      endDate: { type: Date, required: false },
      documentUrl: { type: String, required: false },
      notes: { type: String, required: false, trim: true },
      signedAt: { type: Date, required: false },
      signedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      signedByName: { type: String, required: false, trim: true },
    },
    /**
     * BR-05 says LocalWala supplies. `local_procurement` and `mixed` are declared
     * for a future agreement but gated off by `selfProcurement: false` in
     * `Vertical.settings.enabledFeatures`.
     */
    supplyModel: {
      type: String,
      required: false,
      enum: ['platform_supplied', 'local_procurement', 'mixed'],
      default: 'platform_supplied',
    },
    /**
     * Hides the procurement screens when the operator cannot procure. Copied from
     * `DairyFranchise.procurementEnabled`.
     */
    procurementEnabled: {
      type: Boolean,
      required: false,
      default: false,
    },
    minimumMonthlyOrderValue: moneyField(0),
    /** SKUs the franchisee is committed to stock. */
    minimumSkuCommitment: {
      type: [String],
      required: false,
      default: [],
    },
    /** §6. Penalties are versioned terms, not ad-hoc deductions. */
    penaltySchedule: [
      {
        _id: false,
        trigger: { type: String, required: true, trim: true },
        amount: moneyField(0),
        graceDays: { type: Number, required: false, min: 0, default: 0 },
        note: { type: String, required: false, trim: true },
      },
    ],
    /** §6. Gated before activation. */
    complianceRequired: {
      type: [String],
      required: false,
      default: ['fssai', 'gst_registration'],
      validate: {
        validator: (v) =>
          Array.isArray(v) &&
          v.every((d) => ['fssai', 'gst_registration', 'trade_licence', 'premises_lease'].includes(d)),
        message: 'complianceRequired must be drawn from the four known document types',
      },
    },
    status: {
      type: String,
      required: false,
      enum: FRANCHISE_STATUSES,
      default: 'pending',
    },
    statusReason: { type: String, required: false, trim: true },
    activatedAt: { type: Date, required: false },
    terminatedAt: { type: Date, required: false },
    terminatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaFranchiseSchema.plugin(toJSON);
jhatkaFranchiseSchema.plugin(paginate);
jhatkaFranchiseSchema.index({ franchiseCode: 1 }, { unique: true });
// One franchise per outlet. Two agreements over one counter is unresolvable.
jhatkaFranchiseSchema.index({ outlet: 1 }, { unique: true });
// "Which franchises does this operator hold?" — the operator's own dashboard.
jhatkaFranchiseSchema.index({ operator: 1, status: 1 });
// The expiry sweep for agreements.
jhatkaFranchiseSchema.index({ 'agreement.endDate': 1, status: 1 });
// Territory overlap checks during approval.
jhatkaFranchiseSchema.index({ 'territory.localities': 1, status: 1 });

jhatkaFranchiseSchema.statics.STATUSES = FRANCHISE_STATUSES;

/**
 * Can this franchise go live? JH-03.
 *
 * THREE things, all required: a dated agreement, every `complianceRequired`
 * document valid, and the joining fee paid. Not "any one of" — a franchise trading
 * without an agreement is a franchise with no enforceable territory, and one
 * trading on a lapsed FSSAI is a food-safety exposure on the LocalWala name.
 *
 * Delegates to `commercial.arithmetic.franchiseActivationBlockers` so the service
 * and the model cannot disagree about what "ready" means.
 *
 * @param {Array<{type: string, status: string}>} complianceDocuments
 * @param {Date} [now]
 * @returns {{ ok: boolean, blockers: string[] }}
 */
jhatkaFranchiseSchema.methods.canActivate = function (complianceDocuments = [], now = new Date()) {
  return franchiseActivationBlockers({
    agreementStartDate: this.agreement?.startDate,
    agreementEndDate: this.agreement?.endDate,
    now,
    complianceDocuments,
    requiredDocuments: this.complianceRequired || [],
    joiningFeePaid: this.joiningFeePaid === true,
    status: this.status,
  });
};

/**
 * Is this agreement still in force?
 *
 * A franchise past `endDate` is `expired` by the sweep, not by this method — this
 * answers "right now, is the term live" for a read path.
 */
jhatkaFranchiseSchema.methods.isInTerm = function (now = new Date()) {
  const d = new Date(now);
  if (d < new Date(this.agreement.startDate)) return false;
  if (this.agreement.endDate && d >= new Date(this.agreement.endDate)) return false;
  return true;
};

/**
 * May this operator procure their own raw material?
 *
 * Always false under BR-05. It exists as a method rather than a hard-coded `false`
 * so the single place that would have to change when the MoR decision reverses is
 * one readable line, and so a caller is forced to ask rather than assume.
 */
jhatkaFranchiseSchema.methods.canProcure = function (selfProcurementFeatureEnabled = false) {
  if (!selfProcurementFeatureEnabled) return false;
  return this.supplyModel !== 'platform_supplied' && this.procurementEnabled === true;
};

/**
 * @typedef JhatkaFranchise
 */
const JhatkaFranchise = mongoose.model('JhatkaFranchise', jhatkaFranchiseSchema);

module.exports = JhatkaFranchise;