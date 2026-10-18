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
const { quantitySchema } = require('../utils/quantity');

// `moneyField` is deliberately NOT imported here. Every amount on this document is
// a RAW PAISE integer, and importing the helper would be an invitation to
// "fix" one of these fields into a rupees-typed money field — which would convert
// it on write and corrupt every stored value by 100x. The names all end `_Paise`
// so the intent is visible at the point of use, and `verify.jhatka.variableweight`
// asserts the absence of a setter.

/**
 * JhatkaWeightConfirmation — the audit record of one act of weighing.
 *
 * ## Why a separate document when the order line already holds the numbers
 *
 * Because `reconcileWeight` can run more than once. A manager overrides the hard
 * cap and re-weighs. A customer disputes and the outlet weighs again. A scale is
 * suspected and a second reading is taken.
 *
 * If the line held only the latest values, the earlier readings would be
 * destroyed and "was the 12% over-charge reported honestly the first time?"
 * would be unanswerable. One confirmation document per attempt, with
 * `supersededBy` chaining them, is what makes that answerable — and it is the same
 * reasoning behind `EntityBundle`/`GeoBoundary.supersededBy` in the geographic
 * kernel.
 *
 * ## The policy snapshot, frozen
 *
 * `policy` below is a copy of the outlet's and category's weight policy AS APPLIED.
 * An admin tightening `weightTolerancePct` from 5% to 2% next month must not
 * retroactively make a past confirmation look like it should have produced a
 * refund. Without this snapshot, tightening a policy silently rewrites history.
 *
 * ## The arithmetic, frozen
 *
 * `estimatedAmountPaise` / `finalAmountPaise` / `deltaPaise` are stored in PAISE
 * even though `moneyField` fields elsewhere on this document hold rupees. That is
 * deliberate and it is the one place in the vertical where a paise integer is
 * stored raw: this record is the input to a decision, is compared against a live
 * `reconcileWeight` call in the verify suite, and must never pass through a
 * rupees↔paise conversion that could round. `_Paise` in the field name is
 * deliberate so nobody "fixes" it to `moneyField`.
 */
