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
 * JhatkaSubscription — a customer buying Jhatka on a recurring schedule. §9.
 *
 * ## This is a MODE, not a vertical and not a category. BR-14.
 *
 * The blueprint says so twice (§14, §32) and it is worth restating because the
 * natural implementation error is to build a `JhatkaSubscriptionProduct` category.
 * A subscription IS an order with a recurrence rule attached; it runs through the
 * identical lifecycle and the identical weighing flow, and `JhatkaRecurringOrder`
 * produces an ordinary `JhatkaOrder`.
 *
 * ## BR-15: eggs and fish are not eligible, and the reason is physical
 *
 * Nobody subscribes to eggs — they buy a tray. And a fish subscription is a
 * wastage engine with a subscription attached: fish bought at 4am is sold by 8pm
 * or written off, and a subscription guarantees a customer wants it tomorrow.
 *
 * So `subscriptionEligible` defaults FALSE at the variant level and an operator
 * opts a cut IN once its fulfilment rate justifies it. Shipping a subscription on
 * a scarce SKU by default is how a vertical loses money quietly.
 *
 * ## BR-16: a prepaid WEIGHT occurrence charges the CEILING and is not reconciled
 *
 * A subscription occurrence has the same unknown-final-amount problem as an order,
 * except a refund per occurrence is operationally unacceptable — a weekly
 * subscription with a weekly refund has a refund rate, a refund SLA, a
 * reconciliation queue and a failed-refund backlog.
 *
 * So `chargeMode: 'ceiling'` charges `requested × (1 + ceilingPct)` and does NOT
 * reconcile per occurrence. The customer is systematically over-charged by up to
 * 10% and never told. That is a real cost and it is stated here rather than
 * discovered later; plan §9.5 records option C (sell "1 kg ±10%" as a fixed-price
 * product) as the alternative worth a commercial conversation.
 *
 * ## `isScheduledFor` is a MODEL METHOD, copied from `DairySubscription`
 *
 * The kernel recurrence service is NOT used: `generateDueOccurrences` is dead code
 * hard-wired to `StoreRecurringOrder`, and `occurrence.math` handles only
 * weekly/biweekly/monthly — it has no `daily`, no `alternate_days` and no
 * `custom_days`, which is precisely what a Jhatka schedule needs.
 */
const SCHEDULE_TYPES = ['daily', 'alternate_days', 'weekly', 'custom_days'];
const SUBSCRIPTION_STATUSES = [
  'pending_payments',
  'active',
  'paused',
  'payment_failed',
  'cancelled',
  'completed',
  'failed',
];

const SUBSTITUTION_POLICIES = [
  'notify_and_confirm',
  'substitute_similar',
  'skip_without_credit',
  'cancel_subscription',
];

const STOCK_FAILURE_POLICIES = ['notify_and_skip', 'notify_and_pause', 'notify_and_suggest'];

