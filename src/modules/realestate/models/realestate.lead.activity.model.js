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
 * RealEstateLeadActivity — the audit trail for a lead.
 *
 * ## Why this exists
 *
 * BR-07 requires that executive reassignment is *recorded*, never silently
 * overwritten. BR-20 requires an audit record for every state transition
 * that changes a permission-bearing fact. This model serves both.
 *
 * Every action on a lead — creation, status change, reassignment, interest
 * recording, visit scheduling, loss, re-opening — creates one row here.
 * The lead's `status` field is the current state; this collection is the
 * history of how it got there.
 *
 * ## Append-only
 *
 * No service exposes an update or delete on this model. The only write path
 * is `realestate.lead.service.recordActivity()`. A test asserts no route
 * accepts PATCH or DELETE on a lead activity.
 *
 * ## `action` values
 *
 * `CREATED`, `STATUS_CHANGED`, `REASSIGNED`, `INTEREST_RECORDED`,
 * `VISIT_REQUESTED`, `VISIT_SCHEDULED`, `VISIT_COMPLETED`,
 * `FOLLOW_UP_CREATED`, `FOLLOW_UP_COMPLETED`, `LOST`, `REOPENED`,
 * `HOLD_CREATED`, `SALE_CREATED`
 */
const realEstateLeadActivitySchema = mongoose.Schema(
  {
    /**
     * The lead this activity belongs to.
     */
    lead: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLead',
      required: true,
    },

    /**
     * What happened.
     */
    action: {
      type: String,
      required: true,
      enum: [
        'CREATED',
        'STATUS_CHANGED',
        'REASSIGNED',
        'INTEREST_RECORDED',
        'VISIT_REQUESTED',
        'VISIT_SCHEDULED',
        'VISIT_COMPLETED',
        'FOLLOW_UP_CREATED',
        'FOLLOW_UP_COMPLETED',
        'LOST',
        'REOPENED',
        'HOLD_CREATED',
        'SALE_CREATED',
      ],
    },

    /**
     * The status before this action (null for CREATED).
     */
    fromStatus: {
      type: String,
      required: false,
    },

    /**
     * The status after this action.
     */
    toStatus: {
      type: String,
      required: false,
    },

    /**
     * For REASSIGNED: the executive being replaced.
     */
    fromExecutive: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateExecutive',
      required: false,
    },

    /**
     * For REASSIGNED: the new executive.
     */
    toExecutive: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateExecutive',
      required: false,
    },

    /**
     * Who performed this action.
     */
    actor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },

    /**
     * The actor's role at the time of the action.
     */
    actorType: {
      type: String,
      required: false,
      enum: ['CUSTOMER', 'VENDOR', 'EXECUTIVE', 'BANK', 'ADMIN', 'SYSTEM'],
    },

    /**
     * Free-text note. Required for LOST and REOPENED.
     */
    note: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * Structured metadata for specific actions.
     * For INTEREST_RECORDED: { level, reason, reasonText }
     * For STATUS_CHANGED: { reason }
     */
    metadata: {
      type: Object,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & pagination
realEstateLeadActivitySchema.plugin(toJSON);
realEstateLeadActivitySchema.plugin(paginate);

// ---- indexes ----

realEstateLeadActivitySchema.index({ lead: 1, createdAt: -1 });
realEstateLeadActivitySchema.index({ action: 1, createdAt: -1 });

/**
 * @typedef RealEstateLeadActivity
 */
const RealEstateLeadActivity = mongoose.model(
  'RealEstateLeadActivity',
  realEstateLeadActivitySchema
);

module.exports = RealEstateLeadActivity;
