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
 * JhatkaRecurringOrder — one occurrence of a subscription on one date. §9.3.
 *
 * ## The unique index is the whole idempotency mechanism
 *
 * `{subscription, occurrenceDate}` UNIQUE. A nightly cron that fails halfway and
 * re-runs cannot duplicate a delivery, because the second insert collides rather
 * than creating a second order. This is the pattern copied from
 * `DairyRecurringOrder` and `StoreRecurringOrder`, and it is deliberately an INDEX
 * rather than a read-before-write — `stores.settlement.service` uses a query for
 * this (F-3) and two concurrent runs both find nothing.
 *
 * The kernel's own recurrence service cannot be used for this: it computes an
 * idempotency key and then discards it, and hard-codes
 * `mongoose.model('StoreRecurringOrder')`.
 *
 * ## `generationStatus` is where BR-17 lives
 *
 * `skipped_no_stock` is not a failure mode to be hidden — it is the outcome that
 * must notify the customer and count toward `consecutiveStockFailures` so the
 * subscription auto-pauses. A recurring order that silently vanishes is how a
 * customer finds out three weeks later that their Monday chicken stopped arriving.
 *
 * ## Stock is reserved PER OCCURRENCE, not per plan
 *
 * Copied from `dairy.subscription.billing.service`'s stated rule. Reserving per
 * plan means one subscription for 10 kg holds 10 kg against every competing
 * order; reserving per occurrence means each generated occurrence claims only what
 * it needs, guarded so two occurrences in the same run cannot both claim the last
 * kilogram.
 */
const GENERATION_STATUSES = [
  'planned',
  'generated',
  'reserved',
  'skipped_no_stock',
  'skipped_inactive',
  'payment_failed',
  'cancelled',
  'expired',
];

const jhatkaRecurringOrderSchema = mongoose.Schema(
  {
    /** UNIQUE together with `occurrenceDate`. The idempotency anchor. */
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaSubscription',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    /**
     * Midnight-normalised local date of the occurrence.
     *
     * Normalised, because `new Date()` carries a time component and a comparison
     * against a midnight-keyed unique index will not match — the kernel recurrence
     * service has exactly this bug (`occurrenceDate = new Date()` compared against
     * midnight-keyed rows).
     */
    occurrenceDate: {
      type: Date,
      required: true,
      validate: {
        validator: (v) => new Date(v).getHours() === 0 && new Date(v).getMinutes() === 0,
        message: 'occurrenceDate must be local midnight — a time component breaks the unique index',
      },
    },
    /** The order this occurrence produced. Ordinary lifecycle, ordinary weighing. */
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: false,
      default: undefined,
    },
    generationStatus: {
      type: String,
      required: false,
      enum: GENERATION_STATUSES,
      default: 'planned',
    },
    /**
     * BR-16. What this occurrence will be charged, frozen at generation.
     *
     * On a WEIGHT line this is the CEILING, not the estimate, and it is not
     * reconciled afterwards.
     */
    chargeAmount: moneyField(0),
    /** The estimate, kept alongside so the ceiling is auditable. */
    estimatedAmount: moneyField(0),
    /** Unit prices used, frozen at generation. Not re-read from the catalogue. */
    items: [
      {
        _id: false,
        variant: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaVariant',
          required: true,
        },
        sku: { type: String, required: true, uppercase: true, trim: true },
        quantity: { type: Number, required: true },
        unit: {
          type: String,
          required: true,
          enum: ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER'],
        },
        unitPrice: moneyField(0),
        chargeMode: {
          type: String,
          required: false,
          enum: ['ceiling', 'estimated'],
          default: 'ceiling',
        },
        lineCharge: moneyField(0),
      },
    ],
    /**
     * Reservation state, guarded rather than trusted.
     *
     * `stockReserved` exists so a retry cannot release the same stock twice. This
     * is the single most important field on the document for money correctness.
     */
    stockReserved: {
      type: Boolean,
      required: false,
      default: false,
    },
    reservedAt: { type: Date, required: false },
    releasedAt: { type: Date, required: false },

    /**
     * BR-17. WHY this occurrence did not produce an order. Mandatory whenever
     * `generationStatus` is a skip.
     *
     * A skip with no reason is an unexplained skip, and the customer's next action
     * depends entirely on which it was.
     */
    skipReason: {
      type: String,
      required: false,
      enum: [
        'insufficient_stock',
        'outlet_inactive',
        'customer_paused',
        'explicitly_skipped',
        'payment_failed',
        'item_unavailable',
        'compliance_blocked',
        'other',
      ],
    },
    /** Plain-language version for the notification. */
    skipNote: { type: String, required: false, trim: true },

    /**
     * §9.6. Credit for a skipped occurrence, when prepaid.
     *
     * Carried to the next invoice or refunded on cancellation. A prepaid customer
     * whose delivery was skipped has paid for nothing and the balance has to be
     * visible somewhere.
     */
    creditAmount: moneyField(0),
    creditedAt: { type: Date, required: false },

    notifiedAt: { type: Date, required: false },

    /**
     * BR-16. How this occurrence was PAID.
     *
     * The occurrence — not the subscription — is the thing money is attached to,
     * because one subscription has many occurrences and one payment does not cover
     * all of them. `{subscription, occurrenceDate}` is the idempotency anchor above,
     * so a duplicate callback lands on the SAME row rather than creating a second
     * charge.
     *
     * `paidAmount` is written from `chargeAmount`, the ceiling frozen at generation.
     * It is never recomputed at payment time: the customer was quoted that number
     * before the meat was cut, and re-pricing it here would make the charge a function
     * of when they happened to open the app.
     */
    payment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentInitiation',
      required: false,
    },
    paymentStatus: {
      type: String,
      required: false,
      enum: ['pending', 'paid', 'failed', 'credited'],
      default: 'pending',
    },
    paymentRef: { type: String, required: false, trim: true },
    paidAt: { type: Date, required: false },
    paidAmount: moneyField(0),

    /**
     * BILLING state for a PREPAID occurrence.
     *
     * ## Why billing is separate from payment
     *
     * `paymentStatus` says whether money arrived. These say whether we ASKED. They are
     * different questions and conflating them is how a subscription silently stops
     * being charged: a re-run sweep that only checked `paymentStatus: 'pending'` would
     * mint a fresh initiation every night forever, because nothing recorded that the
     * attempt had already been made.
     *
     * ## The retry ladder
     *
     *   1 attempt at generation + the lead time
     *   1 reminder the evening before
     *   then SKIP and credit (§9.6), and count toward the auto-pause threshold
     *
     * Three is not arbitrary. §9.6's rule is that a subscription must never silently
     * skip, and two is not enough attempts to be sure — a customer whose phone was
     * dead at 10am deserves one more chance before their week is cancelled without a
     * conversation.
     */
    billingStatus: {
      type: String,
      required: false,
      enum: ['not_required', 'pending', 'reminded', 'billed', 'unpaid_skipped'],
      default: 'pending',
    },
    billingAttemptedAt: { type: Date, required: false },
    billingAttempts: { type: Number, required: false, default: 0, min: 0 },
    billingReminderAt: { type: Date, required: false },
    /** The initiation the customer is sent to pay. Survives a new attempt for audit. */
    billingPaymentRef: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentInitiation',
      required: false,
    },
    /** When an unpaid prepaid occurrence stops being deliverable. */
    billingDeadlineAt: { type: Date, required: false },

    /** When an unconfirmed substitution offer lapses. */
    expiresAt: { type: Date, required: false },
    generatedAt: { type: Date, required: false },
    generatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    /** Cron run id, so a failed run's output is traceable to its invocation. */
    batchRef: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaRecurringOrderSchema.plugin(toJSON);
