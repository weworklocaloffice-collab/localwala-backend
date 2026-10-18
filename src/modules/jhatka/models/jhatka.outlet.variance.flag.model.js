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
 * JhatkaOutletVarianceFlag — the theft-shaped signal. §8.5.
 *
 * ## Why this model exists at all
 *
 * BR-06 means an over-delivery is charged to nobody. That removes the obvious
 * incentive to over-weigh — the outlet gains nothing from it. It does NOT remove
 * the incentive to UNDER-weigh: an outlet that reports 900 g for a 1 kg order
 * triggers a refund the outlet can then pocket through some arrangement, or simply
 * benefits from the low recorded yield in its own reporting.
 *
 * So the variance is measured in BOTH directions, and this is the record of the
 * numbers worth looking at.
 *
 * ## What it is NOT
 *
 * Not an alert, not a suspension, and not a judgement. A +8% variance on one order
 * is a scale that needs calibrating. This document exists so the *pattern* is
 * visible — `outletVarianceReport` aggregates over a period, and only a
 * systematic pattern is worth a conversation.
 *
 * The distinction matters because an alert on every reading trains operators to
 * dismiss it, which is the same failure mode as the `withdraw` severity that
 * quietly generates customer notifications (§5.4).
 */
const VARIANCE_DIRECTIONS = ['over', 'under'];
const VARIANCE_ACTIONS = ['none', 'observed', 'reviewed', 'escalated', 'calibrated', 'fraud_referred'];

const jhatkaOutletVarianceFlagSchema = mongoose.Schema(
  {
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
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
    weightConfirmation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaWeightConfirmation',
      required: true,
    },
    direction: {
      type: String,
      required: true,
      enum: VARIANCE_DIRECTIONS,
    },
    /**
     * `actual / requested`. 1.08 for 8% over, 0.90 for 10% under.
     *
     * A RATIO rather than a percentage, so "consistently 1.06" is visible at a
     * glance. `variancePct` is derivable from it and is stored for indexing.
     */
    ratio: {
      type: Number,
      required: true,
      min: 0,
    },
    variancePct: {
      type: Number,
      required: true,
    },
    requestedGrams: { type: Number, required: true },
    actualGrams: { type: Number, required: true },
    /**
     * The policy snapshot as applied. Frozen, because tightening the tolerance next
     * month must not retroactively change what counts as a flag.
     */
    policy: {
      tolerancePct: { type: Number, required: true },
      hardOverchargePct: { type: Number, required: true },
      hardShortfallPct: { type: Number, required: true },
    },
    /**
     * Whether a MANAGER overrode the hard cap on this reading.
     *
     * `weighedBy === override.by` is a segregation-of-duties violation: the person
     * who cut the meat signed off its weight. §14.2 exists partly to make this rare,
     * and the variance report counts it.
     */
    wasOverridden: {
      type: Boolean,
      required: false,
      default: false,
    },
    overrideBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    /**
     * `weighedBy === overrideBy`. Computed at write time because it is a
     * violation, not a preference, and the report needs to count them.
     */
    selfApproved: {
      type: Boolean,
      required: false,
      default: false,
    },
    action: {
      type: String,
      required: false,
      enum: VARIANCE_ACTIONS,
      default: 'none',
    },
    actionNote: { type: String, required: false, trim: true },
    actionBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    actionByName: { type: String, required: false, trim: true },
    actionAt: { type: Date, required: false },
    flaggedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaOutletVarianceFlagSchema.plugin(toJSON);
jhatkaOutletVarianceFlagSchema.plugin(paginate);
/**
 * THE VARIANCE REPORT'S QUERY.
 *
 * One outlet, one period, ordered by direction and magnitude. An operator sees
 * every reading this outlet got wrong and how far off it was — which is the only
 * way to distinguish "needs calibrating" from "needs investigating".
 */
jhatkaOutletVarianceFlagSchema.index({ outlet: 1, flaggedAt: -1, direction: 1 });
// The self-approval audit.
jhatkaOutletVarianceFlagSchema.index({ outlet: 1, selfApproved: 1, flaggedAt: -1 });
// The override trail.
jhatkaOutletVarianceFlagSchema.index({ overrideBy: 1, flaggedAt: -1 });
// One flag per weight confirmation. A re-weigh supersedes rather than duplicating.
jhatkaOutletVarianceFlagSchema.index({ weightConfirmation: 1 }, { unique: true });
// "Show me the ones nobody has looked at."
jhatkaOutletVarianceFlagSchema.index({ action: 1, flaggedAt: -1 });

jhatkaOutletVarianceFlagSchema.statics.DIRECTIONS = VARIANCE_DIRECTIONS;
jhatkaOutletVarianceFlagSchema.statics.ACTIONS = VARIANCE_ACTIONS;

/**
 * Does this reading warrant a flag at all?
 *
 * Inside the tolerance band, no. BR-07 says no financial event happens there, and
 * flagging it as well would put 90% of readings into the report and make the 10%
 * that matter invisible.
 *
 * A shortfall flag is raised regardless of whether it triggered a refund: the
 * refund is the customer's money and the flag is the operational signal, and
 * conflating them means a "we absorbed it so it is fine" reading hides an outlet
 * that is consistently under-delivering.
 *
 * @param {number} variancePct signed
 * @param {{tolerancePct: number, hardOverchargePct: number, hardShortfallPct: number}} policy
 * @returns {boolean}
 */
jhatkaOutletVarianceFlagSchema.statics.shouldFlag = function (variancePct, policy = {}) {
  const tol = Number(policy.tolerancePct ?? 5);
  const over = Number(policy.hardOverchargePct ?? 10);
  const under = Number(policy.hardShortfallPct ?? 2);

  if (variancePct > over) return true;
  if (-variancePct >= under) return true;
  return Math.abs(variancePct) > tol;
};

/**
 * Which direction is this variance?
 *
 * `null` for exactly zero, not `'under'`. A 0% variance has no direction, and the
 * first version returned `'under'` for it because `0 > 0` is false — which would
 * file an exactly-correct reading into the under-delivery report. A "consistently
 * 1.00" outlet then reads as "consistently short", and the report's whole purpose
 * is to be trustworthy about exactly that pattern.
 *
 * @param {number} variancePct signed
 * @returns {'over'|'under'|null}
 */
jhatkaOutletVarianceFlagSchema.statics.directionOf = function (variancePct) {
  const v = Number(variancePct);
  if (v > 0) return 'over';
  if (v < 0) return 'under';
  return null;
};

/**
 * Has anyone looked at this?
 *
 * `action: 'none'` means unexamined. The console lists these first.
 */
jhatkaOutletVarianceFlagSchema.methods.isUnreviewed = function () {
  return this.action === 'none';
};

/**
 * @typedef JhatkaOutletVarianceFlag
 */
const JhatkaOutletVarianceFlag = mongoose.model(
  'JhatkaOutletVarianceFlag',
  jhatkaOutletVarianceFlagSchema
);

module.exports = JhatkaOutletVarianceFlag;