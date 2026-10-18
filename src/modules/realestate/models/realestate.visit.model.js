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
 * RealEstateVisit — a completed or in-progress site visit.
 *
 * ## BR-08: Check-in geofence
 *
 * An executive cannot self-report a visit without a geolocation-verified
 * check-in. `VISIT_COMPLETED` requires a `checkIn` with coordinates inside
 * `checkInRadiusMeters` of the property.
 *
 * `checkInRadiusMeters` is stored ON THE VISIT at scheduling time, not on
 * the executive or in a global config. A later config change cannot
 * retroactively invalidate yesterday's completed visit.
 *
 * ## Lifecycle
 *
 * ASSIGNED → ACCEPTED → CHECK_IN → IN_PROGRESS → COMPLETED
 *                                              ↘ CANCELLED
 *
 * ## `checkIn` — the geofenced check-in record
 *
 * Stored as a subdocument with coordinates, timestamp, and distance from
 * the property. The distance is computed at check-in time and stored, so
 * a later property location change does not rewrite history.
 */
const realEstateVisitSchema = mongoose.Schema(
  {
    /**
     * The property being visited.
     */
    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    /**
     * The customer who attended.
     */
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    /**
     * The lead this visit is part of.
     */
    lead: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLead',
      required: true,
    },

    /**
     * The executive conducting the visit.
     */
    executive: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateExecutive',
      required: true,
    },

    /**
     * The visit request that created this visit.
     */
    request: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVisitRequest',
      required: true,
    },

    /**
     * Current status.
     */
    status: {
      type: String,
      required: true,
      default: 'ASSIGNED',
      enum: ['ASSIGNED', 'ACCEPTED', 'CHECK_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    },

    /**
     * Scheduled date and time.
     */
    scheduledAt: {
      type: Date,
      required: true,
    },

    /**
     * The geofence radius for this visit (stored at scheduling time).
     */
    checkInRadiusMeters: {
      type: Number,
      required: true,
      default: 200,
      min: 50,
      max: 1000,
    },

    /**
     * The geofenced check-in record.
     */
    checkIn: {
      coordinates: {
        type: [Number],
        required: false,
      },
      timestamp: {
        type: Date,
        required: false,
      },
      distanceMeters: {
        type: Number,
        required: false,
      },
    },

    /**
     * When the visit actually started.
     */
    startedAt: {
      type: Date,
      required: false,
    },

    /**
     * When the visit was completed.
     */
    completedAt: {
      type: Date,
      required: false,
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
     * Notes recorded during the visit.
     */
    notes: {
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

// add plugin that converts mongoose to json & pagination
realEstateVisitSchema.plugin(toJSON);
realEstateVisitSchema.plugin(paginate);

// ---- indexes ----

realEstateVisitSchema.index({ lead: 1, status: 1 });
realEstateVisitSchema.index({ executive: 1, status: 1, scheduledAt: 1 });
realEstateVisitSchema.index({ customer: 1, createdAt: -1 });
realEstateVisitSchema.index({ property: 1, scheduledAt: 1 });

/**
 * @typedef RealEstateVisit
 */
const RealEstateVisit = mongoose.model('RealEstateVisit', realEstateVisitSchema);

module.exports = RealEstateVisit;
