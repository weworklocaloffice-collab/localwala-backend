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
 * RealEstateLead — a customer's interest in a property.
 *
 * ## BR-06: An enquiry creates a Lead. It is never a contact message.
 *
 * Every enquiry from a customer about a property creates exactly one Lead.
 * A Lead is not a "contact us" form submission — it is a structured record
 * of interest in a specific property, with a lifecycle, an assigned executive,
 * and a trail of activities.
 *
 * ## BR-07: One assigned executive at a time.
 *
 * `executive` holds the current assignment. Reassignment does NOT overwrite —
 * it creates a new LeadActivity row with `action: 'REASSIGNED'` recording
 * who was replaced, who replaced them, and why. The old executive remains
 * visible in the activity history.
 *
 * ## Lifecycle (blueprint §16)
 *
 * ```
 * NEW → CONTACTED → VISIT_REQUESTED → VISIT_SCHEDULED → VISIT_COMPLETED
 *   → FOLLOW_UP → HOLD → SALE
 *                                     ↘ LOST (from any pre-SALE state)
 * ```
 *
 * Terminal states: SALE, LOST. A lead in LOST can be re-opened only by admin,
 * with a recorded reason.
 *
 * ## `source` — how the lead was created
 *
 * `ENQUIRY` (customer enquired), `REFERRAL` (referral code), `WALK_IN`
 * (executive created manually), `ADMIN` (admin created). The source determines
 * whether a referral record is expected alongside the lead.
 *
 * ## `interest` — structured customer interest (BR-09)
 *
 * Not free text. A closed enum for level, a closed enum for reason. Stored
 * as a subdocument so it can be superseded without erasing history.
 */
const realEstateLeadSchema = mongoose.Schema(
  {
    /**
     * Human-facing lead code, e.g. "LEAD-HYD-000123".
     */
    leadCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    /**
     * The property this lead is about.
     */
    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    /**
     * The customer who enquired.
     */
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    /**
     * The vendor who owns the property (denormalised for vendor dashboard).
     */
    vendor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVendor',
      required: false,
    },

    /**
     * The executive currently assigned to this lead.
     * BR-07: reassignment is recorded in LeadActivity, never overwritten.
     */
    executive: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateExecutive',
      required: false,
    },

    /**
     * How this lead was created.
     */
    source: {
      type: String,
      required: true,
      enum: ['ENQUIRY', 'REFERRAL', 'WALK_IN', 'ADMIN'],
      default: 'ENQUIRY',
    },

    /**
     * The referral record, if this lead came from a referral code.
     */
    referral: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateReferral',
      required: false,
    },

    /**
     * Current lifecycle state.
     */
    status: {
      type: String,
      required: true,
      default: 'NEW',
      enum: [
        'NEW',
        'CONTACTED',
        'VISIT_REQUESTED',
        'VISIT_SCHEDULED',
        'VISIT_COMPLETED',
        'FOLLOW_UP',
        'HOLD',
        'SALE',
        'LOST',
      ],
    },

    /**
     * Structured customer interest (BR-09).
     */
    interest: {
      level: {
        type: String,
        required: false,
        enum: [
          'VERY_INTERESTED',
          'INTERESTED',
          'MAYBE_FOLLOW_UP',
          'NOT_INTERESTED',
          'INTERESTED_IN_OTHER_PROPERTY',
          'PURCHASE_DECISION_PENDING',
        ],
      },
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
      reasonText: {
        type: String,
        required: false,
        trim: true,
      },
      recordedAt: { type: Date, required: false },
      supersedes: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'RealEstateLead',
        required: false,
      },
    },

    /**
     * Why the lead was lost (required when status is LOST).
     */
    lostReason: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * Why a LOST lead was re-opened (admin only, required).
     */
    reopenReason: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * The hold this lead progressed to, if any.
     */
    hold: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstatePropertyHold',
      required: false,
    },

    /**
     * The sale this lead closed into, if any.
     */
    sale: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateSale',
      required: false,
    },

    /**
     * The operational zone of the property at lead creation.
     * BR-19: never written to the customer's permanent address.
     */
    operationalZone: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'OperationalZone',
      required: false,
    },

    /**
     * Denormalised counters for the vendor/executive dashboard.
     */
    visitCount: { type: Number, required: false, default: 0, min: 0 },
    followUpCount: { type: Number, required: false, default: 0, min: 0 },

    createdBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & pagination
realEstateLeadSchema.plugin(toJSON);
realEstateLeadSchema.plugin(paginate);

// ---- indexes ----

realEstateLeadSchema.index({ leadCode: 1 }, { unique: true });
realEstateLeadSchema.index({ property: 1, status: 1 });
realEstateLeadSchema.index({ customer: 1, createdAt: -1 });
realEstateLeadSchema.index({ executive: 1, status: 1 });
realEstateLeadSchema.index({ vendor: 1, status: 1, createdAt: -1 });
realEstateLeadSchema.index({ status: 1, createdAt: -1 });

/**
 * @typedef RealEstateLead
 */
const RealEstateLead = mongoose.model('RealEstateLead', realEstateLeadSchema);

module.exports = RealEstateLead;
