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
 * JhatkaPriceOverride — a bounded, approved, temporary departure from the list price.
 *
 * ## Fresh-meat prices move daily, so overrides must exist
 *
 * A rigid list price cannot run a butcher shop: chicken moves 15% in a week, and a
 * supplier's price changes on a day the admin was not looking. So this model exists
 * rather than pretending otherwise.
 *
 * ## But an override is bounded and dual-controlled
 *
 * **±20% by default, and beyond that a second person must approve.** Not for
 * process's own sake: an operator who can set any price on any variant can quietly
 * run a loss-leading offer, sell the whole day's stock at it, and the report will
 * show revenue without showing the margin destroyed.
 *
 * `approvedBy ≠ createdBy` is enforced by `jhatka.catalog.service`, which is why
 * both are stored here rather than only `createdBy`.
 *
 * ## Every override is time-bounded
 *
 * `effectiveFrom`/`effectiveTo` are both required. An open-ended override becomes a
 * permanent price nobody remembers setting, and the next price review starts from
 * the wrong number. The expiry sweep retires them.
 *
 * ## Audit
 *
 * `reason` is mandatory. "Why is this 500 g pack ₹80 cheaper this week" needs an
 * answer months later.
 */
const OVERRIDE_STATUSES = ['draft', 'active', 'expired', 'revoked'];

const jhatkaPriceOverrideSchema = mongoose.Schema(
  {
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaVariant',
      required: true,
    },
    /** Optional: scope to one product rather than one variant. */
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProduct',
      required: false,
      default: undefined,
    },
    pricePerUnit: {
      ...moneyField(0),
      required: true,
    },
    /**
     * Must match the variant's basis. An override that changed the BASIS as well
     * as the number would silently reinterpret what the price means, so this is a
     * copy for display and an equality check, never an override in its own right.
     */
    priceBasis: {
      type: String,
      required: true,
      enum: ['per_kg', 'per_g', 'per_piece', 'per_dozen', 'per_pack', 'per_tier'],
    },
    /** Quantity band. Zero-to-min means "always". */
    minQuantity: { type: Number, required: false, min: 0, default: 0 },
    maxQuantity: { type: Number, required: false, min: 0, default: 0 },
    /** BOTH required — an open-ended override becomes a permanent price. */
    effectiveFrom: { type: Date, required: true },
    effectiveTo: {
      type: Date,
      required: true,
      validate: {
        validator: function (v) {
          return !this.effectiveFrom || v > this.effectiveFrom;
        },
        message: 'effectiveTo must be after effectiveFrom',
      },
    },
    /** Mandatory. See the header note. */
    reason: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v) => typeof v === 'string' && v.trim().length >= 10,
        message: 'reason must be at least 10 characters — "why is this price different" needs an answer',
      },
    },
    status: {
      type: String,
      required: false,
      enum: OVERRIDE_STATUSES,
      default: 'draft',
    },
    /**
     * The list price at the moment the override was created, so the variance is
     * readable later without reconstructing it from a price history that does not
     * exist.
     */
    listPriceAtCreation: moneyField(0),
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: false, trim: true },
    /** Required when the variance exceeds the ceiling. See the header note. */
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    approvedByName: { type: String, required: false, trim: true },
    approvedAt: { type: Date, required: false },
    revokedAt: { type: Date, required: false },
    revokedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    revokedByName: { type: String, required: false, trim: true },
    revokeReason: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaPriceOverrideSchema.plugin(toJSON);
jhatkaPriceOverrideSchema.plugin(paginate);
// The catalogue's active-override lookup.
jhatkaPriceOverrideSchema.index({ outlet: 1, variant: 1, status: 1, effectiveFrom: 1, effectiveTo: 1 });
// The expiry sweep.
jhatkaPriceOverrideSchema.index({ status: 1, effectiveTo: 1 });
// "Who approved this price, and why?" — the price audit.
jhatkaPriceOverrideSchema.index({ createdBy: 1, createdAt: -1 });
// Every override beyond the ceiling, for the margin-loss report.
jhatkaPriceOverrideSchema.index({ outlet: 1, approvedBy: 1, createdAt: -1 });

jhatkaPriceOverrideSchema.statics.STATUSES = OVERRIDE_STATUSES;
jhatkaPriceOverrideSchema.statics.MAX_VARIANCE_PCT = 20;

/**
 * Is this override in force at a given moment?
 *
 * `status` and the date range are separate checks because the expiry sweep
 * retires rows on a schedule, so a row can be `active` with a past `effectiveTo`
 * in between sweeps.
 */
jhatkaPriceOverrideSchema.methods.isInForce = function (now = new Date()) {
  if (this.status !== 'active') return false;
  const d = new Date(now);
  return d >= new Date(this.effectiveFrom) && d < new Date(this.effectiveTo);
};

/**
 * How far this departs from the list price, as a percentage. Signed.
 *
 * Returned so the caller can decide whether the ceiling applies, rather than
 * `isWithinVariance` deciding silently — the decision needs an approver, and a
 * boolean hides that.
 *
 * @returns {number} e.g. -12 for 12% below list
 */
jhatkaPriceOverrideSchema.methods.variancePct = function () {
  const list = Number(this.listPriceAtCreation) || 0;
  if (list <= 0) return 0;
  return Number((((Number(this.pricePerUnit) - list) / list) * 100).toFixed(2));
};

/**
 * Does this override need a second approver?
 *
 * Beyond ±20%, yes. This is the control that stops one operator setting any price
 * on any variant.
 */
jhatkaPriceOverrideSchema.methods.requiresSecondApproval = function (
  maxVariancePct = jhatkaPriceOverrideSchema.statics.MAX_VARIANCE_PCT
) {
  return Math.abs(this.variancePct()) > maxVariancePct;
};

/**
 * @typedef JhatkaPriceOverride
 */
const JhatkaPriceOverride = mongoose.model('JhatkaPriceOverride', jhatkaPriceOverrideSchema);

module.exports = JhatkaPriceOverride;