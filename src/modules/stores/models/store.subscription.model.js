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
// `moneyField` takes its default in RUPEES and stores paise. See utils/money.field.js —
// the helper exists so the getter and setter can never drift apart by a factor of 100,
// which is the recorded Dairy money defect.
const moneyField = require('../../../utils/money.field');

/**
 * StoreSubscription — ONE bill per chain (BR-15, BR-16).
 *
 * ## Chain-level, never outlet-level
 *
 * There is deliberately NO `outlet` field on this schema, and `verify.stores.subscription.js`
 * asserts its absence. A three-outlet chain pays one subscription; giving the document an
 * outlet would make "one bill per outlet" the path of least resistance and quietly triple
 * a partner's bill the first time someone wrote `outlet:` into a create.
 *
 * ## `plan` is a key, not a ref
 *
 * `plan` is a STRING key such as `chain_pro`. It was briefly an ObjectId ref to a
 * `StoreSubscriptionPlan` collection, which is wrong for two reasons: the dunning sweeper
 * and the partner app both need to render a plan name without a join, and the plans this
 * vertical sells are a closed set an Admin configures in `config/roles.js`-adjacent
 * constants rather than rows a partner could edit. The seeded `StoreSubscriptionPlan`
 * documents remain the catalogue a future plan-management screen will read; they are not
 * the referential target for a live subscription.
 *
 * ## The partial unique index — the month-two bug
 *
 * A plain `unique: true` on `chain` would enforce "one subscription per chain, ever", which
 * breaks renewal: cancelling leaves a historical row that then collides with the new one.
 * The index is therefore PARTIAL, matching only live statuses:
 *
 *     { chain: 1 }, unique, partialFilterExpression: { status: { $in: [...] } }
 *
 * Cancelled and expired rows drop out of the index, so a chain can hold a live row plus any
 * number of historical ones. Both halves of that are asserted by the suite.
 */
const LIVE_STATUSES = ['trial', 'active', 'payment_due', 'retrying', 'grace_period', 'suspended'];

const storeSubscriptionSchema = mongoose.Schema(
  {
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },

    /**
     * Plan key, not an id. See the header note.
     */
    plan: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      required: true,
      default: 'trial',
      enum: ['trial', 'active', 'payment_due', 'retrying', 'grace_period', 'suspended', 'cancelled', 'expired'],
    },

    // Money — paise at rest, rupees at the edges. Defaults are in rupees.
    amount: moneyField(0),
    taxAmount: moneyField(0),
    totalAmount: moneyField(0),
    discountAmount: moneyField(0),

    /**
     * Included in the bill and displayed on the partner's plan card.
     */
    features: {
      type: [String],
      default: [],
    },

    trialDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    trialEndsAt: {
      type: Date,
    },

    startedAt: {
      type: Date,
      default: Date.now,
    },
    /**
     * When the current paid period ends. NULL for trial, which has no paid period — a
     * trial that ran out is handled by `effectiveStatus`, not by a date comparison.
     */
    endsAt: {
      type: Date,
    },
    nextPaymentDueAt: {
      type: Date,
    },

    cancelledAt: {
      type: Date,
    },
    cancelReason: {
      type: String,
    },
    expiredAt: {
      type: Date,
    },

    /**
     * Dunning bookkeeping. `retryCount` is read by the sweeper to decide whether the next
     * failure moves to `grace_period` or repeats a retry, so it is persisted rather than
     * held in the sweeper's memory — a restart must not reset a partner's retry count.
     */
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxRetries: {
      type: Number,
      default: 3,
      min: 1,
    },
    lastPaymentAt: {
      type: Date,
    },
    lastPaymentFailedAt: {
      type: Date,
    },
    graceEndsAt: {
      type: Date,
    },

    statusHistory: [
      {
        _id: false,
        from: String,
        to: String,
        by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
        reason: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
    // `toJSON` applies the money getters so an API response carries rupees. `toObject`
    // is left at the Mongoose default — applying getters there would hide the raw paise
    // and make an audit of what is actually stored impossible. The suite asserts exactly
    // this: `toObject().amount` is paise, `document.amount` is rupees.
    toJSON: { getters: true, virtuals: true },
  }
);

storeSubscriptionSchema.plugin(toJSON);
storeSubscriptionSchema.plugin(paginate);

/**
 * Is this subscription currently able to trade?
 *
 * `trial` counts as live even though it has no paid period — that is what a trial is for.
 * Everything dunning-related does not.
 */
storeSubscriptionSchema.virtual('isLive').get(function isLive() {
  return ['trial', 'active', 'payment_due', 'retrying', 'grace_period'].includes(this.status);
});

