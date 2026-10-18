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
 * JhatkaWastage — a distinct record, not a note on a stock movement.
 *
 * ## Why this is not just a movement with a reason
 *
 * The source blueprint's §47 promises wastage and shrinkage analytics. A movement
 * ledger records *that* quantity left a batch, but it cannot tell you *why*, and
 * the why is the entire commercial content of the number:
 *
 *   Trim on a bone-in cut     — unavoidable. A cost of doing business.
 *   Spoilage                  — a procurement or storage decision. Someone's fault.
 *   Over-preparation          — a demand-forecasting decision. Fixable.
 *   Theft loss                — an operational control failure.
 *
 * Those four are indistinguishable in a signed-delta ledger. Aggregating
 * `allocationType: 'WASTAGE'` gives one number that is useless for acting on.
 *
 * ## `orderLinked` is the number that matters commercially
 *
 * `orderLinked: true` means the waste happened after a customer had already
 * bought the meat — we over-prepared and threw it away, or they cancelled late.
 * That is a materially different cost from trim, and it is the number a manager
 * can actually act on by changing a forecast.
 *
 * ## `unitCost` is frozen at the time of loss
 *
 * Valued from the batch's purchase price, not from today's catalogue price. A
 * wastage report reconstructed with current prices is fiction.
 */
const WASTAGE_CAUSES = [
  'TRIM',
  'SPOILAGE',
  'EXPIRY',
  'OVER_PREPARATION',
  'CUSTOMER_REJECTED',
  'QUALITY_REJECTION',
  'PACKAGING_DAMAGE',
  'THEFT_LOSS',
  'OTHER',
];

/**
 * Causes that are a cost of doing business rather than a decision someone made.
 * Used for the unavoidable-vs-avoidable split on the dashboard.
 */
const INHERENT_CAUSES = ['TRIM'];
const AVOIDABLE_CAUSES = [
  'SPOILAGE',
  'EXPIRY',
  'OVER_PREPARATION',
  'PACKAGING_DAMAGE',
  'THEFT_LOSS',
];

const jhatkaWastageSchema = mongoose.Schema(
  {
    wastageNo: {
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
    kind: {
      type: String,
      required: false,
      enum: ['raw', 'prepared', 'packaging'],
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProduct',
      required: false,
      default: undefined,
    },
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaVariant',
      required: false,
      default: undefined,
    },
    /**
     * Present when the loss came off a specific batch. A count correction with no
     * batch is still a valid wastage record — it just cannot be traced back to a
     * supplier, which is itself a finding.
     */
    batch: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaBatch',
      required: false,
      default: undefined,
    },
    /**
     * Present when a specific order caused the loss. Sets `orderLinked`.
     */
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: false,
      default: undefined,
    },
    orderItem: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrderItem',
      required: false,
      default: undefined,
    },
    qty: {
      type: Number,
      required: true,
      min: 0,
    },
    unit: {
      type: String,
      required: true,
      enum: ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER', 'BAG', 'BOX', 'LABEL'],
    },
    /**
     * Cost per unit AT THE TIME OF LOSS, from the batch's purchase price.
     * moneyField, never a raw Number.
     */
    unitCost: moneyField(0),
    /**
     * `qty × unitCost`, frozen. A report must not recompute this from a price
     * table that has since changed.
     */
    estimatedValue: moneyField(0),
    cause: {
      type: String,
      required: true,
      enum: WASTAGE_CAUSES,
    },
    /**
     * True when this loss is attributable to an order we had already accepted.
     * The avoidable-versus-inherent reporting split.
     */
    orderLinked: {
      type: Boolean,
      required: false,
      default: false,
    },
    by: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    byName: {
      type: String,
      required: false,
      trim: true,
    },
    occurredAt: {
      type: Date,
      required: true,
    },
    notes: {
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
jhatkaWastageSchema.plugin(toJSON);
jhatkaWastageSchema.plugin(paginate);
jhatkaWastageSchema.index({ wastageNo: 1 }, { unique: true });
// The dashboard's "Wastage" tile and the cause breakdown.
jhatkaWastageSchema.index({ outlet: 1, occurredAt: -1 });
jhatkaWastageSchema.index({ outlet: 1, cause: 1, occurredAt: -1 });
// Order-linked loss, which is the avoidable number a manager acts on.
jhatkaWastageSchema.index({ outlet: 1, orderLinked: 1, occurredAt: -1 });
// Reverse traceability: which batches did we lose stock from, and why.
jhatkaWastageSchema.index({ batch: 1, occurredAt: -1 });
jhatkaWastageSchema.index({ product: 1, cause: 1, occurredAt: -1 });

/**
 * Classify a cause for the unavoidable-vs-avoidable split.
 *
 * `TRIM` is inherent — every bone-in cut produces it. Everything in
 * `AVOIDABLE_CAUSES` is a decision someone made and can make differently.
 * `OTHER` is deliberately classified as avoidable: an unexplained loss should
 * count against the business until it is explained, not be filed as neutral.
 *
 * @param {string} cause
 * @returns {'inherent'|'avoidable'}
 */
jhatkaWastageSchema.statics.classifyCause = function (cause) {
  if (INHERENT_CAUSES.includes(cause)) return 'inherent';
  return 'avoidable';
};

/**
 * @typedef JhatkaWastage
 */
const JhatkaWastage = mongoose.model('JhatkaWastage', jhatkaWastageSchema);

JhatkaWastage.CAUSES = WASTAGE_CAUSES;
JhatkaWastage.INHERENT_CAUSES = INHERENT_CAUSES;
JhatkaWastage.AVOIDABLE_CAUSES = AVOIDABLE_CAUSES;

module.exports = JhatkaWastage;