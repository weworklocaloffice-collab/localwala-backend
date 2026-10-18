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
 * JhatkaSettlement — the platform's own monthly view. §10.5.
 *
 * ## A REPORTING document, not a payment instruction
 *
 * This is the distinction that matters and it is why this model is separate from
 * `JhatkaSupplierPayable` and `JhatkaOperatorPayout`. A payable says "pay this
 * supplier £4,200". A settlement says "in September we collected £840,000, paid
 * suppliers £512,000, paid operators £96,000, wasted £18,000, and our contribution
 * margin was £214,000".
 *
 * Nothing is ever paid from this document. It exists so the four or five people
 * who need the number can read it without an analyst running a query.
 *
 * ## Contribution margin, itemised
 *
 * The order of the deductions is the whole point. `grossOrderValue` is what
 * customers paid. Then COGS, then wastage, then payouts, then delivery. The
 * resulting `contributionMargin` is what the business actually made, and it is a
 * different number from `grossOrderValue` by a lot.
 *
 * `absorbedOverchargeTotal` sits between gross revenue and margin because it is
 * real money that came in and then went back out again under BR-06 — omitting it
 * would overstate margin by exactly the amount of every over-delivery.
 *
 * ## Not a ledger
 *
 * There is no entry-line double-entry structure here, and that is a deliberate
 * scope decision. The real estate plan §4.3 proposes an append-only
 * `RealEstateLedgerEntry`; here the source documents (`JhatkaOrder`,
 * `JhatkaWastage`, `JhatkaSupplierPayable`, `JhatkaOperatorPayout`) ARE the
 * ledger, each individually auditable, and this document is a frozen roll-up of
 * them. Building a second ledger before the vertical has a single agreed set of
 * source records would produce two answers to the same question.
 */
const SETTLEMENT_GRANULARITIES = ['outlet', 'partner', 'business', 'platform'];