/**
 * The status to ACT on, which is not always the status STORED.
 *
 * A trial whose `trialEndsAt` has passed reads as `expired` immediately, rather than
 * waiting for the nightly sweeper to notice. Without this the partner app shows "trial"
 * for up to a day after their trial ended, and the activation guard lets them keep trading.
 *
 * Deliberately does NOT touch a dunning subscription: a `payment_due` or `grace_period`
 * row that also carries a stale `trialEndsAt` is mid-recovery, and reporting it as
 * `expired` would suspend a partner who is one successful charge from being fine.
 */
storeSubscriptionSchema.virtual('effectiveStatus').get(function effectiveStatus() {
  if (this.status === 'trial' && this.trialEndsAt && this.trialEndsAt < new Date()) {
    return 'expired';
  }
  return this.status;
});

/**
 * A cancelled subscription only "has ended" once its paid period actually ran out.
 *
 * Cancelling mid-period still entitles the partner to the service until `endsAt`. Treating
 * cancellation as immediate termination would cut off a partner who paid for the month.
 */
storeSubscriptionSchema.virtual('hasEnded').get(function hasEnded() {
  if (this.status === 'cancelled' && this.endsAt) {
    return this.endsAt < new Date();
  }
  return ['expired'].includes(this.status);
});

/**
 * Whole days until the next charge. Negative when overdue, NULL when there is no due date.
 *
 * NULL rather than 0 for "no due date" so a caller can tell "not due" from "due today" —
 * they render differently and only one of them should prompt a payment banner.
 */
storeSubscriptionSchema.virtual('daysUntilDue').get(function daysUntilDue() {
  if (!this.nextPaymentDueAt) return null;
  const ms = new Date(this.nextPaymentDueAt).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
});

/**
 * ONE live subscription per chain, with cancelled rows kept as history.
 *
 * The partial filter is the whole point — see the header note on the month-two bug.
 */
storeSubscriptionSchema.index(
  { chain: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: LIVE_STATUSES } },
    name: 'one_live_subscription_per_chain',
  }
);

storeSubscriptionSchema.index({ status: 1, nextPaymentDueAt: 1 });
storeSubscriptionSchema.index({ status: 1, trialEndsAt: 1 });
storeSubscriptionSchema.index({ business: 1 });

// ---------------------------------------------------------------------------
// lookups
// ---------------------------------------------------------------------------

/**
 * The chain's subscription, resolved from an outlet.
 *
 * Returns NULL for an unsubscribed chain rather than throwing, because the caller's
 * correct response is to treat the absence as "expired" and show the paywall — not to
 * surface a 500 on a screen that has to render for every partner including free ones.
 *
 * @param {object} outletOrQuery a StoreOutlet document, or `{ chain }`
 */
storeSubscriptionSchema.statics.forOutlet = async function forOutlet(outletOrQuery) {
  const chainId =
    outletOrQuery && outletOrQuery.chain
      ? outletOrQuery.chain
      : outletOrQuery && outletOrQuery._id;

  if (!chainId) return null;

  const chainObjectId = chainId._id ? chainId._id : chainId;
  return this.findOne({ chain: chainObjectId }).sort({ createdAt: -1 });
};

/**
 * Every row for a chain, newest first.
 *
 * Includes cancelled and expired rows on purpose — this is the billing history an operator
 * reads when a partner disputes a charge.
 */
storeSubscriptionSchema.statics.historyForChain = async function historyForChain(chainId) {
  return this.find({ chain: chainId }).sort({ createdAt: -1 });
};

/**
 * Rows the dunning sweeper should act on.
 *
 * The status list is the sweep's own contract, not the whole live set: `trial` and
 * `active` are not dunning states, and including them would have the sweeper "recover" a
 * healthy subscription.
 */
storeSubscriptionSchema.statics.dueForDunning = async function dueForDunning(now) {
  return this.find({
    status: { $in: ['payment_due', 'retrying', 'grace_period'] },
    $or: [{ nextPaymentDueAt: { $lte: now } }, { graceEndsAt: { $lte: now } }],
  });
};

/**
 * Trials whose end date has passed. The nightly sweep expires these.
 *
 * Filtered to `trial` so a partner whose trial already expired once is not re-expired on
 * every subsequent run.
 */
storeSubscriptionSchema.statics.expiringTrials = async function expiringTrials(now) {
  return this.find({ status: 'trial', trialEndsAt: { $lte: now } });
};

const StoreSubscription = mongoose.model('StoreSubscription', storeSubscriptionSchema);

module.exports = StoreSubscription;