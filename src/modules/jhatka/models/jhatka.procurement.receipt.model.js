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
const { quantitySchema } = require('../utils/quantity');

/**
 * JhatkaProcurementReceipt — goods physically received, checked, and accepted or
 * rejected. §5.3.
 *
 * ## This is the source blueprint's "collection", renamed
 *
 * `DairyMilkCollection` is the milk vertical's equivalent. The name differs
 * because "collection" in the dairy sense means the supplier brought milk to us,
 * while a Jhatka receipt covers a purchase order and a walk-in delivery equally.
 *
 * ## Three rules inherited from `dairy.procurement.service`
 *
 * **Rule A — the rate is snapshotted at intake.** `unitPrice` per line is frozen
 * when the receipt is posted. A later price change must not restate a delivery,
 * and `DairyMilkCollection` records its `ratePerLitre` for exactly this reason.
 *
 * **Rule B — a hard fail auto-rejects; a borderline reading goes to a human.**
 * `qualityStatus` starts `pending`. `evaluateQuality` returns hard failures and
 * warnings separately, and only hard failures set `rejected` without an operator
 * deciding. The point is that the rejection queue contains only genuinely
 * borderline cases, so a person reading it is actually making a decision.
 *
 * **Rule C — accepted goods cannot be rejected afterwards.** `rejectLine` refuses
 * when a line is `accepted`, with the instruction to reverse the batch first.
 * Dairy's comment is blunt: *"Accepted milk cannot be rejected — reverse the batch
 * first."* The same applies, and the reason is the same: the batch has already fed
 * allocations that reference it.
 *
 * ## `payability` is what makes the payable statement work
 *
 * `pending` means **not yet owed**. §10.2 claims only accepted quantity on a
 * `payability: 'pending'` line, so a received-but-rejected line is never invoiced,
 * a partially accepted line is paid only for what was accepted, and an
 * already-paid line is never claimed twice. This follows
 * `DairyProviderPayable.claimableCollections`, with the partial case added.
 *
 * ## Partial acceptance is the normal case
 *
 * A lorry arrives with forty lines; two are warm. `accepted` and `rejected`
 * quantities both live on the line, and the receipt's own `qualityStatus` is the
 * ROLL-UP. Modelling only all-or-nothing would mean either rejecting a whole
 * delivery over one warm crate, or recording the rejection somewhere the payable
 * cannot see it.
 */
const LINE_QUALITY_STATUSES = ['pending', 'accepted', 'rejected', 'partially_accepted'];
const RECEIPT_STATUSES = ['draft', 'posted', 'cancelled'];

