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
 * Unauthorized copying, redistribution, resale, publiction,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');
const { quantitySchema } = require('../utils/quantity');

/**
 * JhatkaPreparationTicket — the procurement-to-order join. §8.6.
 *
 * ## What this model is actually for
 *
 * It is the document that answers "which batch was this cut from?" without a
 * join. That question is asked constantly — by a support agent handling a
 * quality complaint, by a compliance officer running a recall, by an operations
 * manager wondering whether yesterday's yield drop is a supplier problem.
 *
 * `JhatkaBatchAllocation` is the source of truth for traceability and is the thing
 * a recall query runs against. This ticket is the human-readable projection of
 * the same fact, sitting where the operator is already looking.
 *
 * ## One ticket per order per preparation attempt
 *
 * Not one per order, because an order can be re-prepared after `ON_HOLD`. The
 * `attempt` counter and the `supersededBy` chain mirror
 * `JhatkaWeightConfirmation`, and for the same reason: a re-preparation must not
 * destroy the record of the first one.
 *
 * ## `lines[].batch` is what makes yield measurable
 *
 * A ticket records requested quantity, the batch drawn from, how much was
 * allocated, how much was consumed, how much was trim, and what the scale read.
 * That is the complete input to `JhatkaYieldSpec.evaluateVariance`, which is how
 * the variance report has anything to report.
 */
const TICKET_LINE_STATUSES = ['pending', 'allocated', 'prepared', 'weighed', 'short', 'over'];

const jhatkaPreparationTicketSchema = mongoose.Schema(
  {
    ticketNo: {
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
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    attempt: {
      type: Number,
      required: false,
      default: 1,
      min: 1,
    },
    supersededBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaPreparationTicket',
      required: false,
      default: undefined,
    },
    isCurrent: {
      type: Boolean,
      required: false,
      default: true,
    },
    /**
     * Set when the ticket was raised by an `ON_HOLD` release, so the re-preparation
     * is distinguishable from a first attempt in the operations log.
     */
    reason: {
      type: String,
      required: false,
      enum: ['initial', 'on_hold_release', 'customer_substitution', 'reweigh'],
    },

    lines: [
      {
        _id: false,
        orderItem: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaOrderItem',
          required: true,
        },
        product: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaProduct',
          required: true,
        },
        sku: { type: String, required: true, uppercase: true, trim: true },

        requestedQty: {
          type: quantitySchema,
          required: true,
        },
        /**
         * The batch this line draws from.
         *
         * NOT an array, even though one line can span two batches (BR-10). When it
         * does, the ticket carries one line per batch — `allocatedQty` then sums
         * across them. A duplicated line is easier to read at a counter than an
         * array, and the allocation collection remains authoritative for the split.
         */
        batch: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaBatch',
          required: false,
          default: undefined,
        },
        allocatedQty: {
          type: quantitySchema,
          required: false,
          default: undefined,
        },
        consumedQty: {
          type: quantitySchema,
          required: false,
          default: undefined,
        },
        /** BR-11. Trim, skin, bone — the inevitable part of a cut. */
        trimQty: {
          type: quantitySchema,
          required: false,
          default: undefined,
        },
        /** BR-11. Anything consumed beyond expectation. A demand-forecasting error. */
        overPreparationQty: {
          type: quantitySchema,
          required: false,
          default: undefined,
        },
        /**
         * What the scale read. Present only once the line is `weighed`, and the
         * value copied onto `JhatkaWeightConfirmation.actualQuantity`.
         */
        actualQty: {
          type: quantitySchema,
          required: false,
          default: undefined,
        },
        /** BR-11. The measured outcome, compared against `JhatkaYieldSpec`. */
        yieldActualPct: {
          type: Number,
          required: false,
          min: 0,
          max: 100,
        },
        yieldExpectedPct: {
          type: Number,
          required: false,
          min: 0,
          max: 100,
        },
        /** Which side of the plan this line landed on. §6.4 */
        yieldDirection: {
          type: String,
          required: false,
          enum: ['ABOVE_EXPECTED', 'BELOW_EXPECTED'],
        },
        /** BR-13. Cut time starts the prepared-product clock. */
        cutAt: {
          type: Date,
          required: false,
        },
        useByAt: {
          type: Date,
          required: false,
          default: undefined,
        },
        status: {
          type: String,
          required: false,
          enum: TICKET_LINE_STATUSES,
          default: 'pending',
        },
        /**
         * Where this line's shortage came from. `supplier_short` is a procurement
         * failure and pages the buyer; `outlet_short` is a stockout and does not.
         */
        shortReason: {
          type: String,
          required: false,
          enum: ['supplier_short', 'outlet_short', 'quality_rejected', 'other'],
        },
        note: {
          type: String,
          required: false,
          trim: true,
        },
      },
    ],

    status: {
      type: String,
      required: false,
      enum: ['open', 'weighing', 'completed', 'cancelled'],
      default: 'open',
    },
    /**
     * BR-12. The cold-chain reading taken when packing finished. `withinBand: false`
     * blocks dispatch — fresh meat above 4 °C is unsafe and this is the last point
     * at which that is still fixable.
     */
    coldChain: {
      tempC: { type: Number, required: false },
      at: { type: Date, required: false },
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      byName: { type: String, required: false, trim: true },
      withinBand: { type: Boolean, required: false, default: undefined },
      breachReason: { type: String, required: false, trim: true },
    },
    completedAt: {
      type: Date,
      required: false,
    },
    completedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    completedByName: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaPreparationTicketSchema.plugin(toJSON);
