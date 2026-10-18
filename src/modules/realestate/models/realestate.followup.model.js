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
 * RealEstateFollowUp — a follow-up task on a lead.
 *
 * ## Lifecycle
 *
 * PENDING → COMPLETED
 *         → RESCHEDULED (→ new PENDING row, original keeps the link)
 *         → CANCELLED (reason required)
 *
 * ## `nextFollowUpAt` — indexed for the reminder cron
 *
 * Overdue follow-ups drive the executive dashboard tile in blueprint §41.
 * The cron scans for PENDING follow-ups where `nextFollowUpAt < now` and
 * creates notifications.
 *
 * ## Rescheduling
 *
 * Rescheduling does NOT update the original — it creates a new PENDING row
 * with `supersedes` pointing to the original. The original keeps its status
 * and the link, so the history of reschedules is visible.
 */
const realEstateFollowUpSchema = mongoose.Schema(
  {
    /**
     * The lead this follow-up is for.
     */
    lead: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLead',
      required: true,
    },

    /**
     * The executive responsible for this follow-up.
     */
    executive: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateExecutive',
      required: true,
    },

    /**
     * Current status.
     */
    status: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'COMPLETED', 'RESCHEDULED', 'CANCELLED'],
    },

    /**
     * When the follow-up is due.
     */
    nextFollowUpAt: {
      type: Date,
      required: true,
    },

    /**
     * How the follow-up will be conducted.
     */
    mode: {
      type: String,
      required: true,
      enum: ['CALL', 'WHATSAPP', 'SMS', 'EMAIL', 'IN_PERSON'],
    },

    /**
     * Notes about what to follow up on.
     */
    notes: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * Cancellation reason (required if status is CANCELLED).
     */
    cancellationReason: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * If this follow-up supersedes another, the original.
     */
    supersedes: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateFollowUp',
      required: false,
    },

    /**
     * When the follow-up was completed.
     */
    completedAt: {
      type: Date,
      required: false,
    },

    /**
     * Who completed the follow-up.
     */
    completedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateExecutive',
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & pagination
realEstateFollowUpSchema.plugin(toJSON);
realEstateFollowUpSchema.plugin(paginate);

// ---- indexes ----

realEstateFollowUpSchema.index({ lead: 1, status: 1 });
realEstateFollowUpSchema.index({ executive: 1, status: 1, nextFollowUpAt: 1 });
realEstateFollowUpSchema.index({ nextFollowUpAt: 1 }, { sparse: true });

/**
 * @typedef RealEstateFollowUp
 */
const RealEstateFollowUp = mongoose.model('RealEstateFollowUp', realEstateFollowUpSchema);

module.exports = RealEstateFollowUp;
