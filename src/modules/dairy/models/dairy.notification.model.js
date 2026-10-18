/*
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
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

/**
 * A notice for one person, in the dairy vertical.
 *
 * ## Why a new model
 *
 * `NotificationList` exists and is used by the restaurant vertical. It is
 * shaped around that screen: `restaurantName`, `packageHelper`, `driverHelper` and
 * a set of parallel boolean "helper" columns that only mean anything in a food
 * ordering context. It also has no read tracking - `status` there means "the row
 * is current", not "the user has seen it" - so "mark all read" has nothing to
 * write to.
 *
 * Rather than bolt dairy fields onto a restaurant-shaped table, or reuse
 * `status` for a second meaning, this is a separate model with the two things a
 * notification list actually needs: a `kind` to drive an icon and a route, and
 * `readAt` to record that a person saw it.
 *
 * ## Scoping
 *
 * A notice is addressed to a *user*, never to a business. A partner who owns two
 * outlets gets one notice per outlet if both did the thing, which is correct:
 * they act as two operators.
 *
 * `business` is recorded alongside for context and for outlet-scoped queries, but
 * authorisation never reads it — the reader is always `req.user`.
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const KINDS = [
  'order_placed',
  'order_status',
  'run_dispatched',
  'stop_completed',
  'low_stock',
  'fssai_expiry',
  'settlement_paid',
  'payout_recorded',
  'subscription_paused',
  'compliance_failed',
];

const dairyNotificationSchema = mongoose.Schema(
  {
    /** The person being told. Every read is scoped to this. */
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** The outlet the event happened at, for context and outlet-scoped queries. */
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: false,
    },
    kind: {
      type: String,
      required: true,
      enum: KINDS,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * Rendered inline. Kept short on purpose — a notice is a nudge, not a
     * report. Anything the person needs in full lives behind the `payload`
     * reference.
     */
    content: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * What the app needs to route on and render a line: ids and figures.
     * `{ order: '...', amount: 126 }` and so on, varying by `kind`.
     */
    payload: {
      type: mongoose.SchemaTypes.Mixed,
      default: {},
    },
    /**
     * When the person saw it. Null until they do.
     *
     * A separate column rather than a boolean so "read at" is answerable, which
     * is the question support actually asks — not "is this read" but "when did
     * they last look".
     */
    readAt: {
      type: Date,
      required: false,
      default: null,
    },
    /**
     * Whether the notice still belongs on the list. Used when something it
     * refers to is retracted, so the row is kept for audit and hidden from the
     * reader rather than deleted.
     */
    dismissed: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

dairyNotificationSchema.plugin(toJSON);
dairyNotificationSchema.plugin(paginate);

// The list query: one user's notices, newest first.
dairyNotificationSchema.index({ user: 1, dismissed: 1, createdAt: -1 });

// Supports the unread count without loading the rows.
dairyNotificationSchema.index({ user: 1, readAt: 1 });

/**
 * @typedef DairyNotification
 */

const DairyNotification = mongoose.model('DairyNotification', dairyNotificationSchema);

module.exports = DairyNotification;
module.exports.KINDS = KINDS;