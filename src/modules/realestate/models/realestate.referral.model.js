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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * RealEstateReferral — a referral attribution record.
 *
 * ## What this is
 *
 * When a customer enquires about a property using a referral code, this model
 * records: who referred (the referrer), which code was used, which lead was
 * created, and what commission is owed when the lead converts to a sale.
 *
 * ## BR-16: Commission is on LocalWala's commission, never on sale value.
 *
 * The referral commission is computed as a percentage of LocalWala's commission,
 * not the property sale value. This is enforced in the commission service,
 * not here — this model stores the *rate* and the *attribution*.
 *
 * ## `referralCode` — the code that was used
 *
 * The code itself lives in `models/referral.codes.model.js` (existing, shared).
 * This model stores a snapshot of the code and the referrer at the time of use,
 * so a later change to the code does not rewrite history.
 *
 * ## `status`
 *
 * `PENDING` (lead created, no sale yet), `QUALIFIED` (lead reached HOLD or
 * SALE), `COMMISSION_EARNED` (sale recorded, commission computed),
 * `COMMISSION_PAID` (commission settled), `EXPIRED` (lead lost, no sale).
 *
 * ## One referral per lead
 *
 * A partial unique index on `lead` ensures a lead cannot be attributed to
 * multiple referral codes. If a customer tries to use a second code on the
 * same property, the second enquiry creates a new lead but no new referral.
 */
const realEstateReferralSchema = mongoose.Schema(
  {
    /**
     * The referral code that was used.
     */
    referralCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    /**
     * The person who referred (the code holder).
     */
    referrer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    /**
     * The lead created from this referral.
     */
    lead: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLead',
      required: true,
    },

    /**
     * The property the referral is for.
     */
    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    /**
     * The customer who used the code.
     */
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    /**
     * The referral commission rate (percentage of LocalWala's commission).
     * Snapshot at the time of referral — a later rate change does not
     * rewrite this record (BR-15).
     */
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    /**
     * The commission amount, computed at sale time.
     * Null until the lead converts to a sale.
     */
    commissionAmount: {
      type: Number,
      required: false,
    },

    /**
     * Current status of this referral.
     */
    status: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'QUALIFIED', 'COMMISSION_EARNED', 'COMMISSION_PAID', 'EXPIRED'],
    },

    /**
     * The sale that this referral contributed to, if any.
     */
    sale: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateSale',
      required: false,
    },

    /**
     * The commission record created for this referral, if any.
     */
    commission: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateCommission',
      required: false,
    },

    /**
     * When the referral was created.
     */
    usedAt: {
      type: Date,
      required: false,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & pagination
realEstateReferralSchema.plugin(toJSON);
realEstateReferralSchema.plugin(paginate);

// ---- indexes ----

realEstateReferralSchema.index({ referralCode: 1, createdAt: -1 });
realEstateReferralSchema.index({ referrer: 1, status: 1 });
realEstateReferralSchema.index({ lead: 1 }, { unique: true, name: 'one_referral_per_lead' });
realEstateReferralSchema.index({ property: 1, createdAt: -1 });

/**
 * @typedef RealEstateReferral
 */
const RealEstateReferral = mongoose.model('RealEstateReferral', realEstateReferralSchema);

module.exports = RealEstateReferral;
