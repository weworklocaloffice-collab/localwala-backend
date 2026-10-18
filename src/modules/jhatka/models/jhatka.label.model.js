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
 * JhatkaLabel — what goes on the pack. §12.3.
 *
 * ## The blueprint has no food-safety requirements at all
 *
 * `dairy-vertical` §44 lists FSSAI, GST, trade licence and supplier documents, all
 * of them about paperwork held on file. It says nothing about the LABEL on the
 * pack, which for fresh meat is what an inspector checks and what a customer reads
 * at home before deciding whether to cook it.
 *
 * ## The QR is the reason this model is not a string on the order item
 *
 * `qrTraceBatch` resolves to the batch. One scan turns "the chicken smelled odd"
 * from a phone call into a database lookup. More importantly it makes the recall
 * flow operable by an operator rather than an engineer — §5.4's reverse
 * traceability only matters if a human can get from a customer-held pack to the
 * batch, and the customer holds the pack.
 *
 * ## `packedOn` and `useBy` come from CUT time, not procurement. BR-13.
 *
 * A chicken cut this morning has 24 hours. The same chicken uncut in the chiller
 * has 48. Printing the raw life on a cut pack is how day-old meat is sold as fresh,
 * and it is the single most damaging thing this vertical can do to its own name.
 */
const LABEL_STATUSES = ['draft', 'printed', 'applied', 'void'];

const jhatkaLabelSchema = mongoose.Schema(
  {
    labelNo: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: false,
      default: undefined,
    },
    orderItem: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrderItem',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProduct',
      required: true,
    },
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaVariant',
      required: false,
      default: undefined,
    },

    // ---- the printed content ----
    productName: { type: String, required: true, trim: true },
    packSize: { type: String, required: true, trim: true },
    netQuantity: { type: String, required: true, trim: true },
    /**
     * BR-13. Packing date, from `orderItem.cutAt` — NOT from the batch's
     * `receivedAt`. This is the field that stops day-old cut meat being sold as
     * fresh.
     */
    packedOn: {
      type: Date,
      required: true,
    },
    /** Cut time plus the prepared shelf life. Frozen at creation. */
    useBy: {
      type: Date,
      required: true,
    },
    /** "Keep refrigerated below 4°C" — from the outlet's `qualityPolicy`. */
    storageInstruction: { type: String, required: true, trim: true },
    fssaiLicenceNo: { type: String, required: true, trim: true },
    outletName: { type: String, required: true, trim: true },
    outletAddress: { type: String, required: true, trim: true },
    customerCare: { type: String, required: false, trim: true },

    /**
     * BR-20. The rate printed on the pack. A statutory label states the price and
     * the tax, and both must be the ones the customer paid.
     */
    mrp: moneyField(0),
    taxInclusive: { type: Boolean, required: false, default: false },
    netWeightGrams: { type: Number, required: false },
    /** Allergen declaration. Eggs are themselves an allergen. */
    allergens: { type: [String], required: false, default: [] },
    ingredientsNote: { type: String, required: false, trim: true },

    /**
     * THE TRACEABILITY LINK.
     *
     * Scanned, this resolves the batch. Copied onto the item's `allocations[]` so a
     * label carries the batch even if the item's allocations are later edited, and
     * indexed so "which labels came from this batch" is one read.
     */
    qrTraceBatch: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    /** Batch id, for the same reason the allocation denormalises it. */
    batch: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaBatch',
      required: false,
      default: undefined,
    },
    /** The generated QR image/PDF. */
    qrImageUrl: { type: String, required: false },

    status: {
      type: String,
      required: false,
      enum: LABEL_STATUSES,
      default: 'draft',
    },
    printedAt: { type: Date, required: false },
    appliedAt: { type: Date, required: false },
    voidedAt: { type: Date, required: false },
    voidedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaLabelSchema.plugin(toJSON);
jhatkaLabelSchema.plugin(paginate);
/**
 * RECALL BY LABEL.
 *
 * "Which packs came from batch X" answered from the label collection directly,
 * rather than by walking `orderItem → order → allocation → batch`. Four hops
 * instead of one, and the one that runs when a customer is standing in front of
 * the operator holding a pack.
 */
jhatkaLabelSchema.index({ qrTraceBatch: 1 });
jhatkaLabelSchema.index({ batch: 1 });
// The prep screen: what still needs printing for this order.
jhatkaLabelSchema.index({ order: 1, status: 1 });
// One label per line.
jhatkaLabelSchema.index({ orderItem: 1 }, { unique: true });
// The expiry sweep on printed packs.
jhatkaLabelSchema.index({ useBy: 1, status: 1 });

jhatkaLabelSchema.statics.STATUSES = LABEL_STATUSES;

/**
 * Is this pack still within its use-by window?
 *
 * Checked at `PACKING` and again at dispatch. A pack printed at 11am with a 24-hour
 * life is fine at 3pm and not at 11am tomorrow, and a shift that crosses midnight
 * will print labels for the next morning's stock if nobody checks.
 */
jhatkaLabelSchema.methods.isWithinUseBy = function (now = new Date()) {
  return new Date(this.useBy) > new Date(now);
};

/**
 * Hours remaining on the pack. Negative once expired, which is the signal the
 * prep screen needs rather than a boolean.
 */
jhatkaLabelSchema.methods.hoursRemaining = function (now = new Date()) {
  return Math.round((new Date(this.useBy).getTime() - new Date(now).getTime()) / 3600000);
};

/**
 * @typedef JhatkaLabel
 */
const JhatkaLabel = mongoose.model('JhatkaLabel', jhatkaLabelSchema);

module.exports = JhatkaLabel;