const jhatkaProcurementReceiptSchema = mongoose.Schema(
  {
    receiptNo: {
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
    /**
     * Optional. A walk-in delivery from a supplier has no purchase order against
     * it, and blocking those would make the model unable to represent a real
     * morning at a butcher counter.
     */
    purchaseOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaPurchaseOrder',
      required: false,
      default: undefined,
    },
    /** The supplier's own delivery note / invoice reference. */
    supplierInvoiceRef: {
      type: String,
      required: false,
      trim: true,
    },
    /** Invoices and weighbridge tickets, per §21 "documents where required". */
    documents: [
      {
        _id: false,
        type: { type: String, required: true, trim: true },
        fileUrl: { type: String, required: true },
        uploadedAt: { type: Date, required: true },
      },
    ],

    receivedAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      required: false,
      enum: RECEIPT_STATUSES,
      default: 'draft',
    },
    /**
     * The ROLL-UP of every line's `qualityStatus`.
     *
     * `rejected` when every line was rejected, `accepted` when every line was,
     * `partially_accepted` for the normal mixed case, and `pending` while the
     * gate has not finished. Derived on post, never set by hand.
     */
    qualityStatus: {
      type: String,
      required: false,
      enum: LINE_QUALITY_STATUSES,
      default: 'pending',
    },

lines: [
    {
      /**
       * Lines carry a real `_id`, unlike `documents` above.
       *
       * `JhatkaBatch.receiptItem` is REQUIRED and holds this id, and a batch cannot
       * exist without the receipt line that produced it — that link is what makes a
       * recall answerable (§11 queries `{batch: 1}`). With `_id: false` here, the
       * post-receipt route wrote `receiptItem: undefined` and EVERY posting failed
       * validation, so the whole procurement → batch → inventory path was dead.
       *
       * Found by `verify.jhatka.integration.js`. `_id: false` is right for embedded
       * value objects that are never referenced, and wrong the moment something
       * outside the document points at them.
       */
      product: {
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
        /** The supplier's batch reference. Printed on the pack's traceability QR. */
        supplierBatchRef: {
          type: String,
          required: false,
          trim: true,
        },
        /**
         * What turned up. Integer, in `unit`. Never a float — 1.4 kg arrives as
         * 1400 GRAM, and a decimal here becomes a decimal in every downstream sum.
         */
        receivedQty: {
          type: quantitySchema,
          required: true,
        },
        acceptedQty: {
          type: quantitySchema,
          required: false,
          default: undefined,
        },
        rejectedQty: {
          type: quantitySchema,
          required: false,
          default: undefined,
        },
        /**
         * Rule A. Frozen at intake so a rate change cannot restate this delivery.
         * Paise at the edges via moneyField; quantity is in `unit`.
         */
        /**
         * `...moneyField(0)` is SPREAD, not `type: moneyField(0)`.
         *
         * `moneyField()` already returns `{type, get, set, default}`. Nesting it
         * under `type:` produces `{type: {type, get, set, default}, required}` and
         * Mongoose throws at schema-build time with "`true` is not a valid type at
         * path `required`". Spreading merges the four keys into this definition and
         * leaves `required` as a sibling, which is what Mongoose expects.
         */
        unitPrice: {
          ...moneyField(0),
          required: true,
        },
        /** `acceptedQty × unitPrice`. What we owe for this line. */
        amount: {
          ...moneyField(0),
          required: true,
        },
        /** What the rejected portion was worth, for waste attribution. */
        rejectedValue: moneyField(0),

        /**
         * The readings the quality gate judges.
         *
         * `temperatureC` is the one that matters most and the one most often
         * skipped. A warm delivery is not fresh meat regardless of how it looks,
         * and "the crate did not feel cold" is the inspection that actually happens.
         */
        readings: {
          temperatureC: { type: Number, required: false },
          /** Odour, 1-5. 1 is fresh. */
          smellScore: { type: Number, required: false, min: 1, max: 5 },
          /** Colour against the expected appearance for the cut. */
          colourScore: { type: Number, required: false, min: 1, max: 5 },
          packagingIntact: { type: Boolean, required: false, default: undefined },
          /**
           * The temperature the food arrived at, checked against
           * `JhatkaOutlet.qualityPolicy.maxIntakeTemperatureC`. A gap here is what
           * the whole cold-chain rule in §12 hangs on.
           */
          transitHours: { type: Number, required: false, min: 0 },
        },

        qualityStatus: {
          type: String,
          required: false,
          enum: LINE_QUALITY_STATUSES,
          default: 'pending',
        },
        /**
         * Refs `JhatkaQualityRejectionReason`, not free text — §47's rejection-rate
         * report is impossible otherwise. Multiple because a warm delivery is often
         * also light and also torn.
         */
        rejectionReasons: [
          {
            _id: false,
            reason: {
              type: mongoose.SchemaTypes.ObjectId,
              ref: 'JhatkaQualityRejectionReason',
              required: true,
            },
            code: {
              type: String,
              required: true,
              trim: true,
            },
            note: { type: String, required: false, trim: true },
          },
        ],
        qualityNotes: {
          type: String,
          required: false,
          trim: true,
        },

        /**
         * The batch created from this line's accepted quantity. Set on post, in the
         * same transaction that decrements nothing and creates the inventory row.
         */
        batch: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaBatch',
          required: false,
          default: undefined,
        },

        /**
         * §10.2. `pending` = not yet owed. The payable statement claims
         * accepted quantity on pending lines, including partial acceptance.
         */
        payability: {
          type: String,
          required: false,
          enum: ['pending', 'claimed', 'paid', 'disputed'],
          default: 'pending',
        },
        payableStatement: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaSupplierPayable',
          required: false,
          default: undefined,
        },
        payabilitySettledAt: {
          type: Date,
          required: false,
        },

        /**
         * Who weighed it. Fresh-meat receipt inspection is a physical act and the
         * name must survive the user being deleted.
         */
        weighedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        weighedByName: { type: String, required: false, trim: true },
        weighedAt: { type: Date, required: false },
        note: { type: String, required: false, trim: true },
      },
    ],

    totals: {
      lineCount: { type: Number, required: false, default: 0, min: 0 },
      totalReceivedQty: { type: Number, required: false, default: 0 },
      totalAcceptedQty: { type: Number, required: false, default: 0 },
      totalRejectedQty: { type: Number, required: false, default: 0 },
      /** What we owe for accepted goods. Frozen at post. */
      totalAcceptedValue: moneyField(0),
      /** What the rejected portion was worth. Cost of a bad delivery, itemised. */
      totalRejectedValue: moneyField(0),
    },
    /**
     * Percentage of value rejected, frozen at post. Denominator is the delivered
     * value, not the accepted value — otherwise a fully-rejected delivery reads as
     * "no rejections", which is the one number this field must never do.
     */
    rejectionRatePct: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
      max: 100,
    },

    postedAt: { type: Date, required: false },
    postedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    postedByName: { type: String, required: false, trim: true },
    /** Device/vehicle the delivery arrived on. Useful when a supplier disputes. */
    vehicleNo: { type: String, required: false, trim: true },
    note: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaProcurementReceiptSchema.plugin(toJSON);
