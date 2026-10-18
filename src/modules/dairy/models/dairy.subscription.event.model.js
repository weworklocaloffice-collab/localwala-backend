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
 * DairySubscriptionEvent — append-only audit of every lifecycle change.
 *
 * Append-only, for the same reason `DairyCanLedger` is: when a customer says
 * "I changed my quantity on the 4th and you still charged me for two litres",
 * the only trustworthy answer is the event history. A mutable "last modified"
 * field cannot answer that.
 */
const dairySubscriptionEventSchema = mongoose.Schema(
  {
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairySubscription',
      required: true,
    },
    /**
     * created          — plan activated
     * skipped          — a specific delivery skipped
     * unskipped        — a skip withdrawn before the run was generated
     * paused           — generation suspended
     * resumed          — generation restarted
     * quantity_changed — quantity updated
     * address_changed  — delivery address updated
     * schedule_changed — recurrence or slot updated
     * cancelled        — plan ended
     * reactivated      — plan restarted after cancellation
     * delivery         — an occurrence was delivered
     */
    eventType: {
      type: String,
      required: true,
    },
    /**
     * Field-level before/after for mutating events, so the history is
     * self-describing without replaying every document.
     */
    changes: {
      type: mongoose.SchemaTypes.Mixed,
      required: false,
    },
    /** Present for `skipped` events. */
    skippedDate: {
      type: Date,
      required: false,
    },
    reason: {
      type: String,
      required: false,
    },
    /** `customer` or the outlet/admin that made the change. */
    actorType: {
      type: String,
      required: false,
      default: 'customer',
    },
    actor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    /**
     * Set when the change took effect immediately versus on the next occurrence,
     * so a mid-cycle change is auditable.
     */
    effectiveFrom: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairySubscriptionEventSchema.plugin(toJSON);
dairySubscriptionEventSchema.plugin(paginate);
dairySubscriptionEventSchema.index({ subscription: 1, createdAt: -1 });
dairySubscriptionEventSchema.index({ eventType: 1, createdAt: -1 });

/**
 * @typedef DairySubscriptionEvent
 */
const DairySubscriptionEvent = mongoose.model(
  'DairySubscriptionEvent',
  dairySubscriptionEventSchema
);

module.exports = DairySubscriptionEvent;