jhatkaRecurringOrderSchema.plugin(paginate);
/**
 * THE IDEMPOTENCY ANCHOR.
 *
 * UNIQUE on `{subscription, occurrenceDate}`. A nightly cron that fails halfway
 * and re-runs collides here rather than generating a second order for a customer
 * who would then receive two deliveries.
 *
 * This is an INDEX. `stores.settlement.service` performs the equivalent
 * check-as-a-query with no index behind it, which permits two concurrent
 * generators to both find nothing (F-3) — and two duplicate payouts.
 */
jhatkaRecurringOrderSchema.index({ subscription: 1, occurrenceDate: 1 }, { unique: true });
// The nightly generator: what is due today.
jhatkaRecurringOrderSchema.index({ outlet: 1, occurrenceDate: 1, generationStatus: 1 });
// The outlet's "today's recurring orders" panel.
jhatkaRecurringOrderSchema.index({ outlet: 1, occurrenceDate: -1 });
// The customer's subscription history.
jhatkaRecurringOrderSchema.index({ customer: 1, occurrenceDate: -1 });
// The auto-pause check.
jhatkaRecurringOrderSchema.index({ generationStatus: 1, occurrenceDate: -1 });
// Tracing a failed cron run's output.
jhatkaRecurringOrderSchema.index({ batchRef: 1 });

jhatkaRecurringOrderSchema.statics.GENERATION_STATUSES = GENERATION_STATUSES;

/**
 * Is this occurrence one that produced (or should produce) a real order?
 */
jhatkaRecurringOrderSchema.methods.isLive = function () {
  return ['planned', 'generated', 'reserved'].includes(this.generationStatus);
};

/**
 * Did this occurrence fail on stock?
 *
 * The predicate the auto-pause counter increments. Separated from the status
 * check so the pause rule cannot drift from what actually happened.
 */
jhatkaRecurringOrderSchema.methods.failedOnStock = function () {
  return this.generationStatus === 'skipped_no_stock';
};

/**
 * @typedef JhatkaRecurringOrder
 */
const JhatkaRecurringOrder = mongoose.model(
  'JhatkaRecurringOrder',
  jhatkaRecurringOrderSchema
);

module.exports = JhatkaRecurringOrder;