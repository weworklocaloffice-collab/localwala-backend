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
 * A partner's invitation to a rider.
 *
 * ## Why this exists
 *
 * Driver self-registration used to accept an `invitedBy` user id and attach the
 * new rider to whichever outlet owned that user. Nothing tied the invitation to
 * the outlet, so anyone who knew a partner's user id - a public-looking value in
 * a payload - could register themselves onto a competitor's fleet and appear on
 * their roster.
 *
 * An invitation is now a row the *partner* creates. The rider's registration is
 * matched against it by mobile number, which is the one identifier the OTP flow
 * has already proven they hold. That inverts the trust: the client no longer
 * asserts who invited them.
 *
 * ## Lifecycle
 *
 *   pending  → the outlet is waiting for this rider to sign up
 *   accepted → the rider registered and is on the fleet
 *   expired  → past `expiresAt`; the rider never joined
 *   revoked  → the outlet withdrew it
 *
 * `accepted` is the audit trail: it records which outlet invited a rider, which is
 * not derivable from `DairyDriver.business` alone once the rider moves fleets.
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const dairyDriverInviteSchema = mongoose.Schema(
  {
    /** The outlet that issued the invitation. */
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    /**
     * The partner who invited, for the audit trail. Not load-bearing for
     * authorisation - `business` is - but it answers "who pressed the button".
     */
    invitedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    /**
     * The rider being invited, identified by phone because that is what they
     * will register with and what the OTP proves they hold.
     */
    countryCode: {
      type: String,
      required: true,
      default: '+91',
      trim: true,
    },
    mobile: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      required: false,
      enum: ['pending', 'accepted', 'expired', 'revoked'],
      default: 'pending',
    },
    /** Set when the rider accepts, so a pending invite can be found by rider. */
    rider: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    acceptedAt: {
      type: Date,
      required: false,
    },
    revokedAt: {
      type: Date,
      required: false,
    },
    /**
     * Revoking is deliberate, so the reason is kept. A rider removed from a fleet
     * deserves to know why, and "offboarded" and "never got along" are different
     * conversations with the same person.
     */
    reason: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

dairyDriverInviteSchema.plugin(toJSON);
dairyDriverInviteSchema.plugin(paginate);

// An outlet can only hold one live invitation per phone number. The partial
// filter means a revoked or expired invite does not block a fresh one, which a
// plain unique index on `{ business, mobile }` would.
dairyDriverInviteSchema.index(
  { business: 1, mobile: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'dairy_driver_invite_pending_unique',
  }
);

dairyDriverInviteSchema.index({ mobile: 1, status: 1 });

/**
 * @typedef DairyDriverInvite
 */

const DairyDriverInvite = mongoose.model('DairyDriverInvite', dairyDriverInviteSchema);

module.exports = DairyDriverInvite;