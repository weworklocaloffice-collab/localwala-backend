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
const { payoutDecision } = require('../utils/commercial.arithmetic');

/**
 * JhatkaSupplierPayable — LocalWala paying a supplier. §10.2.
 *
 * ## This is the template followed everywhere in the vertical
 *
 * Copied from `DairyProviderPayable`, which is the only working accounts-payable
 * engine in the repository. Four properties carried across deliberately:
 *
 *   1. **The rate is frozen at intake.** `receipts[].unitPrice` is a copy of the
 *      receipt's own. A rate change after delivery cannot restate what was owed.
 *   2. **`netAmount` is positive when the platform owes.** The same sign
 *      convention as a commission partner's statement, so the two are read the
 *      same way.
 *   3. **Only `accepted` + `payability: 'pending'` is claimable.** A rejected line
 *      is never paid for, and a paid line is never paid for twice.
 *   4. **Generation is COMPENSATABLE, not atomic.** Write the statement, claim the
 *      receipts, and void the statement if the claim fails. MongoDB is standalone
 *      in development, so `withOptionalTransaction` degrades to sequential writes
 *      and correctness has to come from compensating.
 *
 * ## Uniqueness is an INDEX, not a query
 *
 * `DairyProviderPayable` uses `{provider, 'period.from'}` unique. So does this.
 * `stores.settlement.service` queries for an existing settlement with no index
 * behind it (F-3) — two concurrent generators, two settlements, double the money.
 * That is the pattern NOT to copy.
 */
const PAYABLE_STATUSES = ['draft', 'approved', 'paid', 'disputed', 'void'];

const PAYABLE_TRANSITIONS = {
  draft: ['approved', 'disputed', 'void'],
  disputed: ['approved', 'void'],
  approved: ['paid', 'disputed', 'void'],
  paid: [],
  void: [],
};

const jhatkaSupplierPayableSchema = mongoose.Schema(
  {
    payableNo: {
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
    supplierName: { type: String, required: false, trim: true },
    period: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
      label: { type: String, required: false, trim: true },
    },

    totals: {
      receiptCount: { type: Number, required: false, default: 0, min: 0 },
      lineCount: { type: Number, required: false, default: 0, min: 0 },
      /** Accepted quantity, summed across lines. Integer, in each line's unit. */
      acceptedQty: { type: Number, required: false, default: 0 },
      rejectedQty: { type: Number, required: false, default: 0 },
      /** What we accepted, at intake rates. */
      grossAmount: moneyField(0),
      /**
       * The VALUE of what we rejected. Not deducted from `grossAmount` — the
       * rejected goods were never accepted and so were never owed for. It is
       * carried separately because "₹4,200 of deliveries rejected this week" is
       * the number that gets a supplier conversation.
       */
      rejectionDeduction: moneyField(0),
      adjustmentsTotal: moneyField(0),
      amountPaid: moneyField(0),
      /** POSITIVE when the platform owes. §10.2 sign convention. */
      netAmount: moneyField(0),
    },

    /**
     * Frozen receipt references. NOT `collection` — that is a Mongoose-reserved
     * pathname on a schema and declaring it breaks `.save()` at runtime, not at
     * build time. `DairyMilkCollection` sidesteps the same trap with
     * `sourceCollection`; `JhatkaProcurementReceipt` uses `receiptItem` for the
     * same reason.
     */
    receipts: [
      {
        _id: false,
        intake: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaProcurementReceipt',
          required: true,
        },
        receiptNo: { type: String, required: true, uppercase: true, trim: true },
        receivedAt: { type: Date, required: true },
        product: { type: mongoose.SchemaTypes.ObjectId, ref: 'JhatkaProduct', required: true },
        rawSku: { type: String, required: true, uppercase: true, trim: true },
        acceptedQty: { type: Number, required: true },
        rejectedQty: { type: Number, required: false, default: 0 },
        unit: {
          type: String,
          required: true,
          enum: ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER'],
        },
        /** FROZEN AT INTAKE. A later rate change must not restate this. */
        unitPrice: moneyField(0),
        amount: moneyField(0),
      },
    ],

    adjustments: [
      {
        _id: false,
        amount: moneyField(0),
        reason: { type: String, required: true, trim: true },
        recordedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        recordedByName: { type: String, required: false, trim: true },
        recordedAt: { type: Date, required: true },
      },
    ],

    status: {
      type: String,
      required: false,
      enum: PAYABLE_STATUSES,
      default: 'draft',
    },
    statusReason: { type: String, required: false, trim: true },
    approvedAt: { type: Date, required: false },
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    approvedByName: { type: String, required: false, trim: true },
    paidAt: { type: Date, required: false },
    paymentReference: { type: String, required: false, trim: true },

    payoutMethod: {
      type: String,
      required: false,
      enum: ['bank', 'cash'],
      default: 'bank',
    },
    /**
     * §4.3. On day one because deducting afterwards means restating statements.
     */
    tdsApplicable: { type: Boolean, required: false, default: false },
    tdsRatePercent: { type: Number, required: false, min: 0, max: 100, default: 0 },
    tdsAmount: moneyField(0),
    netPayout: moneyField(0),

    /** Compensation pointer for a voided statement. */
    voidedAt: { type: Date, required: false },
    voidedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    voidedByName: { type: String, required: false, trim: true },
    notes: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaSupplierPayableSchema.plugin(toJSON);
jhatkaSupplierPayableSchema.plugin(paginate);
jhatkaSupplierPayableSchema.index({ payableNo: 1 }, { unique: true });
/**
 * THE IDEMPOTENCY ANCHOR. Copied from `DairyProviderPayable`.
 *
 * UNIQUE on `{supplier, 'period.from'}` — one statement per supplier per period.
 * This is an index, not the query-as-lock that `stores.settlement.service` uses
 * (F-3), which permits two concurrent generations to both find nothing.
 */
jhatkaSupplierPayableSchema.index({ supplier: 1, 'period.from': 1 }, { unique: true });
// The weekly generator's hot query.
jhatkaSupplierPayableSchema.index({ outlet: 1, status: 1, 'period.from': -1 });
jhatkaSupplierPayableSchema.index({ supplier: 1, status: 1, 'period.from': -1 });
// "Which statement paid this receipt?" — a supplier dispute lookup.
jhatkaSupplierPayableSchema.index({ 'receipts.intake': 1 });
// The payable console: approved and unpaid.
jhatkaSupplierPayableSchema.index({ status: 1, createdAt: -1 });

jhatkaSupplierPayableSchema.statics.STATUSES = PAYABLE_STATUSES;
jhatkaSupplierPayableSchema.statics.PAYABLE_TRANSITIONS = PAYABLE_TRANSITIONS;

/** May this payable move from `from` to `to`? */
jhatkaSupplierPayableSchema.statics.canTransition = function (from, to) {
  const allowed = PAYABLE_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
};

/**
 * Is this statement payable now? Same floor rule as a partner payout — the two are
 * read by finance in the same screen and a ₹200 transfer to a supplier costs the
 * same as a ₹200 transfer to a partner.
 */
jhatkaSupplierPayableSchema.methods.isPayable = function (minimumNetPayout = 0) {
  return payoutDecision(this.totals.netAmount, minimumNetPayout);
};

/**
 * @typedef JhatkaSupplierPayable
 */
const JhatkaSupplierPayable = mongoose.model(
  'JhatkaSupplierPayable',
  jhatkaSupplierPayableSchema
);

module.exports = JhatkaSupplierPayable;