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
 * JhatkaOrder — the order aggregate.
 *
 * ## The one invariant worth stating at the top
 *
 *   **`finalTotal <= estimatedTotal`, always.**
 *
 * BR-06 is that the customer is never charged above their estimate. This model
 * enforces it structurally: both totals are frozen at checkout, and the only
 * field that moves afterwards is `weightAdjustmentTotal`, which is signed and only
 * ever negative. There is no code path that writes a positive adjustment, so the
 * invariant holds without anyone checking it.
 *
 * It is stated here anyway because it is the single property a reviewer should
 * read this file to confirm, and because it is asserted by name in
 * `verify.jhatka.variableweight.js` as VW-01.
 *
 * ## Two deliberate absences in `ORDER_TRANSITIONS`
 *
 * `PREPARING` and `PICKED_UP` have no `CANCELLED`. The meat is cut in the first
 * case and on the road in the second. That is BR-18, and §3.3's refund-only
 * discipline is what makes it defensible — the customer has already paid an amount
 * that will be refunded, so there is no surprise, and refusing the cancellation is
 * about not throwing away a customer's paid-for chicken.
 *
 * ## `ON_HOLD` exists because four states need it
 *
 * An order whose prepared stock came from a batch that has since been quarantined
 * has no state to move to in the source blueprint's §17. It is not a cancellation
 * and not a rejection — it is a food-safety stop. It requires a `holdReason`, it
 * starts an SLA clock, and the 10-minute `escalateStuckOnHold` cron escalates
 * anything past `holdTimeoutMinutes`. A hold that quietly sits there is a paid
 * order nobody is delivering.
 */
const ORDER_LIFECYCLE = [
  'CREATED',
  'PAYMENT_PENDING',
  'PAID',
  'OUTLET_RECEIVED',
  'ACCEPTED',
  'PREPARING',
  'WEIGHING',
  'WEIGHT_CONFIRMED',
  'PACKING',
  'READY',
  'DRIVER_ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
  'PAYMENT_FAILED',
  'REFUND_PENDING',
  'REFUNDED',
  'ON_HOLD',
];

const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'partially_refunded', 'refunded'];