jhatkaProcurementReceiptSchema.plugin(paginate);
jhatkaProcurementReceiptSchema.index({ receiptNo: 1 }, { unique: true });
// The payable generator's hot query: unclaimed accepted goods for a supplier.
jhatkaProcurementReceiptSchema.index({ supplier: 1, status: 1, 'lines.payability': 1 });
// The supplier's delivery history and the rejection-rate report.
jhatkaProcurementReceiptSchema.index({ supplier: 1, receivedAt: -1 });
jhatkaProcurementReceiptSchema.index({ outlet: 1, receivedAt: -1 });
// The purchase order's receipt list.
jhatkaProcurementReceiptSchema.index({ purchaseOrder: 1 });
// Reverse traceability: which receipts produced this batch.
jhatkaProcurementReceiptSchema.index({ 'lines.batch': 1 });
// The cold-chain report: deliveries that arrived warm.
jhatkaProcurementReceiptSchema.index({ qualityStatus: 1, receivedAt: -1 });

jhatkaProcurementReceiptSchema.statics.LINE_QUALITY_STATUSES = LINE_QUALITY_STATUSES;
jhatkaProcurementReceiptSchema.statics.RECEIPT_STATUSES = RECEIPT_STATUSES;

/**
 * Roll every line's quality status up into the receipt's. Pure.
 *
 * @param {Array<{qualityStatus: string}>} lines
 * @returns {'pending'|'accepted'|'rejected'|'partially_accepted'}
 */
jhatkaProcurementReceiptSchema.statics.rollUpQualityStatus = function (lines) {
  if (!Array.isArray(lines) || lines.length === 0) return 'pending';

  const accepted = lines.filter((l) => l.qualityStatus === 'accepted').length;
  const rejected = lines.filter((l) => l.qualityStatus === 'rejected').length;
  const pending = lines.filter((l) => l.qualityStatus === 'pending').length;

  // Anything still awaiting a decision cannot be summarised as a verdict.
  if (pending > 0) return 'pending';
  if (accepted === 0 && rejected === 0) return 'pending';
  if (rejected === 0) return 'accepted';
  if (accepted === 0) return 'rejected';
  return 'partially_accepted';
};

