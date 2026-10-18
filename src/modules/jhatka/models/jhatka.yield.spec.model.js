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
 * JhatkaYieldSpec — the concept the source blueprint does not mention anywhere.
 *
 * ## Why this model exists at all
 *
 * A whole chicken yields roughly 62-68% saleable meat depending on the cut. Bone,
 * skin and trim are the remainder. **Without a record of that conversion, the
 * business cannot compute its true cost of goods, cannot know how many birds to
 * buy for a forecast, and every shrinkage number it reports is invented.**
 *
 * The source blueprint's inventory section distinguishes "raw" from "prepared"
 * stock and stops there. It never says how raw becomes prepared, or how much is
 * lost on the way. That gap is the largest margin leak available in a butcher
 * shop, and it is invisible without this model.
 *
 * ## The variance is the point
 *
 * `expectedYieldPct` is a plan. `actualYieldPct` is written to the batch at the
 * moment of cutting. The difference, per cut type, per outlet, is the most
 * valuable operational number in the vertical after gross margin — it catches a
 * butcher cutting too close to the bone, a supplier sending lighter birds than
 * quoted, and an over-portioning habit that quietly costs more than any price
 * war.
 */
const jhatkaYieldSpecSchema = mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * What comes in. 1 whole chicken at 1.4 kg, or 10 kg of whole fish.
     * Denormalised as a product ref rather than a variant because raw stock is
     * bought by product, not by retail pack.
     */
    rawProduct: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProduct',
      required: true,
    },
    rawSku: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    /** What comes out. Usually a `JhatkaVariant`. */
    outputProduct: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProduct',
      required: false,
    },
    outputSku: {
      type: String,
      required: false,
      uppercase: true,
      trim: true,
    },
    cutType: {
      type: String,
      required: true,
      enum: [
        'whole',
        'curry_cut',
        'skinless',
        'boneless',
        'cleaned',
        'fish_cleaned',
        'prawn_peeled',
        'portioned',
      ],
    },
    /**
     * Percent of raw weight that becomes saleable prepared stock. A value, not a
     * fraction: 65 means 65%. Stated as a percentage because that is how it is
     * spoken at a counter and how it appears on a wastage report.
     */
    expectedYieldPct: {
      type: Number,
      required: true,
      min: 1,
      max: 100,
    },
    /**
     * How far actual yield may drift from expected before a variance record is
     * written. Default 5 percentage points — a percentage POINTS difference, not
     * a percent-of-expected ratio, because "we got 61% instead of 65%" is the
     * thing an operator needs to read.
     */
    tolerancePct: {
      type: Number,
      required: false,
      min: 0,
      max: 50,
      default: 5,
    },
    /** The portion of raw weight that becomes trim/waste rather than yield. */
    expectedTrimPct: {
      type: Number,
      required: false,
      min: 0,
      max: 100,
    },
    /**
     * Where the trim goes. Each entry becomes a `JhatkaWastage` row with the
     * matching `cause` when the conversion runs, which is how "trim" is
     * distinguished from "spoilage" and from "over-preparation" in reporting.
     */
    wasteCategories: [
      {
        _id: false,
        code: {
          type: String,
          required: true,
          enum: ['BONE', 'SKIN', 'FAT', 'HEAD', 'GUT', 'SCALE', 'SHELL', 'TRIM', 'OTHER'],
        },
        expectedPct: {
          type: Number,
          required: true,
          min: 0,
          max: 100,
        },
        /** The `JhatkaWastage.cause` this category books against. */
        cause: {
          type: String,
          required: true,
          enum: ['TRIM', 'SPOILAGE', 'EXPIRY', 'OVER_PREPARATION', 'QUALITY_REJECTION', 'OTHER'],
          default: 'TRIM',
        },
      },
    ],
    /**
     * BR-13. Prepared product's shelf life, counted from CUT time rather than from
     * procurement. A chicken cut this morning has 24 hours left; the same chicken
     * uncut in the chiller has 48. Using the raw life for prepared stock is how a
     * customer receives day-old cut meat sold as fresh.
     */
    shelfLifeHoursPrepared: {
      type: Number,
      required: true,
      min: 1,
    },
    prepTimeMinutes: {
      type: Number,
      required: false,
      min: 0,
    },
    equipmentNotes: {
      type: String,
      required: false,
      trim: true,
    },
    /**
     * Versioned rather than mutated. A yield that changes from 65% to 62% after a
     * stocktake must not restate last month's variance report, so the new value is
     * a new row and old orders keep pointing at the row that was live when they
     * were cut.
     */
    version: {
      type: Number,
      required: false,
      default: 1,
    },
    effectiveFrom: {
      type: Date,
      required: true,
    },
    effectiveTo: {
      type: Date,
      required: false,
      default: undefined,
    },
    status: {
      type: String,
      required: false,
      enum: ['draft', 'active', 'retired'],
      default: 'active',
    },
    createdBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    /**
     * Admin reference value for the prepared stock this spec produces, so a stock
     * adjustment or a purchase can be valued without re-deriving yield.
     */
    outputUnitCost: moneyField(0),
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaYieldSpecSchema.plugin(toJSON);
jhatkaYieldSpecSchema.plugin(paginate);
// Partial unique: one live spec per (rawSku, cutType). Two live rows for the same
// conversion makes the variance report ambiguous — which one was in force when
// the batch was cut?
jhatkaYieldSpecSchema.index(
  { rawSku: 1, cutType: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active', effectiveTo: { $exists: false } },
    name: 'one_active_yield_per_raw_sku_and_cut',
  }
);
jhatkaYieldSpecSchema.index({ outputSku: 1 });
jhatkaYieldSpecSchema.index({ status: 1, effectiveFrom: 1 });

/**
 * Yield variance for a real conversion, and the decision it drives.
 *
 * Pure. Given the plan and what actually happened, it says whether to write a
 * variance record and in which direction. Kept pure so it is unit-testable
 * without a database and so the same function serves both the preparation screen
 * and the batch write.
 *
 * @param {number} expectedPct plan, 0-100
 * @param {number} actualPct   observed, 0-100
 * @param {number} tolerancePct allowed drift in percentage POINTS
 * @returns {{ withinTolerance: boolean, variancePct: number, direction: string|null }}
 */
jhatkaYieldSpecSchema.statics.evaluateVariance = function (expectedPct, actualPct, tolerancePct = 5) {
  const variancePct = Number((actualPct - expectedPct).toFixed(2));
  const withinTolerance = Math.abs(variancePct) <= tolerancePct;

  let direction = null;
  if (!withinTolerance) {
    if (variancePct > 0) {
      // More saleable meat than planned. Either a good batch or over-trimming.
      direction = 'ABOVE_EXPECTED';
    } else {
      // Less than planned. This is the expensive direction and the one that
      // should page someone: it means either a bad supplier or too much bone left
      // on the cut, and both are money leaving the business silently.
      direction = 'BELOW_EXPECTED';
    }
  }

  return { withinTolerance, variancePct, direction };
};

/**
 * @typedef JhatkaYieldSpec
 */
const JhatkaYieldSpec = mongoose.model('JhatkaYieldSpec', jhatkaYieldSpecSchema);

module.exports = JhatkaYieldSpec;