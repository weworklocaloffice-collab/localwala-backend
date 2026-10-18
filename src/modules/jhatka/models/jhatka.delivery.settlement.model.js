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
 * JhatkaDeliverySettlement — paying a rider for their deliveries. §10.1.
 *
 * ## The fifth money document, and it is never netted
 *
 * §10.1 keeps customer payment, supplier payable, operator payout, franchise
 * royalty and delivery settlement separate, and BR-22 forbids merging them.
 * A rider is paid what they collected plus their fee. It is not netted against a
 * supplier payable, because netting across a rider and a supplier requires both to
 * consent to a cross-contract, which is not a thing a system should do silently.
 *
 * ## BR-24 is why drivers are never deleted
 *
 * Their delivery history is this document's input. Deleting a rider destroys the
 * ability to reconcile a payout, which is why `JhatkaDriver` has no delete path at
 * all — not a soft-delete either, only `active | inactive | suspended`.
 */
const SETTLEMENT_STATUSES = ['draft', 'approved', 'paid', 'disputed', 'void'];

const SETTLEMENT_TRANSITIONS = {
  draft: ['approved', 'disputed', 'void'],
  disputed: ['approved', 'void'],
  approved: ['paid', 'disputed', 'void'],
  paid: [],
  void: [],
};

const jhatkaDeliverySettlementSchema = mongoose.Schema(
  {
    settlementNo: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    driver: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaDriver',
      required: true,
    },
    /**
     * The outlet, or null for a platform-pool rider.
     *
     * Same convention as `JhatkaDriver.outlet`: `null` means LocalWala employs this
     * rider and pays from the pool, which is a different money path from an
     * outlet-owned fleet and must be distinguishable in the ledger.
     */
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: false,
      default: null,
    },
    /**
     * Who pays this rider, frozen per delivery.
     *
     * `business_pays` for an outlet-owned fleet, `platform_pays` for the pool. An
     * outlet that changes its mode mid-day must not retroactively change who paid
     * last week's riders, so this is read from the DELIVERY, never from the outlet
     * at settlement time.
     */
    payoutMode: {
      type: String,
      required: true,
      enum: ['business_pays', 'platform_pays'],
    },
    period: {
      from: { type: Date, required: true },
      to: { type: Date, required: true },
      label: { type: String, required: false, trim: true },
    },
    totals: {
      deliveryCount: { type: Number, required: false, default: 0, min: 0 },
      successfulCount: { type: Number, required: false, default: 0, min: 0 },
      failedCount: { type: Number, required: false, default: 0, min: 0 },
      /** Cash the rider collected on the customer's behalf. NOT the rider's money. */
      codCollected: moneyField(0),
      /**
       * The accounting identity, stated as a field rather than implied:
       *
       *     codCollected = platformFeeOnCod + riderCashShare + codShortfall
       *
       * Every rupee a rider collected has to land in exactly one of those three
       * buckets. The first version of `isCashReconciled` omitted the rider's share
       * entirely, so a perfectly reconciled statement reported ₹900 unaccounted on
       * a ₹1,000 collection — which is the rider's pay, not a shortfall.
       *
       * A statement that does not balance is a conversation with the rider, and it
       * has to be a real one.
       */
      platformFeeOnCod: moneyField(0),
      /** The rider's own cut of the cash they collected. */
      riderCashShare: moneyField(0),
      /** A cash shortfall the rider has not explained. A reconciliation item. */
      codShortfall: moneyField(0),
      /** The rider's per-delivery fee, separate from their cut of the cash. */
      deliveryFeeEarned: moneyField(0),
      /** Incentive for on-time deliveries. */
      bonusEarned: moneyField(0),
      adjustments: moneyField(0),
      amountPaid: moneyField(0),
      /** POSITIVE when the platform owes the rider. Same convention as every payout. */
      netAmount: moneyField(0),
    },
    deliveries: [
      {
        _id: false,
        delivery: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaDelivery',
          required: true,
        },
        deliveryNo: { type: String, required: true, uppercase: true, trim: true },
        deliveredAt: { type: Date, required: false },
        /** Frozen at collection, so a later rate change cannot restate it. */
        codCollected: moneyField(0),
        deliveryFee: moneyField(0),
        bonus: moneyField(0),
        onTime: { type: Boolean, required: false, default: false },
        payoutMode: {
          type: String,
          required: true,
          enum: ['business_pays', 'platform_pays'],
        },
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
      enum: SETTLEMENT_STATUSES,
      default: 'draft',
    },
    statusReason: { type: String, required: false, trim: true },
    approvedAt: { type: Date, required: false },
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    approvedByName: { type: String, required: false, trim: true },
    payoutMethod: {
      type: String,
      required: false,
      enum: ['bank', 'cash', 'wallet'],
      default: 'cash',
    },
    payoutDetails: {
      accountName: { type: String, required: false, trim: true },
      accountNumber: { type: String, required: false, trim: true },
      ifsc: { type: String, required: false, trim: true, uppercase: true },
      upiId: { type: String, required: false, trim: true },
    },
    paymentReference: { type: String, required: false, trim: true },
    paidAt: { type: Date, required: false },
    voidedAt: { type: Date, required: false },
    voidedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    notes: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaDeliverySettlementSchema.plugin(toJSON);
