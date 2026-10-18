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
 * RealEstateInterest — a structured customer interest record (BR-09).
 *
 * ## BR-09: Customer interest is structured, from a closed enum
 *
 * Free-text opinion is not interest. The level and reason are both closed
 * enums. `reason` is required for `NOT_INTERESTED` and `MAYBE_FOLLOW_UP`.
 * `OTHER` requires `reasonText`.
 *
 * ## One interest per visit
 *
 * A partial unique index on `visit` ensures one interest record per visit.
 * A change after completion creates a new row with `supersedes`, so "the
 * executive changed their mind" is visible rather than erased.
 */
const realEstateInterestSchema = mongoose.Schema(
  {
    /**
     * The visit this interest was recorded during.
     */
    visit: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVisit',
      required: true,
    },

    /**
     * The lead this interest is part of.
     */
    lead: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLead',
      required: true,
    },

    /**
     * Interest level (closed enum).
     */
    level: {
      type: String,
      required: true,
      enum: [
        'VERY_INTERESTED',
        'INTERESTED',
        'MAYBE_FOLLOW_UP',
        'NOT_INTERESTED',
        'INTERESTED_IN_OTHER_PROPERTY',
        'PURCHASE_DECISION_PENDING',
      ],
    },

    /**
     * Reason code (closed enum).
     */
    reason: {
      type: String,
      required: false,
      enum: [
        'PRICE',
        'LOCATION',
        'PROPERTY_CONDITION',
        'DOCUMENTATION',
        'NEGOTIATION',
        'ANOTHER_VISIT',
        'LOAN_REQUIRED',
        'OTHER',
      ],
    },

    /**
     * Free-text reason (required when reason is OTHER).
     */
    reasonText: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * The executive who recorded this interest.
     */
    recordedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateExecutive',
      required: true,
    },

    /**
     * When this interest was recorded.
     */
    recordedAt: {
      type: Date,
      required: false,
      default: Date.now,
    },

    /**
     * If this record supersedes another, the original record.
     */
    supersedes: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateInterest',
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & pagination
realEstateInterestSchema.plugin(toJSON);
realEstateInterestSchema.plugin(paginate);

// ---- indexes ----

realEstateInterestSchema.index({ visit: 1 }, { unique: true, name: 'one_interest_per_visit' });
realEstateInterestSchema.index({ lead: 1, recordedAt: -1 });

/**
 * @typedef RealEstateInterest
 */
const RealEstateInterest = mongoose.model('RealEstateInterest', realEstateInterestSchema);

module.exports = RealEstateInterest;