const jhatkaWeightConfirmationSchema = mongoose.Schema(
  {
    confirmationNo: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: true,
    },
    orderItem: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrderItem',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    /** The preparation ticket this weighing was performed under. §8.6 */
    preparationTicket: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaPreparationTicket',
      required: false,
      default: undefined,
    },
    /** 1 for the first reading. Increments on re-weigh. */
    attempt: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    /**
     * Superseded by a later attempt on the same line. Null on the current
     * reading. This chain is what preserves the earlier values.
     */
    supersededBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaWeightConfirmation',
      required: false,
      default: undefined,
    },
    isCurrent: {
      type: Boolean,
      required: false,
      default: true,
    },

    requestedQuantity: {
      type: quantitySchema,
      required: true,
    },
    actualQuantity: {
      type: quantitySchema,
      required: true,
    },

    // ---- PAISE integers, deliberately raw. See the header note. ----
    estimatedAmountPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    finalAmountPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    /**
     * Signed. Positive = over-delivered. Stored signed for the same reason the
     * order item stores `deltaAmount` signed: the sign IS the decision.
     */
    deltaPaise: {
      type: Number,
      required: true,
    },
    refundablePaise: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    taxReversalPaise: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    netRefundPaise: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },

    // ---- the variance, as measured ----
    ratio: {
      type: Number,
      required: true,
    },
    variancePct: {
      type: Number,
      required: true,
    },
    varianceGrams: {
      type: Number,
      required: true,
    },
    /**
     * Which branch `reconcileWeight` took. This is the field that says WHY, and it
     * is constrained to the same four values the function returns.
     */
    direction: {
      type: String,
      required: true,
      enum: ['none', 'absorbed', 'refund_required', 'override_required'],
    },
    withinTolerance: {
      type: Boolean,
      required: true,
    },
    exceedsHardOvercharge: {
      type: Boolean,
      required: false,
      default: false,
    },
    breachesShortfallFloor: {
      type: Boolean,
      required: false,
      default: false,
    },
    /** The function's own explanation, stored so a dispute needs no re-derivation. */
    note: {
      type: String,
      required: false,
      trim: true,
    },

    // ---- the policy as applied. Frozen. See the header note. ----
    policy: {
      tolerancePct: { type: Number, required: true, min: 0 },
      hardOverchargePct: { type: Number, required: true, min: 0 },
      hardShortfallPct: { type: Number, required: true, min: 0 },
      source: {
        type: String,
        required: true,
        enum: ['category', 'outlet', 'category_then_outlet_tightened'],
      },
    },
    /** BR-20. The rate used for the tax reversal. Never re-resolved. */
    taxRatePctUsed: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    // ---- who and when ----
    weighedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    weighedByName: {
      type: String,
      required: true,
      trim: true,
    },
    weighedAt: {
      type: Date,
      required: true,
    },
    /**
     * BR-08. Present only when a manager overrode the hard cap.
     *
     * `weighedBy` and `override.by` being the same person is a segregation-of-
     * duties violation and is flagged by the variance report. §14.2 exists partly
     * to make this rare.
     */
    override: {
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      byName: { type: String, required: false, trim: true },
      reason: { type: String, required: false, trim: true },
      at: { type: Date, required: false },
      approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    },
    /**
     * §3.4. Required above the outlet's `requireWeightEvidencePhotoAbove`.
     */
    evidence: {
      photoUrl: { type: String, required: false },
      ticketNo: { type: String, required: false, trim: true },
      ticketPhotoUrl: { type: String, required: false },
      capturedAt: { type: Date, required: false },
      deviceId: { type: String, required: false, trim: true },
    },
    /**
     * Which batches this weighing consumed, and how much from each. Denormalised
     * so the weighing record is self-contained for a recall investigation.
     */
    batchAllocations: [
      {
        _id: false,
        batch: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaBatch',
          required: true,
        },
        qty: { type: Number, required: true },
        allocation: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaBatchAllocation',
          required: false,
        },
      },
    ],
    trimQty: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    /** BR-11. Actual vs expected yield, recorded at the moment of cutting. */
    yieldActualPct: {
      type: Number,
      required: false,
      min: 0,
      max: 100,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaWeightConfirmationSchema.plugin(toJSON);
jhatkaWeightConfirmationSchema.plugin(paginate);
jhatkaWeightConfirmationSchema.index({ confirmationNo: 1 }, { unique: true });
/**
 * ONE CURRENT CONFIRMATION PER ORDER LINE.
 *
 * Partial-unique on `{orderItem, attempt: -1}` where `isCurrent`. Superseded
 * attempts set `isCurrent: false`, so they drop out of the index entirely and only
 * the live reading occupies a slot.
 *
 * Without `unique: true` this is a plain index and two concurrent weigh requests
 * both write an `isCurrent: true` record — two "current" readings, one of which is
 * invisible to anyone reading the line. `attempt` is in the key so two genuinely
 * different attempts can coexist as history while only one holds the `isCurrent`
 * slot.
 */
jhatkaWeightConfirmationSchema.index(
  { orderItem: 1, attempt: -1 },
  {
    unique: true,
    partialFilterExpression: { isCurrent: true },
    name: 'one_current_confirmation_per_order_item',
  }
);
// The outlet variance report: which outlet consistently over- or under-weighs?
jhatkaWeightConfirmationSchema.index({ outlet: 1, variancePct: 1, weighedAt: -1 });
// Every override ever signed off, for audit.
jhatkaWeightConfirmationSchema.index({ 'override.by': 1, weighedAt: -1 });
// Over-delivery above the cap, which is the theft-shaped signal.
jhatkaWeightConfirmationSchema.index({ outlet: 1, direction: 1, weighedAt: -1 });
// Recall: which batches did this reading consume?
jhatkaWeightConfirmationSchema.index({ 'batchAllocations.batch': 1 });

/**
 * Did this reading result in money moving?
 *
 * `refund_required` is the only direction that produces a refund document. This is
 * the check VW-02 turns into an assertion: a confirmation with
 * `direction: 'none'` MUST NOT have a refund, and one with
 * `direction: 'refund_required'` MUST.
 */
jhatkaWeightConfirmationSchema.methods.producesRefund = function () {
  return this.direction === 'refund_required' && Number(this.refundablePaise || 0) > 0;
};

/**
 * Did a manager override the hard cap on this reading?
 */
jhatkaWeightConfirmationSchema.methods.wasOverridden = function () {
  return this.direction === 'override_required' && !!this.override && !!this.override.reason;
};

/**
 * @typedef JhatkaWeightConfirmation
 */
const JhatkaWeightConfirmation = mongoose.model(
  'JhatkaWeightConfirmation',
  jhatkaWeightConfirmationSchema
);

module.exports = JhatkaWeightConfirmation;