const jhatkaSettlementSchema = mongoose.Schema(
  {
    settlementNo: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    vertical: {
      type: String,
      required: false,
      default: 'jhatka',
    },
    /** Exactly one of these is set, matching `granularity`. */
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: false,
      default: undefined,
    },
    partner: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaPartner',
      required: false,
      default: undefined,
    },
    franchise: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaFranchise',
      required: false,
      default: undefined,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: false,
      default: undefined,
    },
    businessModel: {
      type: String,
      required: false,
      enum: ['direct', 'franchise', 'commission_partner'],
    },
    granularity: {
      type: String,
      required: true,
      enum: SETTLEMENT_GRANULARITIES,
    },
    period: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
      label: { type: String, required: false, trim: true },
    },

    totals: {
      orderCount: { type: Number, required: false, default: 0, min: 0 },
      /** What customers were charged. Before refunds and before weight adjustments. */
      grossOrderValue: moneyField(0),
      /** The weight adjustments that came back out. Negative in effect. */
      weightAdjustmentTotal: moneyField(0),
      /**
       * Upward variance the platform absorbed under BR-06. Real money in, real
       * money back out, charged to nobody. Its own line because omitting it
       * overstates margin by exactly the cost of every over-delivery.
       */
      absorbedOverchargeTotal: moneyField(0),
      discountTotal: moneyField(0),
      /** Statutory. Not revenue, shown separately so it is never counted as such. */
      taxCollected: moneyField(0),
      deliveryFeeCollected: moneyField(0),
      packagingFeeCollected: moneyField(0),
      /** Net customer receipts after refunds. The top line of the margin walk. */
      netCustomerCollections: moneyField(0),

      /** Accepted raw material at intake cost. */
      cogsTotal: moneyField(0),
      /** §5.6. Split inherent/avoidable, because they are different problems. */
      wastageTotal: moneyField(0),
      wastageInherent: moneyField(0),
      wastageAvoidable: moneyField(0),

      operatorPayoutTotal: moneyField(0),
      supplierPayableTotal: moneyField(0),
      deliveryCostTotal: moneyField(0),
      tdsDeductedTotal: moneyField(0),

      /**
       * What the platform keeps before delivery costs and overheads. This is the
       * number a business owner actually wants.
       */
      platformGrossRevenue: moneyField(0),
      platformNetRevenue: moneyField(0),
      /**
       * After delivery. The bottom line.
       *
       * Computed in `commercial.arithmetic.contributionMargin`, never as a
       * difference of two stored totals — a subtraction of accumulated money
       * fields is where a 100× drift hides.
       */
      contributionMargin: moneyField(0),
      contributionMarginPct: { type: Number, required: false, default: 0 },
    },

    items: [
      {
        _id: false,
        outlet: { type: mongoose.SchemaTypes.ObjectId, ref: 'JhatkaOutlet', required: true },
        businessModel: {
          type: String,
          required: false,
          enum: ['direct', 'franchise', 'commission_partner'],
        },
        orderCount: { type: Number, required: false, default: 0 },
        grossOrderValue: moneyField(0),
        cogs: moneyField(0),
        wastage: moneyField(0),
        refund: moneyField(0),
        operatorPayout: moneyField(0),
        supplierPayable: moneyField(0),
        deliveryCost: moneyField(0),
        contributionMargin: moneyField(0),
      },
    ],

    /**
     * FROZEN. Every figure above was computed from these source documents at
     * finalisation time. If a source is corrected afterwards the settlement is
     * NOT recomputed — it is disputed and reissued, so a figure somebody already
     * acted on does not silently change underneath them.
     */
    sourceRefs: {
      orders: { type: Number, required: false, default: 0, min: 0 },
      wastageRecords: { type: Number, required: false, default: 0, min: 0 },
      supplierPayables: { type: Number, required: false, default: 0, min: 0 },
      operatorPayouts: { type: Number, required: false, default: 0, min: 0 },
      computedAt: { type: Date, required: false },
    },

    status: {
      type: String,
      required: false,
      enum: ['draft', 'finalised', 'disputed'],
      default: 'draft',
    },
    finalisedAt: { type: Date, required: false },
    finalisedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    finalisedByName: { type: String, required: false, trim: true },
    disputedAt: { type: Date, required: false },
    disputedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    disputeReason: { type: String, required: false, trim: true },
    /** A reissue supersedes rather than overwrites. §10.5 */
    supersedes: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaSettlement',
      required: false,
      default: undefined,
    },
    notes: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaSettlementSchema.plugin(toJSON);
jhatkaSettlementSchema.plugin(paginate);
jhatkaSettlementSchema.index({ settlementNo: 1 }, { unique: true });
// One settlement per subject per period per granularity. Partial on non-void so a
// reissue can coexist with the document it supersedes — see F-3's lesson about
// query-as-lock instead of an index.
jhatkaSettlementSchema.index(
  { granularity: 1, outlet: 1, partner: 1, business: 1, 'period.from': 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['draft', 'finalised'] } },
    name: 'one_live_settlement_per_subject_and_period',
  }
);
// The margin report.
jhatkaSettlementSchema.index({ granularity: 1, 'period.from': -1 });
jhatkaSettlementSchema.index({ businessModel: 1, 'period.from': -1 });
jhatkaSettlementSchema.index({ status: 1, 'period.from': -1 });

jhatkaSettlementSchema.statics.GRANULARITIES = SETTLEMENT_GRANULARITIES;

/**
 * Is this document final?
 *
 * A finalised settlement is a number somebody has already used. A correction does
 * not change it; it disputes and supersedes it.
 */
jhatkaSettlementSchema.methods.isFinal = function () {
  return this.status === 'finalised';
};

/**
 * @typedef JhatkaSettlement
 */
const JhatkaSettlement = mongoose.model('JhatkaSettlement', jhatkaSettlementSchema);

module.exports = JhatkaSettlement;