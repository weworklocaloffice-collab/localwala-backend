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
 * JhatkaOrderItem — one line of a Jhatka order.
 *
 * ## Both sides of the reconciliation live here, and the requested side is frozen
 *
 * `requestedQuantity` / `estimatedAmount` are written once at placement and never
 * touched. `actualQuantity` / `finalAmount` are written once at weight confirmation
 * and never touched again. Nothing overwrites the other.
 *
 * That is the mechanical expression of BR-06: the customer's amount is fixed at
 * checkout and reconciliation moves in one direction only. It also means a disputed
 * order can be read without replaying any ledger — both numbers are on the line.
 *
 * ## `isVariableWeight` is frozen from the variant at creation
 *
 * BR-09. If it were re-read from the variant at read time, an admin changing a SKU
 * between checkout and weighing would convert a counted dozen into a weighed line
 * — after the customer had committed to a price and after stock had been reserved
 * under the other basis. Freezing it makes that impossible.
 *
 * ## This line HAS an `_id`, unlike `StoreOrderItem`
 *
 * `JhatkaBatchAllocation.orderItem` references it, and a split allocation across
 * two batches (BR-10) points at the same line twice. A line without an identity
 * cannot be pointed at. That is the concrete cost of the blueprint's linear
 * `Batch → Order` chain, and it is why this model keeps its `_id`.
 *
 * ## Separate file from the model
 *
 * `JhatkaOrder` nests this inside `items[]`, and Mongoose rejects an array of
 * MODELS with "`model` is not a valid type within the array `items`". The array
 * needs a SCHEMA. Keeping the schema in its own file and exporting it is what
 * lets the parent embed it without the two definitions drifting apart.
 */
