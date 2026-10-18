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

/**
 * DairySubscription — a recurring milk plan.
 *
 * A subscription is **not a category**. It is a purchase mode that produces
 * deliveries:
 *
 *   Product → Quantity → Schedule → Start Date → Address → Payment
 *          → Subscription Active → Recurring Orders → Delivery
 *
 * The schedule is expressed so it can be answered for any given date, which is
 * what the nightly manifest generator needs:
 *
 *   daily          — every day
 *   alternate_days — every other day from `startDate`
 *   weekly         — the same weekday as `startDate`
 *   custom_days    — an explicit weekday list in `customDays`
 *
 * `customDays` uses `0` (Sunday) through `6` (Saturday) to match JavaScript's
 * `Date#getDay`, which is what `isScheduledFor` uses.
 */
const dairySubscriptionSchema = mongoose.Schema(
  {
    subscriptionNo: {
      type: Number,
      required: true,
    },
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    sku: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairySku',
      required: true,
    },
    /**
     * Pack sizes per delivery. One subscription covers one SKU with a quantity,
     * so multi-item plans are several subscriptions rather than a line-item
     * array — which keeps schedule evaluation per line unambiguous.
     */
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    scheduleType: {
      type: String,
      required: true,
      default: 'daily', // daily, alternate_days, weekly, custom_days
    },
    /**
     * Only meaningful for `custom_days`. 0 = Sunday … 6 = Saturday.
     */
    customDays: {
      type: [Number],
      default: [],
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: false,
    },
    /**
     * Fresh milk has a hard morning window. Stored as HH:mm strings because the
     * rider's manifest is grouped by slot and a 06:00 slot must sort before 07:00
     * lexicographically.
     */
    deliverySlot: {
      startTime: {
        type: String,
        required: true,
      },
      endTime: {
        type: String,
        required: true,
      },
    },
    address: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserAddress',
      required: false,
    },
    /** Snapshotted so a later address edit cannot retroactively change history. */
    addressRaw: {
      type: String,
      required: false,
    },
    receiverName: {
      type: String,
      required: false,
    },
    receiverContact: {
      type: Number,
      required: false,
    },
    /**
     * Unit price at the time the plan was created, in rupees. Re-read from the
     * SKU at billing time; kept here so a price change is visible as a change
     * rather than silently altering what the customer agreed to.
     */
    unitPrice: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    payment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentConfig',
      required: false,
    },
    paymentMode: {
      type: String,
      required: false,
      default: 'wallet', // wallet, cod, gateway
    },
    /**
     * Dates the customer asked to skip. Checked before the schedule so an
     * explicit skip always wins, whatever the recurrence.
     */
    skipDates: {
      type: [Date],
      default: [],
    },
    /**
     * Pause windows. A pause does not cancel the plan — it suspends generation,
     * and the subscription resumes automatically afterwards.
     */
    pauseWindows: [
      {
        from: {
          type: Date,
          required: true,
        },
        to: {
          type: Date,
          required: true,
        },
        reason: {
          type: String,
          required: false,
        },
      },
    ],
    /**
     * Rotation linkage. Present only for reusable-container milk, and points at
     * the assignment whose cans rotate for this plan.
     */
    containerAssignment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyContainerAssignment',
      required: false,
    },
    /**
     * Rollup maintained by the manifest generator, so the subscription list can
     * show progress without aggregating recurring orders.
     */
    stats: {
      occurrencesGenerated: {
        type: Number,
        required: false,
        default: 0,
      },
      occurrencesDelivered: {
        type: Number,
        required: false,
        default: 0,
      },
      occurrencesSkipped: {
        type: Number,
        required: false,
        default: 0,
      },
      lastGeneratedAt: {
        type: Date,
        required: false,
      },
      nextDeliveryDate: {
        type: Date,
        required: false,
      },
    },
    status: {
      type: String,
      required: false,
      default: 'pending_payments', // pending_payments, active, paused, cancelled, completed
    },
    activatedAt: {
      type: Date,
      required: false,
    },
    cancellation: {
      cancelledAt: {
        type: Date,
        required: false,
      },
      cancelledBy: {
        type: String,
        required: false,
      },
      reason: {
        type: String,
        required: false,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairySubscriptionSchema.plugin(toJSON);
dairySubscriptionSchema.plugin(paginate);
dairySubscriptionSchema.index({ subscriptionNo: 1 }, { unique: true });
dairySubscriptionSchema.index({ user: 1, status: 1 });
// The manifest generator's hot query: active plans, not paused, in date order.
dairySubscriptionSchema.index({ status: 1, 'scheduleType': 1, startDate: 1 });
dairySubscriptionSchema.index({ business: 1, status: 1, startDate: 1 });
dairySubscriptionSchema.index({ 'deliverySlot.startTime': 1 });

/**
 * Is this subscription due on the given date?
 *
 * Deliberately a method rather than a stored flag so the answer is always derived
 * from the current recurrence state and never drifts out of date.
 *
 * @param {Date} date
 * @returns {boolean}
 */
dairySubscriptionSchema.methods.isScheduledFor = function isScheduledFor(date) {
  const target = new Date(date);
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());

  const start = new Date(this.startDate);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  if (targetDay < startDay) return false;
  if (this.endDate) {
    const end = new Date(this.endDate);
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (targetDay > endDay) return false;
  }

  // An explicit skip always wins over the recurrence.
  const skipped = (this.skipDates || []).some((d) => {
    const skip = new Date(d);
    return (
      skip.getFullYear() === targetDay.getFullYear() &&
      skip.getMonth() === targetDay.getMonth() &&
      skip.getDate() === targetDay.getDate()
    );
  });
  if (skipped) return false;

  // A pause window suspends generation entirely.
  const paused = (this.pauseWindows || []).some((w) => {
    const from = new Date(w.from);
    const to = new Date(w.to);
    return target >= from && target <= to;
  });
  if (paused) return false;

  switch (this.scheduleType) {
    case 'daily':
      return true;

    case 'alternate_days': {
      const diffDays = Math.round((targetDay - startDay) / (24 * 60 * 60 * 1000));
      return diffDays % 2 === 0;
    }

    case 'weekly':
      return targetDay.getDay() === startDay.getDay();

    case 'custom_days':
      return (this.customDays || []).includes(targetDay.getDay());

    default:
      return false;
  }
};

/**
 * Next delivery date strictly after `from`, or null when the plan has ended.
 *
 * @param {Date} from
 * @returns {Date|null}
 */
dairySubscriptionSchema.methods.nextOccurrenceAfter = function nextOccurrenceAfter(from) {
  const cursor = new Date(from);
  // One year of lookahead is enough for any recurrence in the specification.
  for (let i = 1; i <= 366; i += 1) {
    const candidate = new Date(cursor);
    candidate.setDate(cursor.getDate() + i);
    if (this.isScheduledFor(candidate)) {
      return candidate;
    }
  }
  return null;
};

/**
 * @typedef DairySubscription
 */
const DairySubscription = mongoose.model('DairySubscription', dairySubscriptionSchema);

module.exports = DairySubscription;