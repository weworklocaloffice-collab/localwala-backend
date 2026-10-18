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
 * JhatkaBatchAllocation — the append-only ledger of every movement in and out of
 * a batch, and the single most important model in this vertical.
 *
 * ## Never updated. Corrections are compensating entries.
 *
 * Inherited from `DairyBatchLedger`. When wastage looks high at month end, the
 * full history of who consumed what and who wrote off what must be replayable,
 * and that is only true if rows are immutable.
 *
 * ## Why the source blueprint's §24 chain is wrong
 *
 * The blueprint draws:
 *
 *     Supplier → Procurement → Batch → Inventory → Order
 *
 * That is linear, and it is wrong in the way that matters. **One order line
 * routinely draws on more than one batch.** A customer orders 1 kg of curry cut;
 * the outlet has 900 g left from this morning and cuts the remaining 100 g from
 * yesterday's. So the batch→order relationship is many-to-many, which is why this
 * is a collection rather than a field.
 *
 * ## The two indexes that decide whether a recall is survivable
 *
 * `{ batch: 1, occurredAt: -1 }` answers the question that actually gets asked
 * under time pressure: *"batch X is compromised — who ate it?"*
 *
 * `{ orderItem: 1 }` answers the question the blueprint asks: *"which batch was
 * this order cut from?"*
 *
 * Both matter. The blueprint only implies the second, and the first is the one
 * that has to run in minutes while a food-safety officer waits.
 *
 * ## Quantities are signed from the batch's perspective
 *
 * Positive adds to the batch, negative removes. `qtyAfter` is the batch's
 * `availableQty` immediately after this entry, so any point in a batch's life can
 * be reconstructed by replaying its allocations up to that entry — which is what
 * makes a disputed quantity answerable.
 */
const ALLOCATION_TYPES = [
  'RECEIPT',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'CONSUMPTION',
  'RELEASE',
  'YIELD_SPLIT',
  'SHRINKAGE',
  'WASTAGE',
  'ADJUSTMENT',
  'TRANSFER',
  'QUALITY_REJECTION',
  'EXPIRY_WRITE_OFF',
  'RECALL_FREEZE',
];

/** Types that must never move a counter. They are records of intent or state. */
const NON_QUANTITY_TYPES = ['RESERVATION', 'RECALL_FREEZE'];

const jhatkaBatchAllocationSchema = mongoose.Schema(
  {
    batch: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaBatch',
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
    allocationType: {
      type: String,
      required: true,
      enum: ALLOCATION_TYPES,
    },
    /**
     * Signed, in the batch's unit. Negative leaves. Zero is legal and meaningful:
     * a `YIELD_SPLIT` whose two halves happen to cancel, or a `RECALL_FREEZE` that
     * changes availability without moving stock.
     */
    qtyDelta: {
      type: Number,
      required: true,
    },
    /**
     * `availableQty` immediately after this entry.
     *
     * Stored rather than derived so a disputed quantity is answerable by replay
     * without trusting any counter in the batch document.
     */
    qtyAfter: {
      type: Number,
      required: false,
    },
    /**
     * Which order line consumed this batch.
     *
     * The join field that makes the join many-to-many. A single `JhatkaOrderItem`
     * appears here more than once when it drew on more than one batch, and this is
     * the only way to know how much of each.
     */
    orderItem: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrderItem',
      required: false,
      default: undefined,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: false,
      default: undefined,
    },
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaSubscription',
      required: false,
      default: undefined,
    },
    recurringOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaRecurringOrder',
      required: false,
      default: undefined,
    },
    /** Where a write-off went, for shrinkage reporting. §5.6 */
    wasteCause: {
      type: String,
      required: false,
      enum: [
        'TRIM',
        'SPOILAGE',
        'EXPIRY',
        'OVER_PREPARATION',
        'QUALITY_REJECTION',
        'CUSTOMER_REJECTED',
        'PACKAGING_DAMAGE',
        'THEFT_LOSS',
        'OTHER',
      ],
    },
    referenceType: {
      type: String,
      required: false,
      trim: true,
    },
    referenceId: {
      type: mongoose.SchemaTypes.ObjectId,
      required: false,
      default: undefined,
    },
    note: {
      type: String,
      required: false,
      trim: true,
    },
    occurredAt: {
      type: Date,
      required: true,
    },
    occurredBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    /** Denormalised so history survives the user being deleted. §6.5 */
    occurredByName: {
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
jhatkaBatchAllocationSchema.plugin(toJSON);
jhatkaBatchAllocationSchema.plugin(paginate);

/**
 * THE RECALL INDEX.
 *
 * "Batch X is compromised, who ate it?" runs as a single indexed lookup:
 *
 *   JhatkaBatchAllocation.find({ batch: id, allocationType: 'CONSUMPTION' })
 *     .populate('orderItem', 'order customer deliveredAt')
 *
 * Without this index that is a collection scan on a collection that grows with
 * every order ever placed, executed while a food-safety officer waits. It is the
 * difference between answering the question in a second and not answering it.
 */
jhatkaBatchAllocationSchema.index({ batch: 1, occurredAt: -1 });
/**
 * The reverse direction — the one the blueprint's §24 asks for. "Which batch was
 * this order line cut from?"
 */
jhatkaBatchAllocationSchema.index({ orderItem: 1 });
// Shrinkage and wastage reports.
jhatkaBatchAllocationSchema.index({ outlet: 1, allocationType: 1, occurredAt: -1 });
// The quarantine/recall sweep.
jhatkaBatchAllocationSchema.index({ allocationType: 1, occurredAt: -1 });
// A customer's complete batch history for one order, for a support query.
jhatkaBatchAllocationSchema.index({ order: 1, occurredAt: 1 });

/**
 * @typedef JhatkaBatchAllocation
 */
const JhatkaBatchAllocation = mongoose.model(
  'JhatkaBatchAllocation',
  jhatkaBatchAllocationSchema
);

JhatkaBatchAllocation.ALLOCATION_TYPES = ALLOCATION_TYPES;
JhatkaBatchAllocation.NON_QUANTITY_TYPES = NON_QUANTITY_TYPES;

module.exports = JhatkaBatchAllocation;