const jhatkaOrderItemSchema = mongoose.Schema(
  {
    // ---- catalogue snapshot: frozen, because the catalogue is admin-editable ----
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProduct',
      required: true,
    },
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaVariant',
      required: true,
    },
    sku: {
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
    variantName: {
      type: String,
      required: false,
      trim: true,
    },
    image: {
      type: String,
      required: false,
    },
    categorySnapshot: {
      type: String,
      required: false,
      trim: true,
    },
    /** BR-20. Frozen onto the line. Never re-resolved at render time. */
    hsnCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    taxRatePct: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    taxPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    taxAmount: moneyField(0),

    // ---- BR-09: the fork, frozen at creation ----
    isVariableWeight: {
      type: Boolean,
      required: true,
    },
    measurementMode: {
      type: String,
      required: true,
      enum: ['WEIGHT', 'COUNT'],
    },
    unitLabel: {
      type: String,
      required: true,
      trim: true,
    },

    // ---- pricing, frozen ----
    unitPrice: moneyField(0),
    priceBasis: {
      type: String,
      required: true,
      enum: ['per_kg', 'per_g', 'per_piece', 'per_dozen', 'per_pack', 'per_tier'],
    },
    discountAmount: moneyField(0),
    /**
     * `unitPrice × quantity − discountAmount`, floored. Pre-tax.
     *
     * Computed once and stored. Recomputing it later from `unitPrice` and
     * `discountAmount` is how a refunded line and an invoiced line disagree by a
     * paisa — and it is exactly the shape of the stores refund defect (F-5, a
     * double-subtracted discount).
     */
    lineTotal: moneyField(0),
    /** `lineTotal + taxAmount`. What the customer sees on this line. */
    lineGrand: moneyField(0),

    // ---- the requested side. IMMUTABLE after placement. ----
    requestedQuantity: {
      type: quantitySchema,
      required: true,
    },
    /**
     * What the customer was charged for this line at checkout — the number they
     * agreed to pay and the ceiling they can never be charged above.
     */
    estimatedAmount: moneyField(0),

    // ---- the actual side. Written once, by the weigh screen. ----
    actualQuantity: {
      type: quantitySchema,
      required: false,
      default: undefined,
    },
    actualUnitPrice: moneyField(0),
    /**
     * `actualQuantity × unitPrice`. An INTERNAL number.
     *
     * The customer still pays `estimatedAmount`. This exists so the variance is
     * measurable, so a repeated +8% from one outlet becomes visible, and so COGS can
     * be valued at what was actually prepared rather than what was ordered.
     */
    finalAmount: moneyField(0),
    /**
     * `finalAmount − estimatedAmount`. POSITIVE means the outlet over-delivered.
     *
     * Stored SIGNED because the sign is the decision: positive is absorbed,
     * negative is refunded. Splitting into `absorbedAmount` and `refundedAmount`
     * would lose the ability to ask "did this outlet systematically over-weigh?",
     * which is the only fraud question that matters here.
     */
    deltaAmount: moneyField(0),
    /** Which branch of `reconcileWeight` was taken — the audit record. */
    adjustmentDirection: {
      type: String,
      required: false,
      enum: ['none', 'absorbed', 'refund_required', 'override_required'],
    },
    /** What the platform ate. BR-06: charged to nobody. */
    absorbedAmount: moneyField(0),
    refundedAmount: moneyField(0),
    /** `actual − requested`, for analytics without re-deriving from ratios. */
    varianceGrams: {
      type: Number,
      required: false,
      default: undefined,
    },
    variancePct: {
      type: Number,
      required: false,
      default: undefined,
    },
    withinTolerance: {
      type: Boolean,
      required: false,
      default: undefined,
    },

    /**
     * §3.4. Above the outlet's `requireWeightEvidencePhotoAbove`, the confirm
     * button also demands a photo of the packed bag and its weigh ticket.
     *
     * Not enforced here: it depends on the order total and the outlet config,
     * neither of which lives on this line, so the check is in the service.
     */
    weightEvidence: {
      photoUrl: { type: String, required: false },
      ticketNo: { type: String, required: false, trim: true },
      ticketPhotoUrl: { type: String, required: false },
      capturedAt: { type: Date, required: false },
      deviceId: { type: String, required: false, trim: true },
    },
    /**
     * BR-08. Present ONLY when a manager overrode the hard cap.
     *
     * `by` AND `byName` are both stored because the name must survive the user
     * being deleted: "who signed off on a 12% over-charge" has to remain
     * answerable years later, and a dangling ObjectId is not an answer.
     */
    override: {
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      byName: { type: String, required: false, trim: true },
      reason: { type: String, required: false, trim: true },
      at: { type: Date, required: false },
    },

    // ---- BR-11: provenance ----
    /** Raw SKU this line was cut from. Null for an uncut whole sale. */
    rawSku: { type: String, required: false, uppercase: true, trim: true },
    yieldSpec: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaYieldSpec',
      required: false,
      default: undefined,
    },
    /**
     * Denormalised from `JhatkaBatchAllocation` so an operations manager looking at
     * an order does not need a second query to see which batch it came from. The
     * allocation collection stays the source of truth; this is a display copy,
     * written in the same transaction as the allocation.
     */
    allocations: [
      {
        _id: false,
        batch: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaBatch',
          required: true,
        },
        qty: {
          type: Number,
          required: true,
        },
        allocatedAt: {
          type: Date,
          required: true,
        },
      },
    ],

    // ---- preparation ----
    prepNotes: { type: String, required: false, trim: true },
    storageNotes: { type: String, required: false, trim: true },
    allergens: { type: [String], default: [] },
    packingNote: { type: String, required: false, trim: true },
    /** BR-13. Set when cut, so `useByAt` is counted from CUT time. */
    cutAt: { type: Date, required: false },
    useByAt: { type: Date, required: false, default: undefined },

    fulfilment: {
      type: String,
      required: false,
      enum: [
        'pending',
        'preparing',
        'prepared',
        'weighed',
        'partial',
        'unavailable',
        'substituted',
        'cancelled',
      ],
      default: 'pending',
    },
    substituteVariant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaVariant',
      required: false,
      default: undefined,
    },
    resolution: { type: String, required: false, trim: true },
    resolutionNote: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaOrderItemSchema.plugin(toJSON);
jhatkaOrderItemSchema.plugin(paginate);
// The prep screen: which lines still need weighing?
jhatkaOrderItemSchema.index({ isVariableWeight: 1, fulfilment: 1 });
// Cold chain: lines whose `useByAt` has passed must not be handed over.
jhatkaOrderItemSchema.index({ useByAt: 1 });

/**
 * VW-01 at line level: the customer's charge can only ever go DOWN.
 *
 * True by construction — no field can express a charge above `estimatedAmount` —
 * and the method makes it checkable without replaying a refund ledger.
 */
jhatkaOrderItemSchema.methods.customerChargeIsNotAboveEstimate = function () {
  return Number(this.finalAmount || 0) <= Number(this.estimatedAmount || 0);
};

/**
 * Has this line been weighed? The gate VW-08 turns into a route guard.
 */
jhatkaOrderItemSchema.methods.isWeighed = function () {
  return this.isVariableWeight === true && !!this.actualQuantity;
};

/**
 * @typedef JhatkaOrderItem
 */
const JhatkaOrderItem = mongoose.model('JhatkaOrderItem', jhatkaOrderItemSchema);

module.exports = JhatkaOrderItem;
module.exports.schema = jhatkaOrderItemSchema;