const jhatkaOrderSchema = mongoose.Schema(
  {
    orderNo: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    /** Denormalised from the outlet for the settlement generator's hot query. */
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    /** Denormalised from the outlet. See `JhatkaOutlet` header on denormalisation. */
    businessModel: {
      type: String,
      required: true,
      enum: ['direct', 'franchise', 'commission_partner'],
    },
    /** Present when this order came from a recurring subscription occurrence. */
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
    /** blueprint §8: `delivery` or `pickup`. OD-12 — pickup is Phase 12+. */
    fulfilmentMode: {
      type: String,
      required: false,
      enum: ['delivery', 'pickup'],
      default: 'delivery',
    },

    lifecycle: {
      type: String,
      required: true,
      enum: ORDER_LIFECYCLE,
      default: 'CREATED',
    },

    // ---- money. frozen at checkout, reconciled downward only ----
    /**
     * The nested SCHEMA, not a model. Mongoose rejects an array of models with
     * "`model` is not a valid type within the array `items`" — the array needs a
     * schema. `.schema` is taken from the item module's own export so the embedded
     * definition and the registered model can never drift apart.
     */
    items: [require('./jhatka.order.item.schema').schema],

    /** Sum of `lineTotal` before tax. Frozen. */
    itemsSubtotal: moneyField(0),
    /**
     * Sum of negative `deltaAmount` across items. NEGATIVE OR ZERO, always.
     *
     * There is no field for an upward adjustment, because there is no upward
     * adjustment. `JhatkaOrderItem.absorbedAmount` carries that information for
     * analytics without it ever becoming a customer charge.
     */
    weightAdjustmentTotal: moneyField(0),
    /** Informational. What the platform ate. Charged to nobody. */
    absorbedOverchargeTotal: moneyField(0),
    itemDiscountTotal: moneyField(0),
    taxTotal: moneyField(0),
    deliveryTax: moneyField(0),
    deliveryFee: moneyField(0),
    packagingFee: moneyField(0),
    serviceFee: moneyField(0),
    discountTotal: moneyField(0),
    promo: {
      code: { type: String, required: false, trim: true },
      type: { type: String, required: false, trim: true },
      discountAmount: moneyField(0),
    },
    coupon: {
      code: { type: String, required: false, trim: true },
      discountAmount: moneyField(0),
    },
    /**
     * What the customer paid at checkout. FROZEN. This is the number every
     * adjustment is measured against, and the ceiling they can never exceed.
     */
    estimatedTotal: moneyField(0),
    /**
     * `estimatedTotal` minus settled refunds. FROZEN and only ever lower.
     *
     * Named `finalTotal` rather than `actualTotal` because it is not "what the
     * meat weighed up to" — that is `items[].finalAmount`. This is what the customer
     * owes, and BR-06 says it never rises.
     */
    finalTotal: moneyField(0),
    /** COD path. What the rider collects: `min(ceiling, actual)`. §3.6. */
    codAmount: moneyField(0),
    codCollectionAmount: moneyField(0),
    paidAmount: moneyField(0),
    refundedAmount: moneyField(0),

    paymentMode: {
      type: String,
      required: false,
      enum: ['gateway', 'cod'],
      default: 'gateway',
    },
    paymentStatus: {
      type: String,
      required: false,
      enum: PAYMENT_STATUSES,
      default: 'pending',
    },
    payment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentInitiation',
      required: false,
    },

    /**
     * Delivery OTP — the code the rider must be given at the door. §15.2
     * `POST /orders/:order/otp`.
     *
     * ## The code is HASHED, and that is the whole point
     *
     * `codeHash` is a SHA-256 of the code, never the code itself. A plain stored OTP
     * is a plain stored PIN: anyone who reads the collection — a backup, a log, a
     * support query — can hand over a parcel they are not entitled to. Hashing a
     * 6-digit code does not make it unguessable (a million possibilities is nothing
     * to an offline hash), which is exactly why `maxAttempts` and `expiresAt` exist and
     * why the rider is rate-limited by the attempts counter rather than by the secret.
     *
     * ## It is OPTIONAL and defaults to off
     *
     * Forcing every order through an OTP would lock out every customer who cannot read
     * a code off a phone screen while holding a bag of chicken, and the failure mode of
     * that is a parcel that cannot be handed over at all. It is a defence for the
     * customer who wants one, not a tax on the customer who does not.
     */
    deliveryOtp: {
      type: new mongoose.Schema(
        {
          codeHash: { type: String, required: true },
          /** Revealed ONCE, at generation. Never returned by a read endpoint. */
          issuedAt: { type: Date, required: false, default: Date.now },
          expiresAt: { type: Date, required: true },
          verifiedAt: { type: Date, required: false },
          verifiedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
          /** Brute-force brake. Reset only when a fresh code is issued. */
          attempts: { type: Number, required: false, default: 0, min: 0 },
          maxAttempts: { type: Number, required: false, default: 5 },
        },
        { _id: false }
      ),
      required: false,
      default: undefined,
    },
    paymentRef: {
      type: String,
      required: false,
      trim: true,
    },
    paidAt: {
      type: Date,
      required: false,
    },
    /** `paymentFrom: 'jhatka_order'` on the `PaymentInitiation`. */
    paymentFrom: {
      type: String,
      required: false,
      default: 'jhatka_order',
    },

    // ---- BR-20: tax snapshot ----
    /**
     * Frozen at checkout. A refund reads `ratePct` from HERE, never from
     * `TaxConfiguration` — that table is effective-dated and will change, and an
     * order whose tax restates itself after payment cannot produce a correct
     * invoice.
     */
    taxSnapshot: {
      code: { type: String, required: false, trim: true },
      ratePct: { type: Number, required: false, min: 0, max: 100 },
      version: { type: Number, required: false },
      resolvedAt: { type: Date, required: false },
      /**
       * Intra-state → CGST + SGST; inter-state → IGST. Stored rather than derived
       * because a tax invoice is a statutory document and a retrospective split
       * after filings are submitted is a correction, not a feature.
       */
      split: {
        cgst: moneyField(0),
        sgst: moneyField(0),
        igst: moneyField(0),
        isInterState: { type: Boolean, required: false, default: false },
      },
    },
    /**
     * The invoice/seller identity. BR-05: LocalWala is Merchant of Record for ALL
     * three business models, so this is LocalWala in every case — the field exists
     * because OD-02 may reverse that, and restating settled invoices is expensive.
     */
    merchantOfRecord: {
      name: { type: String, required: false, trim: true },
      gstin: { type: String, required: false, trim: true, uppercase: true },
      entity: {
        type: String,
        required: false,
        default: 'LOCALWALA',
        enum: ['LOCALWALA', 'FRANCHISEE', 'PARTNER'],
      },
    },
    /** Shown on the invoice as the branch. OD-05 needs a business answer. */
    outletSnapshot: {
      outletCode: { type: String, required: false, trim: true },
      name: { type: String, required: false, trim: true },
      address: { type: String, required: false, trim: true },
      fssaiLicenceNo: { type: String, required: false, trim: true },
    },

    // ---- addresses ----
    addressSnapshot: {
      type: mongoose.SchemaTypes.Mixed,
      required: false,
    },
    address: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserAddress',
      required: false,
    },
    instructions: {
      customerNote: { type: String, required: false, trim: true },
      outletNote: { type: String, required: false, trim: true },
    },

    // ---- preparation ----
    preparation: {
      startedAt: { type: Date, required: false },
      startedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      completedAt: { type: Date, required: false },
      completedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      ticketRefs: [
        {
          _id: false,
          ticket: {
            type: mongoose.SchemaTypes.ObjectId,
            ref: 'JhatkaPreparationTicket',
            required: true,
          },
        },
      ],
    },
    packing: {
      completedAt: { type: Date, required: false },
      completedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      packageCount: { type: Number, required: false, default: 0 },
      totalWeightGrams: { type: Number, required: false, default: 0 },
      /**
       * BR-12. `withinBand: false` at packing time BLOCKS dispatch — fresh meat
       * above 4 °C is unsafe and this is the point at which it is still fixable.
       */
      coldChain: {
        packingTempC: { type: Number, required: false },
        at: { type: Date, required: false },
        by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        withinBand: { type: Boolean, required: false, default: undefined },
        breachReason: { type: String, required: false, trim: true },
      },
      fragile: { type: Boolean, required: false, default: false },
      specialHandling: { type: String, required: false, trim: true },
      note: { type: String, required: false, trim: true },
    },

    delivery: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaDelivery',
      required: false,
      default: undefined,
    },
    deliveryAddressSnapshot: {
      type: mongoose.SchemaTypes.Mixed,
      required: false,
    },

    // ---- exceptions ----
    cancellation: {
      cancelledAt: { type: Date, required: false },
      cancelledBy: {
        type: String,
        required: false,
        enum: ['customer', 'outlet', 'admin', 'system'],
      },
      cancelledByUserId: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      reason: { type: String, required: false, trim: true },
      reasonCategory: {
        type: String,
        required: false,
        enum: [
          'customer_request',
          'out_of_stock',
          'outlet_closed',
          'payment_failed',
          /**
           * The payment was never COMPLETED — the customer walked away, or the
           * checkout timed out. Distinct from `payment_failed`, which means a gateway
           * gave a definitive refusal.
           *
           * They are different commercial facts and the settlement treats them
           * differently: a decline is a customer who tried and could not, which is
           * worth a retry offer; an abandonment is demand that never materialised,
           * which is a conversion problem. Collapsing them makes both unreadable.
           */
          'payment_timeout',
          'delivery_unavailable',
          'quality_issue',
          'other',
        ],
      },
      /**
       * The lifecycle value at the moment of cancellation. Recorded even when the
       * cancellation was ALLOWED, because "was it allowed at this stage" must be
       * answerable after the fact — stores' `cancellationWindowHours` is declared
       * and read by nothing (F-6), and this is the field that avoids repeating it.
       */
      stage: { type: String, required: false },
      refundAmount: moneyField(0),
      refundMethod: {
        type: String,
        required: false,
        // `original_payment` means the money goes back the way it came — the gateway
        // for an online order, the rider's reduced collection for COD. There is no
        // separate `gateway` value because the ORDER does not know which provider that
        // is; the `JhatkaRefund` it raises resolves that from the initiation.
        enum: ['original_payment', 'wallet', 'store_credit', 'none'],
      },
      refundReference: { type: String, required: false, trim: true },
      refundedAt: { type: Date, required: false },
    },
    /**
     * §8.2. Requires a `reason`, starts the SLA clock, and escalates via cron.
     * Enterable from four lifecycle states — which is exactly why it needs a
     * timeout rather than operator discipline.
     */
    hold: {
      onHoldAt: { type: Date, required: false },
      reason: { type: String, required: false, trim: true },
      batch: { type: mongoose.SchemaTypes.ObjectId, ref: 'JhatkaBatch', required: false },
      releasedAt: { type: Date, required: false },
      releasedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      escalatedAt: { type: Date, required: false },
    },

    // ---- timestamps ----
    placedAt: { type: Date, required: false },
    acceptedAt: { type: Date, required: false },
    weightConfirmedAt: { type: Date, required: false },
    readyAt: { type: Date, required: false },
    pickedUpAt: { type: Date, required: false },
    deliveredAt: { type: Date, required: false },
    completedAt: { type: Date, required: false },
    promisedDeliveryAt: { type: Date, required: false },
    promisedWeightGrams: { type: Number, required: false, default: 0 },
    totalItems: { type: Number, required: false, default: 0 },
    totalQuantity: { type: Number, required: false, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaOrderSchema.plugin(toJSON);
jhatkaOrderSchema.plugin(paginate);
jhatkaOrderSchema.index({ orderNo: 1 }, { unique: true });
// The outlet order dashboard. blueprint §18: New / Accepted / Preparing /
// Weighing / Packing / Ready / Delivery / Completed, all from one column.
jhatkaOrderSchema.index({ outlet: 1, lifecycle: 1, createdAt: -1 });
// The customer's order list.
jhatkaOrderSchema.index({ customer: 1, createdAt: -1 });
// The settlement generator's hot query: delivered orders for an outlet in a period.
jhatkaOrderSchema.index({ outlet: 1, lifecycle: 1, deliveredAt: -1 });
// The partner payout generator, grouped by business model.
jhatkaOrderSchema.index({ business: 1, businessModel: 1, lifecycle: 1, createdAt: -1 });
// Subscription occurrences.
jhatkaOrderSchema.index({ subscription: 1, createdAt: -1 });
// The `escalateStuckOnHold` cron. Partial: only held orders carry a reason, so the
// index stays small however many completed orders accumulate.
jhatkaOrderSchema.index({ lifecycle: 1, 'hold.onHoldAt': 1 });
// Cold chain and expiry sweeps: delivered orders with a recorded temperature.
jhatkaOrderSchema.index({ deliveredAt: -1, 'packing.coldChain.withinBand': 1 });

/**
 * The state machine, as data.
 *
 * Copied in shape from `stores.order.service.js` ORDER_TRANSITIONS, which is the
 * only guarded state machine in the repository and therefore the one pattern worth
 * following. `assertTransition` there throws 409 ILLEGAL_ORDER_MOVE; this vertical
 * does the same in `jhatka.order.service`.
 *
 * Two absences are deliberate and are explained in the header: `PREPARING` and
 * `PICKED_UP` cannot be cancelled.
 */
const ORDER_TRANSITIONS = {
  /**
   * `OUTLET_RECEIVED` is reachable from here as well as from `PAID`, and that is not a
   * loosening — it is what makes COD work.
   *
   * A COD order has no money to collect at checkout, so it never enters
   * `PAYMENT_PENDING`/`PAID`; it goes straight to the counter. Without this edge a COD
   * order could not be received at all, which made `ACCEPTED` unreachable and left
   * `POST /partner/orders/:order/accept` permanently 409.
   *
   * It was invisible because the partner route's guard was an ENUM-INDEX comparison
   * rather than this table: the index rule let any forward jump through, so an order
   * could be weighed straight from `CREATED` and every downstream route appeared to
   * work. That is the shape of bug this table was written to prevent, and it was only
   * found when the three copies of the rule were consolidated onto this one.
   */
  CREATED: ['PAYMENT_PENDING', 'OUTLET_RECEIVED', 'CANCELLED'],
  PAYMENT_PENDING: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAID: ['OUTLET_RECEIVED', 'CANCELLED', 'REFUND_PENDING'],
  OUTLET_RECEIVED: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'REJECTED', 'CANCELLED', 'ON_HOLD'],
  // The meat is cut here. No CANCELLED.
  PREPARING: ['WEIGHING', 'ON_HOLD', 'REJECTED'],
  WEIGHING: ['WEIGHT_CONFIRMED', 'ON_HOLD', 'REJECTED'],
  // Weight is settled. From here the rider's collect amount is knowable.
  WEIGHT_CONFIRMED: ['PACKING', 'ON_HOLD'],
  PACKING: ['READY', 'ON_HOLD'],
  READY: ['DRIVER_ASSIGNED', 'CANCELLED'],
  DRIVER_ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  // On the road. No CANCELLED.
  PICKED_UP: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['COMPLETED', 'REFUND_PENDING', 'CANCELLED'],
  COMPLETED: [],
  REJECTED: ['REFUND_PENDING'],
  CANCELLED: ['REFUND_PENDING'],
  PAYMENT_FAILED: ['PAYMENT_PENDING', 'CANCELLED'],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
  // A food-safety stop, not a customer action. Requires a reason and a timeout.
  ON_HOLD: ['PREPARING', 'REJECTED', 'CANCELLED'],
};

