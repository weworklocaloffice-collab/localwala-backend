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

/**
 * JhatkaQualityRejectionReason — the controlled vocabulary for rejecting meat.
 *
 * ## Why this is seeded data and not free text
 *
 * Three reasons, in increasing order of how much they cost to get wrong.
 *
 * First, reporting. §47 promises rejection-rate analytics. With free text,
 * "spoiled", "bad smell", "off" and "smelly" are four different categories and the
 * report says each of them happened twice.
 *
 * Second, the auto-reject decision. §5.3 Rule B — a hard fail auto-rejects, a
 * borderline reading goes to a human — needs `autoReject: true` on the reason. That
 * is a boolean on a governed row, not a judgement a weighing machine makes.
 *
 * Third, and worst: `quality_rejection` waste has to be attributed. If the reason
 * is `TEMPERATURE_HIGH` it is the supplier's cold chain and belongs in a supplier
 * conversation. If it is `OVER_TRANSPORT` it is ours.
 *
 * ## `autoReject` is the important field
 *
 * `autoReject: true` means a receipt line failing this check is rejected without a
 * human seeing it. That is correct for a genuine hard fail — a warm delivery is
 * rejected whether or not somebody is watching — and it is exactly why the flag is
 * admin-controlled rather than derived. A reason mis-set to `autoReject: true`
 * silently throws away good stock.
 */
const REASON_CATEGORIES = ['freshness', 'temperature', 'contamination', 'packaging', 'weight_shortfall', 'documentation'];
const REASON_SEVERITIES = ['hard', 'soft'];

const jhatkaQualityRejectionReasonSchema = mongoose.Schema(
  {
    /** Stable machine key, e.g. `temp_high`. Matched by the quality gate. */
    code: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: REASON_CATEGORIES,
    },
    /**
     * `hard` = beyond doubt, reject automatically.
     * `soft`  = a judgement call, queue for a person.
     *
     * §5.3 Rule B. Only genuinely borderline cases should ever reach an operator,
     * and this is the field that keeps the rejection queue worth reading.
     */
    severity: {
      type: String,
      required: true,
      enum: REASON_SEVERITIES,
    },
    /**
     * Reject WITHOUT a human when this check fails.
     *
     * Usually derived from `severity === 'hard'` at write time, but a separate flag
     * because "hard" and "auto-reject" are not the same question: a weight
     * shortfall is hard (clearly wrong) but soft enough that a supervisor may want
     * to see it.
     */
    autoReject: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * Whose fault, for waste attribution. A supplier conversation is only
     * warranted for `supplier`; `platform` is ours to fix.
     */
    fault: {
      type: String,
      required: false,
      enum: ['supplier', 'platform', 'transporter', 'unknown'],
      default: 'unknown',
    },
    /**
     * The `JhatkaWastage.cause` this reason books against when the rejected stock
     * is written off.
     */
    wastageCause: {
      type: String,
      required: false,
      enum: ['SPOILAGE', 'QUALITY_REJECTION', 'EXPIRY', 'PACKAGING_DAMAGE', 'OTHER'],
      default: 'QUALITY_REJECTION',
    },
    /** Whether rejection should count against the supplier's quality rating. */
    affectsSupplierRating: {
      type: Boolean,
      required: false,
      default: true,
    },
    sortOrder: {
      type: Number,
      required: false,
      default: 0,
    },
    status: {
      type: Boolean,
      required: false,
      default: true,
    },
    translations: {
      type: mongoose.SchemaTypes.Mixed,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaQualityRejectionReasonSchema.plugin(toJSON);
jhatkaQualityRejectionReasonSchema.plugin(paginate);
jhatkaQualityRejectionReasonSchema.index({ code: 1 }, { unique: true });
// The rejection picker on a receipt, filtered by category.
jhatkaQualityRejectionReasonSchema.index({ status: 1, category: 1, sortOrder: 1 });
// The rejection-rate report.
jhatkaQualityRejectionReasonSchema.index({ fault: 1, status: 1 });

jhatkaQualityRejectionReasonSchema.statics.CATEGORIES = REASON_CATEGORIES;
jhatkaQualityRejectionReasonSchema.statics.SEVERITIES = REASON_SEVERITIES;

/**
 * Does a failure of this reason require a human decision?
 *
 * The inverse of `autoReject`, because a call site reads better as "should this go
 * to the queue" than as "should this not be auto-handled".
 *
 * @returns {boolean}
 */
jhatkaQualityRejectionReasonSchema.methods.requiresHumanDecision = function () {
  return !this.autoReject;
};

/**
 * @typedef JhatkaQualityRejectionReason
 */
const JhatkaQualityRejectionReason = mongoose.model(
  'JhatkaQualityRejectionReason',
  jhatkaQualityRejectionReasonSchema
);

module.exports = JhatkaQualityRejectionReason;