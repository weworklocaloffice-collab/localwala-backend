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
 * RealEstateExecutive — a field sales executive.
 *
 * ## What this is
 *
 * An executive is the field agent who conducts site visits, records customer
 * interest, and progresses leads toward a sale. They are NOT a delivery
 * driver, NOT a dairy runner, and NOT a bank officer.
 *
 * ## `operationalZone` — the assignment boundary
 *
 * An executive is assigned to one operational zone. The assignment engine
 * (in `realestate.lead.service.js`) uses this to match executives to leads
 * in the same zone. BR-19: the zone is never written to the customer's
 * permanent address.
 *
 * ## `maxConcurrentVisits` — load cap
 *
 * The assignment engine will not assign a new visit to an executive who
 * already has this many active visits. Default 5.
 *
 * ## `available` — whether the executive is currently accepting assignments
 *
 * An executive who is offline, on leave, or otherwise unavailable sets this
 * to false. The assignment engine skips them.
 *
 * ## `checkInRadiusMeters` — geofence for visit check-in (BR-08)
 *
 * Defaults to 200m. Stored on the VISIT at scheduling time, not here, so a
 * later config change cannot retroactively invalidate a completed visit.
 */
const realEstateExecutiveSchema = mongoose.Schema(
  {
    /**
     * The login this executive operates as.
     */
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    /**
     * The operational zone this executive is assigned to.
     */
    operationalZone: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'OperationalZone',
      required: true,
    },

    /**
     * The city this executive operates in (fallback for assignment).
     */
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: true,
    },

    /**
     * Display name for the executive.
     */
    name: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Mobile number for customer contact.
     */
    mobile: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Whether the executive is currently accepting assignments.
     */
    available: {
      type: Boolean,
      required: true,
      default: true,
    },

    /**
     * Maximum concurrent active visits.
     */
    maxConcurrentVisits: {
      type: Number,
      required: false,
      default: 5,
      min: 1,
    },

    /**
     * When the executive was last assigned a lead (for round-robin).
     */
    lastAssignedAt: {
      type: Date,
      required: false,
    },

    /**
     * Current location (updated by the app during visits).
     */
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
      },
    },

    /**
     * Whether the executive is active (not suspended/terminated).
     */
    status: {
      type: String,
      required: true,
      default: 'ACTIVE',
      enum: ['ACTIVE', 'SUSPENDED', 'TERMINATED'],
    },

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
realEstateExecutiveSchema.plugin(toJSON);
realEstateExecutiveSchema.plugin(paginate);

// ---- indexes ----

realEstateExecutiveSchema.index({ user: 1 }, { unique: true });
realEstateExecutiveSchema.index({ operationalZone: 1, available: 1 });
realEstateExecutiveSchema.index({ city: 1, available: 1 });
realEstateExecutiveSchema.index({ status: 1 });

/**
 * @typedef RealEstateExecutive
 */
const RealEstateExecutive = mongoose.model('RealEstateExecutive', realEstateExecutiveSchema);

module.exports = RealEstateExecutive;
