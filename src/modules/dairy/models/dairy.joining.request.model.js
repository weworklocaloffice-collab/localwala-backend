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
 * DairyJoiningRequest — admin review queue for a self-registered dairy partner.
 *
 * Mirrors `RestaurantJoiningRequest` (`models/restaurant.joining.request.model.js`)
 * and `DeliverymanJoiningRequest`, which are how this platform already onboards
 * vendors and deliverymen. A small dairy operator will never be onboarded by a
 * sales rep, so the account is created on self-registration and this document
 * carries the compliance work (FSSAI licence, GST, identity) for an admin to
 * verify.
 *
 * Registration never blocks on this document. It gates commercial actions —
 * receiving orders and raising payouts — not login, so the app is demonstrable
 * from the first sign-up.
 */
const dairyJoiningRequestSchema = mongoose.Schema(
  {
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
    businessModel: {
      type: String,
      required: false,
      default: 'direct', // direct, franchise, commission_partner
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: false,
      trim: true,
    },
    shortDescription: {
      type: String,
      required: false,
      trim: true,
    },
    logo: {
      type: String,
      required: false,
    },
    cover: {
      type: String,
      required: false,
    },
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: false,
    },
    locality: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Locality',
      required: false,
    },
    /** See the note on `DeliveryStop.location` — no nested Point default. */
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        required: false,
      },
    },
    /**
     * Rider count the applicant expects to field. Informational only — a
     * partner may own no riders at all and draw from the platform pool.
     */
    expectedDrivers: {
      type: Number,
      required: false,
      default: 0,
    },
    /**
     * Compliance documents. FSSAI is the mandatory one for a dairy business in
     * India; expiry is tracked because a lapsed licence must suspend trading.
     */
    fssaiLicence: {
      type: String,
      required: false,
      trim: true,
    },
    fssaiExpiry: {
      type: Date,
      required: false,
    },
    gstNumber: {
      type: String,
      required: false,
      trim: true,
    },
    identityProof: {
      type: String,
      required: false,
    },
    /**
     * pending   — awaiting admin review
     * approved  — may trade
     * rejected  — refused, with a reason
     */
    status: {
      type: String,
      required: false,
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      required: false,
    },
    verifiedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    verifiedAt: {
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
dairyJoiningRequestSchema.plugin(toJSON);
dairyJoiningRequestSchema.plugin(paginate);
dairyJoiningRequestSchema.index({ location: '2dsphere' });
dairyJoiningRequestSchema.index({ user: 1 });
dairyJoiningRequestSchema.index({ business: 1 });
dairyJoiningRequestSchema.index({ status: 1, createdAt: -1 });

/**
 * @typedef DairyJoiningRequest
 */
const DairyJoiningRequest = mongoose.model('DairyJoiningRequest', dairyJoiningRequestSchema);

module.exports = DairyJoiningRequest;