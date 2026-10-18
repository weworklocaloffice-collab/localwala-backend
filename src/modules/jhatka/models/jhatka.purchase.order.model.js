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
 * JhatkaPurchaseOrder — what we ASKED a supplier for.
 *
 * ## Kept separate from the receipt, on purpose
 *
 * A purchase order is an intention. A receipt is a fact. Merging them means the
 * quantities become whatever arrived and the order of what was expected is lost,
 * which is the number a buyer needs when a supplier short-delivers for the third
 * time this week.
 *
 * `shortfallQty` on the receipt is computed against the order. That comparison is
 * the whole reason the two documents exist.
 *
 * ## Status
 *
 * `draft → placed → partially_received → received → closed`, with `cancelled`
 * from any pre-receipt state. Once anything has been received the order is not
 * cancellable — cancelling it would orphan received stock.
 *
 * The guard is in `jhatka.procurement.service`, and this model's comment says so,
 * because a status field with no stated enforcement reads as decorative.
 */
const PO_STATUSES = ['draft', 'placed', 'partially_received', 'received', 'closed', 'cancelled'];

const jhatkaPurchaseOrderSchema = mongoose.Schema(
  {
    poNo: {
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
    status: {
      type: String,
      required: false,
      enum: PO_STATUSES,
      default: 'draft',
    },
    lines: [
      {
        _id: false,
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
        orderedQty: {
          type: Number,
          required: true,
          min: 0,
        },
        unit: {
          type: String,
          required: true,
          enum: ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER'],
        },
        /**
         * The agreed rate, frozen at order placement.
         *
         * §5.3 Rule A: a later rate change must not restate a delivery. The
         * receipt snapshots its own rate regardless, but freezing here as well
         * means a short-delivery conversation has a documented expected price.
         */
        unitPrice: moneyField(0),
        lineTotal: moneyField(0),
        /** Sum of accepted quantities across receipts against this line. */
        receivedQty: {
          type: Number,
          required: false,
          default: 0,
          min: 0,
        },
        /** The gap. The number the buyer actually wants. */
        shortfallQty: {
          type: Number,
          required: false,
          default: 0,
          min: 0,
        },
        note: { type: String, required: false, trim: true },
      },
    ],
    totals: {
      lineCount: { type: Number, required: false, default: 0, min: 0 },
      orderedValue: moneyField(0),
      receivedValue: moneyField(0),
    },
    expectedAt: {
      type: Date,
      required: false,
    },
    placedAt: {
      type: Date,
      required: false,
    },
    closedAt: {
      type: Date,
      required: false,
    },
    /** Free-text instruction shown to the supplier's driver. */
    instructions: {
      type: String,
      required: false,
      trim: true,
    },
    /**
     * Cancel is blocked once anything is received. Enforced in
     * `jhatka.procurement.service.assertPurchaseOrderTransition`.
     */
    cancellation: {
      cancelledAt: { type: Date, required: false },
      cancelledBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      reason: { type: String, required: false, trim: true },
    },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    createdByName: { type: String, required: false, trim: true },
    /** The receipt(s) posted against this order. */
    receipts: [
      {
        _id: false,
        receipt: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaProcurementReceipt',
          required: true,
        },
        postedAt: { type: Date, required: true },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaPurchaseOrderSchema.plugin(toJSON);
jhatkaPurchaseOrderSchema.plugin(paginate);
jhatkaPurchaseOrderSchema.index({ poNo: 1 }, { unique: true });
// The supplier's order book, and the buyer's open-orders view.
jhatkaPurchaseOrderSchema.index({ supplier: 1, status: 1, createdAt: -1 });
jhatkaPurchaseOrderSchema.index({ outlet: 1, status: 1, createdAt: -1 });
// "What did we order from this supplier last week, and what arrived?"
jhatkaPurchaseOrderSchema.index({ supplier: 1, placedAt: -1 });
jhatkaPurchaseOrderSchema.index({ 'receipts.receipt': 1 });

jhatkaPurchaseOrderSchema.statics.STATUSES = PO_STATUSES;

/** Is this order still open to further receipts? */
jhatkaPurchaseOrderSchema.methods.isOpen = function () {
  return ['draft', 'placed', 'partially_received'].includes(this.status);
};

/**
 * May this order be cancelled?
 *
 * False once anything has been received — cancelling then would orphan received
 * stock against a cancelled order, and the batch trace would have nowhere to
 * point.
 */
jhatkaPurchaseOrderSchema.methods.canCancel = function () {
  if (['received', 'closed', 'cancelled'].includes(this.status)) return false;
  const anyReceived = (this.lines || []).some((l) => (l.receivedQty || 0) > 0);
  return !anyReceived;
};

/**
 * Total shortfall across all lines. The buyer's single most-watched number for a
 * supplier they are about to suspend.
 */
jhatkaPurchaseOrderSchema.methods.totalShortfall = function () {
  return (this.lines || []).reduce((sum, l) => sum + (l.shortfallQty || 0), 0);
};

/**
 * @typedef JhatkaPurchaseOrder
 */
const JhatkaPurchaseOrder = mongoose.model('JhatkaPurchaseOrder', jhatkaPurchaseOrderSchema);

module.exports = JhatkaPurchaseOrder;