/**
 * Is this receipt claimable on a supplier payable statement?
 *
 * §10.2: accepted quantity with `payability: 'pending'` only. A partially
 * accepted line is claimable for its accepted quantity. This is the single rule
 * that stops a rejected line being paid for, and a paid line being paid for twice.
 */
jhatkaProcurementReceiptSchema.methods.claimableLines = function () {
  if (this.status !== 'posted') return [];
  return (this.lines || []).filter((l) => {
    if (l.payability !== 'pending') return false;
    if (l.qualityStatus !== 'accepted' && l.qualityStatus !== 'partially_accepted') return false;
    const accepted = Number(l.acceptedQty?.value ?? (l.qualityStatus === 'accepted' ? l.receivedQty?.value : 0));
    return accepted > 0;
  });
};

/**
 * Recompute the receipt's derived totals from its lines. Pure bookkeeping.
 *
 * Called after an accept/reject decision so the statement header and the
 * rejection-rate report never disagree with the line they describe.
 */
jhatkaProcurementReceiptSchema.methods.recalculateTotals = function () {
  const lines = this.lines || [];
  const totalReceived = lines.reduce((sum, l) => sum + Number(l.receivedQty?.value || 0), 0);
  const totalAccepted = lines.reduce((sum, l) => sum + Number(l.acceptedQty?.value || 0), 0);
  const totalRejected = lines.reduce((sum, l) => sum + Number(l.rejectedQty?.value || 0), 0);
  const totalAcceptedValue = lines.reduce((sum, l) => sum + Number(l.amount || 0), 0);
  const totalRejectedValue = lines.reduce((sum, l) => sum + Number(l.rejectedValue || 0), 0);

  this.totals.lineCount = lines.length;
  this.totals.totalReceivedQty = totalReceived;
  this.totals.totalAcceptedQty = totalAccepted;
  this.totals.totalRejectedQty = totalRejected;
  this.totals.totalAcceptedValue = totalAcceptedValue;
  this.totals.totalRejectedValue = totalRejectedValue;
  this.rejectionRatePct =
    totalReceived > 0 ? Number(((totalRejected / totalReceived) * 100).toFixed(2)) : 0;
  this.qualityStatus = jhatkaProcurementReceiptSchema.statics.rollUpQualityStatus(lines);
  return this.totals;
};

const lineDecisionError = (message, code, details = {}) => {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
};

/**
 * Can this line still be rejected?
 *
 * Rule C. Once a line is accepted its batch exists, that batch has allocations
 * referencing it, and rejecting the line would leave those allocations pointing at
 * rejected stock. Reverse the batch instead.
 *
 * A line can be rejected while the receipt is still a draft (the normal quality
 * decision) or, for legacy/partial-post data, while it is posted but has no batch.
 * Accepted, partially accepted, already-rejected and batched lines cannot.
 *
 * @param {number} lineIndex
 * @returns {boolean}
 */
jhatkaProcurementReceiptSchema.methods.canRejectLine = function (lineIndex) {
  if (this.status !== 'draft' && this.status !== 'posted') return false;
  const line = (this.lines || [])[lineIndex];
  if (!line) return false;
  if (line.batch) return false;
  return line.qualityStatus === 'pending';
};

/**
 * Reject one line. The caller (service) resolves rejection reasons to governed
 * `JhatkaQualityRejectionReason` references first; this method owns the line
 * state transition and the derived totals.
 *
 * Throws a plain Error with a stable `.code` so the HTTP layer can map it to a
 * 409 (`REVERSE_BATCH_FIRST`, `LINE_ALREADY_REJECTED`) or 400.
 *
 * @param {number} lineIndex
 * @param {Array<{reason: object, code: string, note?: string}>} rejectionReasons
 * @param {{note?: string, actor?: object, at?: Date}} [meta]
 * @returns {object} the mutated line
 */