/**
 * The canonical list, so the enum, the transition table and the verify suite all
 * read from one source. A transition naming a state absent from the enum is a
 * silent no-op the customer experiences as a stuck order.
 */
jhatkaOrderSchema.statics.LIFECYCLE_STATES = ORDER_LIFECYCLE;
jhatkaOrderSchema.statics.ORDER_TRANSITIONS = ORDER_TRANSITIONS;

/** May this order move from `from` to `to`? Pure, so the service can pre-check. */
jhatkaOrderSchema.statics.canTransition = function (from, to) {
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
};

/**
 * Is this lifecycle value one where cancellation is structurally impossible?
 *
 * The meat is cut, or it is on the road. BR-18.
 */
jhatkaOrderSchema.statics.isPastCancellationPoint = function (lifecycle) {
  return !['CREATED', 'PAYMENT_PENDING', 'PAID', 'OUTLET_RECEIVED', 'ACCEPTED'].includes(lifecycle);
};

/**
 * Does this order need a weight confirmation before it can be dispatched?
 *
 * The strict ordering `WEIGHT_CONFIRMED → PACKING → READY → DRIVER_ASSIGNED` is
 * what makes the COD collect amount knowable before the rider leaves (§3.6) and
 * is enforced in `assertTransition`, not in the UI. VW-08 asserts it.
 */
jhatkaOrderSchema.statics.requiresWeightConfirmation = function (items) {
  return Array.isArray(items) && items.some((i) => i && i.isVariableWeight === true);
};

/**
 * VW-01 as a method: can this order ever charge above its estimate?
 *
 * @returns {boolean} true means the invariant holds
 */
jhatkaOrderSchema.methods.customerChargeNeverExceedsEstimate = function () {
  return Number(this.finalTotal || 0) <= Number(this.estimatedTotal || 0);
};

/**
 * @typedef JhatkaOrder
 */
const JhatkaOrder = mongoose.model('JhatkaOrder', jhatkaOrderSchema);

module.exports = JhatkaOrder;