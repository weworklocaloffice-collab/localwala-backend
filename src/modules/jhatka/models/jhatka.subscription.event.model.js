/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
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
 * JhatkaSubscriptionEvent — the append-only log of a subscription changing. §9.7.
 *
 * ## "Why did my subscription change its own mind?"
 *
 * That is the question every recurring-order product gets asked, and it is
 * unanswerable without a record of the changes. A subscription can be paused,
 * resumed, skipped, re-quantified, re-scheduled and cancelled, by the customer or
 * by the system, and the current document only shows the latest state.
 *
 * `DairySubscription` has no such log, which means its `pauseWindows` and `skipDates`
 * are opaque to a support agent. This model is the fix for that and it costs one
 * append-only collection.
 *
 * ## `effectiveFrom` is not `at`
 *
 * A pause taken at 14:30 with a two-hour cutoff takes effect at the next
 * occurrence, not immediately. Recording both — when the action happened and when
 * it bites — is what lets a customer be told "your pause starts from Thursday"
 * rather than "your pause is now, but the van was already loaded".
 *
 * ## The cutoff is refused, not clamped
 *
 * A change inside `editCutoffHours` is REJECTED with a clear message. Clamping it
 * to the cutoff time would silently apply a different change from the one the
 * customer asked for.
 */
const EVENT_TYPES = [
  'created',
  'activated',
  'paused',
  'resumed',
  'skipped',
  'unskipped',
  'quantity_changed',
  'schedule_changed',
  'price_notified',
  'price_accepted',
  'cancelled',
  'stock_failure_skipped',
  'stock_failure_paused',
  'substitution_proposed',
  'substitution_accepted',
  'substitution_declined',
  'auto_paused',
  'payment_failed',
  'payment_recovered',
];

const jhatkaSubscriptionEventSchema = mongoose.Schema(
  {
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaSubscription',
      required: true,
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
    type: {
      type: String,
      required: true,
      enum: EVENT_TYPES,
    },
    /**
     * The before/after pair, as STRINGS.
     *
     * Deliberately not typed. An event log holds whatever the field was on the day
     * — a quantity, a weekday list, a status — and one column cannot be typed for
     * all of them. Reading it means reading `fromValue` and `toValue` together.
     */
    fromValue: { type: String, required: false, trim: true },
    toValue: { type: String, required: false, trim: true },
    /**
     * WHEN the action was taken.
     */
    at: {
      type: Date,
      required: true,
    },
    /**
     * WHEN it takes effect.
     *
     * Different from `at` whenever `editCutoffHours` defers a change to the next
     * occurrence. Null for an immediate action.
     */
    effectiveFrom: {
      type: Date,
      required: false,
      default: undefined,
    },
    /**
     * `customer` or `system`. A `stock_failure_paused` nobody asked for needs to be
     * distinguishable from a pause the customer requested, or the customer thinks
     * they did something wrong.
     */
    actorType: {
      type: String,
      required: true,
      enum: ['customer', 'system', 'admin', 'cron'],
    },
    actor: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    actorName: { type: String, required: false, trim: true },
    reason: { type: String, required: false, trim: true },
    note: { type: String, required: false, trim: true },
    /**
     * BR-17. The consecutive-failure counter value at the time, so a sequence of
     * auto-pauses can be reconstructed without replaying the whole series.
     */
    consecutiveStockFailures: { type: Number, required: false, min: 0 },
    /** The occurrence this event relates to, where applicable. */
    recurringOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaRecurringOrder',
      required: false,
      default: undefined,
    },
    notifiedAt: { type: Date, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaSubscriptionEventSchema.plugin(toJSON);
jhatkaSubscriptionEventSchema.plugin(paginate);
/**
 * THE SUPPORT QUERY.
 *
 * "Show me everything that happened to this subscription" — one indexed read,
 * in order. Without it, answering "why did my Monday chicken stop arriving"
 * means reading `skipDates`, `pauseWindows`, `stats` and the recurring orders
 * separately and reconciling them by hand.
 */
jhatkaSubscriptionEventSchema.index({ subscription: 1, at: 1 });
// The customer's own history.
jhatkaSubscriptionEventSchema.index({ customer: 1, at: -1 });
// The BR-17 sequence: every stock failure for an outlet, in order.
jhatkaSubscriptionEventSchema.index({ outlet: 1, type: 1, at: -1 });
// "Which subscriptions auto-paused this week?"
jhatkaSubscriptionEventSchema.index({ type: 1, at: -1 });

jhatkaSubscriptionEventSchema.statics.EVENT_TYPES = EVENT_TYPES;

/**
 * Is this change deferred rather than immediate?
 *
 * The distinction a support agent needs: "you pressed pause at 14:30 and it takes
 * effect from Thursday" versus "it is paused now".
 */
jhatkaSubscriptionEventSchema.methods.isDeferred = function () {
  if (!this.effectiveFrom) return false;
  return new Date(this.effectiveFrom).getTime() > new Date(this.at).getTime();
};

/**
 * Did the SYSTEM do this?
 */
jhatkaSubscriptionEventSchema.methods.isSystemAction = function () {
  return this.actorType !== 'customer';
};

/**
 * @typedef JhatkaSubscriptionEvent
 */
const JhatkaSubscriptionEvent = mongoose.model(
  'JhatkaSubscriptionEvent',
  jhatkaSubscriptionEventSchema
);

module.exports = JhatkaSubscriptionEvent;