jhatkaProcurementReceiptSchema.methods.rejectLine = function (lineIndex, rejectionReasons = [], meta = {}) {
  const line = (this.lines || [])[lineIndex];
  if (!line) throw lineDecisionError('Receipt line not found', 'LINE_NOT_FOUND');
  if (this.status === 'cancelled') {
    throw lineDecisionError('A cancelled receipt cannot be changed', 'RECEIPT_CANCELLED');
  }
  if (line.batch || line.qualityStatus === 'accepted' || line.qualityStatus === 'partially_accepted') {
    throw lineDecisionError(
      'Accepted goods cannot be rejected - reverse the batch first',
      'REVERSE_BATCH_FIRST',
      { batchId: line.batch }
    );
  }
  if (line.qualityStatus === 'rejected') {
    throw lineDecisionError('This line is already rejected', 'LINE_ALREADY_REJECTED');
  }
  if (!this.canRejectLine(lineIndex)) {
    throw lineDecisionError('This receipt line cannot be rejected', 'LINE_NOT_REJECTABLE');
  }
  if (!Array.isArray(rejectionReasons) || rejectionReasons.length === 0) {
    throw lineDecisionError('At least one rejection reason is required', 'REJECTION_REASON_REQUIRED');
  }

  const unit = line.receivedQty?.unit;
  const received = Number(line.receivedQty?.value || 0);
  line.qualityStatus = 'rejected';
  line.acceptedQty = { value: 0, unit };
  line.rejectedQty = { value: received, unit };
  line.amount = 0;
  line.rejectedValue = Math.round(Number(line.unitPrice || 0) * received);
  line.rejectionReasons = rejectionReasons;
  line.payability = 'disputed';
  if (meta.note !== undefined) line.qualityNotes = meta.note;
  line.weighedBy = meta.actor?._id;
  line.weighedByName = meta.actor?.name;
  line.weighedAt = meta.at || new Date();

  this.recalculateTotals();
  return line;
};

/**
 * Accept one pending line, normally before posting. Acceptance makes the full
 * received quantity payable and saleable.
 *
 * @param {number} lineIndex
 * @param {{note?: string, actor?: object, at?: Date}} [meta]
 * @returns {object} the mutated line
 */
jhatkaProcurementReceiptSchema.methods.acceptLine = function (lineIndex, meta = {}) {
  const line = (this.lines || [])[lineIndex];
  if (!line) throw lineDecisionError('Receipt line not found', 'LINE_NOT_FOUND');
  if (this.status !== 'draft') {
    throw lineDecisionError('Quality decisions must be made before posting', 'RECEIPT_NOT_DRAFT');
  }
  if (line.batch) {
    throw lineDecisionError(
      'Accepted goods cannot be accepted again - reverse the batch first',
      'REVERSE_BATCH_FIRST',
      { batchId: line.batch }
    );
  }
  if (line.qualityStatus !== 'pending') {
    throw lineDecisionError('This receipt line is already decided', 'LINE_ALREADY_DECIDED');
  }

  const unit = line.receivedQty?.unit;
  const received = Number(line.receivedQty?.value || 0);
  line.qualityStatus = 'accepted';
  line.acceptedQty = { value: received, unit };
  line.rejectedQty = { value: 0, unit };
  line.amount = Math.round(Number(line.unitPrice || 0) * received);
  line.rejectedValue = 0;
  line.rejectionReasons = [];
  line.payability = 'pending';
  if (meta.note !== undefined) line.qualityNotes = meta.note;
  line.weighedBy = meta.actor?._id;
  line.weighedByName = meta.actor?.name;
  line.weighedAt = meta.at || new Date();

  this.recalculateTotals();
  return line;
};

/**
 * Did this delivery fail the cold chain? The single most common real rejection.
 */
jhatkaProcurementReceiptSchema.methods.hasTemperatureFailure = function (maxIntakeC) {
  return (this.lines || []).some((l) => {
    const t = l.readings?.temperatureC;
    return typeof t === 'number' && typeof maxIntakeC === 'number' && t > maxIntakeC;
  });
};

/**
 * @typedef JhatkaProcurementReceipt
 */
const JhatkaProcurementReceipt = mongoose.model(
  'JhatkaProcurementReceipt',
  jhatkaProcurementReceiptSchema
);

module.exports = JhatkaProcurementReceipt;