jhatkaPreparationTicketSchema.plugin(paginate);
jhatkaPreparationTicketSchema.index({ ticketNo: 1 }, { unique: true });
// The prep screen's ticket lookup.
jhatkaPreparationTicketSchema.index({ order: 1, attempt: -1 });
jhatkaPreparationTicketSchema.index({ outlet: 1, status: 1, createdAt: -1 });
// Reverse traceability: which tickets consumed a given batch?
jhatkaPreparationTicketSchema.index({ 'lines.batch': 1 });
// Yield variance reporting, grouped by cut type via the line's product.
jhatkaPreparationTicketSchema.index({ 'lines.yieldDirection': 1, completedAt: -1 });
// Current ticket per order attempt — partial, so it does not grow with re-preps.
jhatkaPreparationTicketSchema.index(
  { order: 1, attempt: 1 },
  {
    unique: true,
    partialFilterExpression: { isCurrent: true },
    name: 'one_current_ticket_per_order',
  }
);

/**
 * Does this ticket have any line the scale disagreed with by more than the yield
 * tolerance?
 *
 * The operator-facing summary: "this ticket needs a look". Pure, so the prep
 * screen and the analytics service agree on what counts.
 */
jhatkaPreparationTicketSchema.methods.hasYieldVariance = function () {
  return (this.lines || []).some(
    (l) =>
      l.yieldActualPct !== undefined &&
      l.yieldExpectedPct !== undefined &&
      Math.abs(l.yieldActualPct - l.yieldExpectedPct) > (l.yieldTolerancePct ?? 5)
  );
};

/**
 * Total requested weight on this ticket, in grams. Feeds the prep screen's
 * "how much are we cutting today" panel.
 *
 * COUNT lines are excluded — summing pieces and grams together is meaningless and
 * is the arithmetic this helper exists to prevent.
 */
jhatkaPreparationTicketSchema.methods.totalRequestedGrams = function () {
  return (this.lines || [])
    .filter((l) => l.requestedQty && ['GRAM', 'KG'].includes(l.requestedQty.unit))
    .reduce((sum, l) => {
      const factor = l.requestedQty.unit === 'KG' ? 1000 : 1;
      return sum + Math.round(l.requestedQty.value * factor);
    }, 0);
};

/**
 * @typedef JhatkaPreparationTicket
 */
const JhatkaPreparationTicket = mongoose.model(
  'JhatkaPreparationTicket',
  jhatkaPreparationTicketSchema
);

module.exports = JhatkaPreparationTicket;