jhatkaDeliverySettlementSchema.plugin(paginate);
jhatkaDeliverySettlementSchema.index({ settlementNo: 1 }, { unique: true });
/** One settlement per driver per period. Same anchor as the supplier payable. */
jhatkaDeliverySettlementSchema.index({ driver: 1, 'period.from': 1 }, { unique: true });
// The weekly generator.
jhatkaDeliverySettlementSchema.index({ driver: 1, status: 1, 'period.from': -1 });
jhatkaDeliverySettlementSchema.index({ outlet: 1, status: 1, 'period.from': -1 });
// "Which settlement paid this delivery?" — a COD reconciliation dispute.
jhatkaDeliverySettlementSchema.index({ 'deliveries.delivery': 1 });
// The COD-shortfall console.
jhatkaDeliverySettlementSchema.index({ 'totals.codShortfall': 1, status: 1 });

jhatkaDeliverySettlementSchema.statics.STATUSES = SETTLEMENT_STATUSES;
jhatkaDeliverySettlementSchema.statics.SETTLEMENT_TRANSITIONS = SETTLEMENT_TRANSITIONS;

/** May this settlement move from `from` to `to`? */
jhatkaDeliverySettlementSchema.statics.canTransition = function (from, to) {
  const allowed = SETTLEMENT_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
};

/**
 * Does the cash balance?
 *
 * The identity is `codCollected = platformFeeOnCod + riderCashShare +
 * codShortfall`. Every rupee collected lands in exactly one bucket.
 *
 * `riderCashShare` is the rider's own cut and it is NOT a shortfall. Omitting it —
 * which the first version did — makes a correctly-reconciled statement look like it
 * has ₹900 missing, and then somebody has a conversation with a rider who has done
 * nothing wrong.
 *
 * A tolerance of one paisa rather than exact equality, because money fields
 * round-trip through paise and three separate sums of the same rupee can land a
 * paise apart without anything being wrong.
 */
jhatkaDeliverySettlementSchema.methods.isCashReconciled = function () {
  const t = this.totals || {};
  const expected =
    Number(t.platformFeeOnCod || 0) + Number(t.riderCashShare || 0) + Number(t.codShortfall || 0);
  const actual = Number(t.codCollected || 0);
  return Math.abs(actual - expected) < 0.01;
};

/**
 * The unexplained difference, in rupees.
 *
 * Returned rather than just a boolean, because "₹50 short" is actionable and
 * "does not balance" is not. A non-zero figure is what goes into the conversation
 * with the rider.
 */
jhatkaDeliverySettlementSchema.methods.cashVariance = function () {
  const t = this.totals || {};
  const expected =
    Number(t.platformFeeOnCod || 0) + Number(t.riderCashShare || 0) + Number(t.codShortfall || 0);
  return Number((Number(t.codCollected || 0) - expected).toFixed(2));
};

/**
 * Is this a platform rider or an outlet's own?
 */
jhatkaDeliverySettlementSchema.methods.isPlatformPool = function () {
  return this.outlet === null || this.outlet === undefined;
};

/**
 * @typedef JhatkaDeliverySettlement
 */
const JhatkaDeliverySettlement = mongoose.model(
  'JhatkaDeliverySettlement',
  jhatkaDeliverySettlementSchema
);

module.exports = JhatkaDeliverySettlement;