const jhatkaSubscriptionSchema = mongoose.Schema(
  {
    subscriptionNo: {
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
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },

    items: [
      {
        _id: false,
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
        sku: { type: String, required: true, uppercase: true, trim: true },
        /** Frozen for display. The catalogue is admin-editable. */
        name: { type: String, required: true, trim: true },
        nameSnapshot: { type: String, required: false, trim: true },
        requestedQuantity: {
          type: quantitySchema,
          required: true,
        },
        /**
         * BR-16. How this line is charged per occurrence.
         *
         * `ceiling` is required for a WEIGHT line — reconciling a recurring
         * variable-weight charge per occurrence is not viable. A COUNT line has no
         * unknown final amount and may use `estimated`.
         */
        chargeMode: {
          type: String,
          required: false,
          enum: ['ceiling', 'estimated'],
          default: 'ceiling',
        },
        subscriptionCeilingPct: {
          type: Number,
          required: false,
          min: 0,
          max: 50,
          default: 10,
        },
        /**
         * Informational ONLY.
         *
         * The price charged per occurrence is resolved from the CURRENT catalogue
         * at generation time, not from this. Meat prices move daily and a
         * subscriber must be told rather than surprised — see `priceMode`.
         */
        unitPriceAtSubscribe: moneyField(0),
        /** BR-11, for a prepared line. */
        yieldSpec: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'JhatkaYieldSpec',
          required: false,
          default: undefined,
        },
      },
    ],

    // ---- the recurrence ----
    /**
     * `custom_days` uses 0 (Sunday) through 6 (Saturday) to match JavaScript's
     * `Date#getDay`, which is what `isScheduledFor` compares against. Copied from
     * `DairySubscription` deliberately.
     */
    scheduleType: {
      type: String,
      required: true,
      enum: SCHEDULE_TYPES,
    },
    customDays: {
      type: [Number],
      required: false,
      default: [],
      validate: {
        validator: (v) => Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: 'customDays must be integers 0-6 (0 = Sunday, matching Date#getDay)',
      },
    },
    intervalCount: {
      type: Number,
      required: false,
      default: 1,
      min: 1,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: false },
    nextOccurrenceDate: { type: Date, required: false },
    lastOccurrenceDate: { type: Date, required: false },
    /**
     * Slot times as `'HH:mm'` STRINGS, not Date objects.
     *
     * Copied from `DairySubscription` and for the same reason: strings sort
     * lexicographically into the right order, and a Date in a slot field is a
     * timezone bug waiting for a customer in another state.
     */
    deliverySlot: {
      startTime: { type: String, required: false },
      endTime: { type: String, required: false },
    },

    // ---- money ----
    /**
     * Meat prices move. A subscriber is told when the price changed rather than
     * discovering it on the invoice.
     */
    priceMode: {
      type: String,
      required: false,
      enum: ['current_price', 'notify_and_confirm'],
      default: 'notify_and_confirm',
    },
    paymentMode: {
      type: String,
      required: false,
      enum: ['gateway', 'cod'],
      default: 'gateway',
    },
    prepaid: {
      type: Boolean,
      required: false,
      default: true,
    },
    estimatedAmountPerOccurrence: moneyField(0),
    totals: {
      amountCollected: moneyField(0),
      amountRefunded: moneyField(0),
      /** Credit from skipped occurrences, redeemed on the next invoice. §9.6 */
      amountCredited: moneyField(0),
      amountSkipped: moneyField(0),
    },

    // ---- customer control ----
    /**
     * An explicit skip ALWAYS beats the recurrence. Checked first in
     * `isScheduledFor`, because a customer who pressed "skip" must not be charged
     * for a delivery the recurrence still says is due.
     */
    skipDates: {
      type: [Date],
      required: false,
      default: [],
    },
    /**
     * A pause window suspends generation entirely — as distinct from cancelling,
     * which ends the subscription.
     */
    pauseWindows: [
      {
        _id: false,
        from: { type: Date, required: true },
        to: { type: Date, required: true },
        reason: { type: String, required: false, trim: true },
      },
    ],
    /**
     * Hours before the next occurrence within which a change takes effect.
     *
     * A change made after a van is loaded cannot be honoured, and discovering that
     * at the door is worse than a clear cutoff in the app. Default 2.
     */
    editCutoffHours: {
      type: Number,
      required: false,
      default: 2,
      min: 0,
    },
    substitutionPolicy: {
      type: String,
      required: false,
      enum: SUBSTITUTION_POLICIES,
      default: 'notify_and_confirm',
    },
    /** §9.6. Never silently skip. BR-17. */
    stockFailurePolicy: {
      type: String,
      required: false,
      enum: STOCK_FAILURE_POLICIES,
      default: 'notify_and_pause',
    },

    // ---- state ----
    status: {
      type: String,
      required: false,
      enum: SUBSCRIPTION_STATUSES,
      default: 'pending_payments',
    },
    statusReason: { type: String, required: false, trim: true },
    cancelledAt: { type: Date, required: false },
    cancelReason: { type: String, required: false, trim: true },
    pausedAt: { type: Date, required: false },
    resumedAt: { type: Date, required: false },

    /**
     * BR-17, and the part everybody forgets: the consecutive-failure counter.
     *
     * A subscription on a scarce SKU that quietly skips eight times in a row is a
     * customer who finds out in month three. The generator auto-pauses at the
     * outlet's `maxConsecutiveStockFailures`, converting a silent failure into a
     * conversation.
     */
    stats: {
      occurrencesGenerated: { type: Number, required: false, default: 0, min: 0 },
      occurrencesDelivered: { type: Number, required: false, default: 0, min: 0 },
      occurrencesSkipped: { type: Number, required: false, default: 0, min: 0 },
      occurrencesShort: { type: Number, required: false, default: 0, min: 0 },
      consecutiveStockFailures: { type: Number, required: false, default: 0, min: 0 },
      lastGeneratedAt: { type: Date, required: false },
      nextDeliveryDate: { type: Date, required: false },
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaSubscriptionSchema.plugin(toJSON);
jhatkaSubscriptionSchema.plugin(paginate);
/**
 * THE NIGHTLY GENERATOR'S HOT INDEX.
 *
 * `scripts/../jhatka/cron.js` runs one query per outlet: active subscriptions
 * whose `nextOccurrenceDate` has arrived. Everything else is secondary.
 */
jhatkaSubscriptionSchema.index({ outlet: 1, status: 1, nextOccurrenceDate: 1 });
// The customer's own subscription list.
jhatkaSubscriptionSchema.index({ customer: 1, status: 1, createdAt: -1 });
// The auto-pause check after a stock failure.
jhatkaSubscriptionSchema.index({ 'stats.consecutiveStockFailures': -1, status: 1 });
jhatkaSubscriptionSchema.index({ status: 1, scheduleType: 1, startDate: 1 });
// An outlet's subscription book.
jhatkaSubscriptionSchema.index({ outlet: 1, status: 1, createdAt: -1 });
// The `editCutoffHours` guard, which needs the next occurrence fast.
jhatkaSubscriptionSchema.index({ status: 1, nextOccurrenceDate: 1 });

jhatkaSubscriptionSchema.statics.SCHEDULE_TYPES = SCHEDULE_TYPES;
jhatkaSubscriptionSchema.statics.STATUSES = SUBSCRIPTION_STATUSES;
jhatkaSubscriptionSchema.statics.SUBSTITUTION_POLICIES = SUBSTITUTION_POLICIES;
jhatkaSubscriptionSchema.statics.STOCK_FAILURE_POLICIES = STOCK_FAILURE_POLICIES;

/**
 * Is a delivery due on this date?
 *
 * Copied in shape from `DairySubscription.isScheduledFor`, and in ORDER, which is
 * the part that matters:
 *
 *   1. an explicit `skipDates` entry wins — the customer pressed skip
 *   2. a `pauseWindows` entry suspends generation entirely
 *   3. the start/end bounds apply
 *   4. only then the recurrence itself
 *
 * A customer who skipped must not be charged, and a paused subscription must not
 * generate. Both are checked before the recurrence, not after.
 *
 * @param {Date} targetDate
 * @returns {boolean}
 */
jhatkaSubscriptionSchema.methods.isScheduledFor = function (targetDate) {
  const target = new Date(targetDate);
  const y = target.getFullYear();
  const m = target.getMonth();
  const d = target.getDate();

  // 1. explicit skip beats everything
  const skipped = (this.skipDates || []).some((sd) => {
    const x = new Date(sd);
    return x.getFullYear() === y && x.getMonth() === m && x.getDate() === d;
  });
  if (skipped) return false;

  // 2. a pause window suspends generation
  //
  // `>= from && < to` — HALF-OPEN, on both windows and skipDates-style bounds.
  // The first version tested them the other way round (`if (from && target < from)
  // return false`) which inverted the meaning entirely: a subscription paused 6-8
  // October still generated on the 7th, because "target is before the window"
  // was being read as "target is inside the window". A paused subscription that
  // keeps delivering is the exact failure BR-17 exists to prevent.
  const paused = (this.pauseWindows || []).some((w) => {
    const from = w.from ? new Date(w.from) : null;
    const to = w.to ? new Date(w.to) : null;
    const startsBefore = from === null || target >= from;
    const endsAfter = to === null || target < to;
    return startsBefore && endsAfter;
  });
  if (paused) return false;

  // 3. term bounds
  if (this.startDate && target < new Date(this.startDate)) return false;
  if (this.endDate && target >= new Date(this.endDate)) return false;

  // 4. the recurrence
  switch (this.scheduleType) {
    case 'daily':
      return true;
    case 'alternate_days': {
      // Count whole days from the start date. `Math.floor` on a DST-affected
      // difference can be one day short, which turns "every other day" into a
      // drifting schedule, so the comparison is done on calendar-midnight values.
      const start = new Date(this.startDate);
      const startMid = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const targetMid = new Date(y, m, d);
      const days = Math.round((targetMid - startMid) / 86400000);
      return days >= 0 && days % (2 * (this.intervalCount || 1)) === 0;
    }
    case 'weekly':
      return startDayOfWeek(target) === new Date(this.startDate).getDay();
    case 'custom_days':
      return (this.customDays || []).includes(target.getDay());
    default:
      return false;
  }
};

/**
 * The next date this subscription is due, or null.
 *
 * Bounded at 366 days because a subscription with a bounded term or a paused
 * window has no next date and an unbounded search would be a hang.
 *
 * @param {Date} [from]
 * @returns {Date|null}
 */
jhatkaSubscriptionSchema.methods.nextOccurrenceAfter = function (from = new Date()) {
  const start = new Date(from);
  // Start at i = 1, not 0.
  //
  // "The next occurrence" is strictly after `from`. Looping from 0 returns the
  // starting day itself whenever it happens to match the recurrence — so a
  // subscription asked for its next Monday from a Monday returns today, and the
  // generator double-charges the day it already delivered.
  for (let i = 1; i <= 366; i += 1) {
    const candidate = new Date(start);
    candidate.setDate(start.getDate() + i);
    if (this.isScheduledFor(candidate)) return candidate;
  }
  return null;
};

/** Sunday-anchored, so it matches `customDays` semantics. */
function startDayOfWeek(date) {
  return new Date(date).getDay();
}

jhatkaSubscriptionSchema.statics.startDayOfWeek = startDayOfWeek;

/**
 * @typedef JhatkaSubscription
 */
const JhatkaSubscription = mongoose.model('JhatkaSubscription', jhatkaSubscriptionSchema);

module.exports = JhatkaSubscription;