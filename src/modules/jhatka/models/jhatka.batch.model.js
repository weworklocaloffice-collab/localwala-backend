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
 * JhatkaBatch — one accepted receipt line. The unit of traceability, expiry and
 * recall.
 *
 * ## A batch is a receipt line, not a receipt
 *
 * A supplier's lorry arrives with forty different lines. Each line becomes its own
 * batch because they were received at the same minute but they were cut from
 * different birds on different farms, they expire at different rates, and a
 * complaint about one of them must not implicate the other thirty-nine. Grouping
 * by delivery would make every recall a total recall.
 *
 * ## `cutQty` / `uncutQty` is BR-11
 *
 * A whole chicken arrives as raw. It is then cut, and the cut produces prepared
 * stock plus trim. Recording both halves on the batch is what makes yield
 * measurable — without it the trim is invisible and the true cost of goods is
 * unknowable. `yieldRecorded.variancePct` below is the number this whole model
 * exists to produce.
 *
 * ## Never deleted (BR-23)
 *
 * A batch has a recall history. Deleting one destroys the ability to answer "who
 * ate this", which is the only question a food-safety investigation actually
 * asks. `status` and `quarantinedAt` are the only ways a batch stops being used.
 */
const jhatkaBatchSchema = mongoose.Schema(
  {
    /** Human-facing, printed on the pack's traceability QR (§12.3). */
    batchNo: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
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
    supplier: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaSupplier',
      required: true,
    },
    /** The receipt line. Named `receiptItem`, not `collection` — see below. */
    procurementReceipt: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProcurementReceipt',
      required: true,
    },
    /**
     * Named `receiptItem` rather than `collection` deliberately.
     *
     * `collection` is a Mongoose-reserved pathname on a schema — declaring it
     * breaks `.save()` at runtime, not at build time. `DairyMilkCollection`
     * sidesteps the same trap with `sourceCollection`; this is that lesson carried
     * forward rather than rediscovered.
     */
    receiptItem: {
      type: mongoose.SchemaTypes.ObjectId,
      required: true,
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProduct',
      required: true,
    },
    /** Stock-keeping unit of the raw goods. Printed on the weigh ticket. */
    rawSku: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    /** Supplier's own batch reference, for reconciling against their paperwork. */
    supplierBatchRef: {
      type: String,
      required: false,
      trim: true,
    },
    unit: {
      type: String,
      required: true,
      enum: ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER'],
    },
    receivedQty: {
      type: Number,
      required: true,
      min: 0,
    },
    /**
     * All integer quantities in this document. `availableQty` is the only one a
     * hot query reads, and it is maintained as a stored field rather than derived
     * so FEFO can sort and filter on it.
     */
    availableQty: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    consumedQty: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    /**
     * `min: 0` on every counter, with the same caveat as `JhatkaInventoryItem`:
     * Mongoose validators do not run on `$inc` updates, so the service is the real
     * guard and these are the first line of defence.
     */
    rejectedQty: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    wastedQty: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    /** BR-11. Yielded into prepared stock. */
    cutQty: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    /** BR-11. Never cut. The remainder of a part-used whole bird. */
    uncutQty: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
    },
    /**
     * BR-11. Written at the moment of cutting, not estimated afterwards.
     *
     * `variancePct` is in percentage POINTS of yield, not a relative ratio:
     * "we got 61% instead of 65%" is the thing an operator can act on, whereas
     * "-6.2%" against a relative baseline is not.
     */
    yieldRecorded: {
      yieldSpec: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'JhatkaYieldSpec',
        required: false,
      },
      cutType: {
        type: String,
        required: false,
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
      expectedPct: { type: Number, required: false, min: 0, max: 100 },
      actualPct: { type: Number, required: false, min: 0, max: 100 },
      variancePct: { type: Number, required: false },
      /** `BELOW_EXPECTED` is the direction that costs money and should page someone. */
      direction: {
        type: String,
        required: false,
        enum: ['ABOVE_EXPECTED', 'BELOW_EXPECTED'],
      },
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      byName: { type: String, required: false, trim: true },
      at: { type: Date, required: false },
    },
    receivedAt: {
      type: Date,
      required: true,
    },
    /**
     * BR-13. Raw life, counted from `receivedAt`. Prepared stock gets its own
     * shorter life counted from CUT time, held on `JhatkaInventoryItem.useByAt`
     * and on the batch's `cutExpiresAt` below.
     */
    expiresAt: {
      type: Date,
      required: true,
    },
    /** When prepared stock cut from this batch must be withdrawn. */
    cutExpiresAt: {
      type: Date,
      required: false,
      default: undefined,
    },
    storageLocation: {
      type: String,
      required: false,
      trim: true,
    },
    status: {
      type: String,
      required: false,
      enum: ['source', 'opened', 'consumed', 'expired', 'quarantined', 'discarded'],
      default: 'source',
    },
    /**
     * §5.4. A quarantined batch is frozen: no allocation, no fulfilment, and every
     * order already drawing on it moves to `ON_HOLD`.
     *
     * `discarded` and `expired` both mean `availableQty === 0`, and both are
     * written by a compensating allocation rather than by mutating the counter —
     * otherwise reports cannot say what happened to the stock.
     */
    quarantinedAt: {
      type: Date,
      required: false,
    },
    quarantineReason: {
      type: String,
      required: false,
      trim: true,
    },
    releasedAt: {
      type: Date,
      required: false,
    },
    /**
     * Recall linkage. A batch under recall is quarantined AND carries the recall
     * document, so the reverse lookup "which recalls touched this batch" is one
     * indexed read rather than a scan.
     */
    recalls: [
      {
        _id: false,
        recall: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaRecall',
          required: true,
        },
        severity: {
          type: String,
          required: true,
          enum: ['advisory', 'withdraw', 'recall'],
        },
        at: { type: Date, required: true },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaBatchSchema.plugin(toJSON);
jhatkaBatchSchema.plugin(paginate);
jhatkaBatchSchema.index({ batchNo: 1 }, { unique: true });
// FEFO's ordering query. `{ expiresAt: 1 }` alone; the compound form lets a query
// that also filters status stay covered by the same index.
jhatkaBatchSchema.index({ outlet: 1, status: 1, expiresAt: 1 });
// The recall sweep and the expiry sweep.
jhatkaBatchSchema.index({ status: 1, expiresAt: 1 });
jhatkaBatchSchema.index({ supplier: 1, receivedAt: -1 });
// Reverse traceability: "which batches did this supplier send us this week?"
jhatkaBatchSchema.index({ supplier: 1, receivedAt: -1, status: 1 });

/**
 * Usable quantity right now.
 *
 * Returns 0 for anything that is not `source` or `opened` — a quarantined or
 * expired batch has zero usable stock even if its counter still says otherwise,
 * because the counter is updated by a compensating write that may not have landed
 * yet. Inherited in spirit from `DairyMilkBatch.usableQtyL(now)`.
 *
 * @param {Date} [now]
 * @returns {number} integer, in this batch's unit
 */
jhatkaBatchSchema.methods.usableQty = function (now = new Date()) {
  if (!['source', 'opened'].includes(this.status)) return 0;
  if (this.expiresAt && this.expiresAt <= now) return 0;
  return Math.max(0, this.availableQty || 0);
};

/**
 * Is this batch frozen? Order fulfilment must refuse it.
 */
jhatkaBatchSchema.methods.isFrozen = function () {
  return this.status === 'quarantined';
};

/**
 * @typedef JhatkaBatch
 */
const JhatkaBatch = mongoose.model('JhatkaBatch', jhatkaBatchSchema);

module.exports = JhatkaBatch;