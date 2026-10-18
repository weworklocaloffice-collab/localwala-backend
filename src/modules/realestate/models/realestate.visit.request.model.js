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
 * RealEstateVisitRequest — a customer's request to visit a property.
 *
 * ## Lifecycle
 *
 * PENDING_ASSIGNMENT → ASSIGNED → ACCEPTED → CHECK_IN → IN_PROGRESS → COMPLETED
 *                                                              ↘ CANCELLED
 *
 * ## Assignment engine
 *
 * When a request is created, the assignment engine scores eligible executives
 * by: (a) same operational zone, (b) active load below maxConcurrentVisits,
 * (c) available flag, (d) round-robin on least-recently-assigned. Falls back
 * to any available executive in the city. If nobody is available, the request
 * stays PENDING_ASSIGNMENT and admin is notified.
 *
 * ## `preferredDate` / `preferredTimeSlot`
 *
 * The customer's preference. The executive can propose a different time,
 * which creates a new request with `supersedes` pointing to the original.
 */
const realEstateVisitRequestSchema = mongoose.Schema(
  {
    /**
     * The property to visit.
     */
    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    /**
     * The customer requesting the visit.
     */
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    /**
     * The lead this visit request came from.
     */
    lead: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLead',
      required: true,
    },

    /**
     * The assigned executive (null until assigned).
     */
    executive: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateExecutive',
      required: false,
    },

    /**
     * Current status.
     */
    status: {
      type: String,
      required: true,
      default: 'PENDING_ASSIGNMENT',
      enum: [
        'PENDING_ASSIGNMENT',
        'ASSIGNED',
        'ACCEPTED',
        'CHECK_IN',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
      ],
    },

    /**
     * Customer's preferred date.
     */
    preferredDate: {
      type: Date,
      required: true,
    },

    /**
     * Customer's preferred time slot.
     */
    preferredTimeSlot: {
      type: String,
      required: true,
      enum: ['MORNING', 'AFTERNOON', 'EVENING'],
    },

    /**
     * The actual visit created from this request.
     */
    visit: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVisit',
      required: false,
    },

    /**
     * If this request supersedes another, the original request.
     */
    supersedes: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVisitRequest',
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
     * The check-in radius for the visit created from this request.
     * Stored here so it can be copied to the visit at creation time.
     */
    checkInRadiusMeters: {
      type: Number,
      required: false,
      default: 200,
      min: 50,
      max: 1000,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & pagination
realEstateVisitRequestSchema.plugin(toJSON);
realEstateVisitRequestSchema.plugin(paginate);

// ---- indexes ----

realEstateVisitRequestSchema.index({ lead: 1, status: 1 });
realEstateVisitRequestSchema.index({ executive: 1, status: 1 });
realEstateVisitRequestSchema.index({ customer: 1, createdAt: -1 });
realEstateVisitRequestSchema.index({ property: 1, preferredDate: 1 });

/**
 * @typedef RealEstateVisitRequest
 */
const RealEstateVisitRequest = mongoose.model(
  'RealEstateVisitRequest',
  realEstateVisitRequestSchema
);

module.exports = RealEstateVisitRequest;
