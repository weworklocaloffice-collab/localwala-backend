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
const moneyField = require('../../../utils/money.field');

/**
 * JhatkaDriver — a rider. §13.5.
 *
 * ## `JhatkaDriver`, not `DairyDriver`, and not `DeliveryRun`
 *
 * `kernel/delivery/DeliveryRun.agent` refs `DairyDriver` specifically, and
 * `DeliveryRun.totals` carries `cansOut`/`cansIn` with a return-leg reconciliation
 * gate. That is a milk-can manifest, not a grocery delivery: a Jhatka run is one
 * rider, one order, one customer, no deposit, no return leg. Reusing it means
 * shipping `cansOut: 0` on every run or generalising a kernel model with no service
 * behind it. §13.2.
 *
 * ## `outlet: null` IS the platform pool
 *
 * The convention copied from `delivery.run.service.assignAgent`: `outlet` set
 * means an outlet-owned rider, `null` means a LocalWala-employed rider available to
 * any outlet. An explicit `null` rather than an absent field, because "belongs to
 * nobody in particular" and "the record is incomplete" must not be the same value.
 *
 * ## Soft-deactivate only. BR-24.
 *
 * A driver's delivery history is a `JhatkaDeliverySettlement` input. Deleting one
 * destroys the ability to reconcile a payout. There is no delete route and no
 * delete method.
 */
const DRIVER_STATUSES = ['active', 'inactive', 'suspended'];

const jhatkaDriverSchema = mongoose.Schema(
  {
    driverCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    /** The rider's login. */
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    mobile: {
      type: Number,
      required: true,
    },
    /**
     * The outlet this rider belongs to, or `null` for the platform pool.
     *
     * Copied verbatim from `delivery.run.service.assignAgent`'s convention.
     */
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: false,
      default: null,
    },
    vehicle: {
      type: {
        type: String,
        required: false,
        enum: ['bicycle', 'motorcycle', 'scooter', 'van', 'on_foot', 'cargo_tempo'],
      },
      number: { type: String, required: false, trim: true, uppercase: true },
      model: { type: String, required: false, trim: true },
      /**
       * Vehicle document expiry is a COMPLIANCE item, not a note. An expired
       * insurance certificate on a delivery bike is both a legal and a safety
       * problem, and it belongs on the expiry sweep alongside the outlet's FSSAI.
       */
      insuranceExpiry: { type: Date, required: false },
      permitExpiry: { type: Date, required: false },
      fitnessExpiry: { type: Date, required: false },
    },
    /** Rider's own documents: licence, FSSAI food-handler card, ID. */
    documents: [
      {
        _id: false,
        type: {
          type: String,
          required: true,
          enum: ['aadhaar', 'pan', 'driving_licence', 'fssai_handler', 'vehicle_rc', 'insurance', 'police_clearance', 'other'],
        },
        reference: { type: String, required: false, trim: true },
        issuedAt: { type: Date, required: false },
        expiresAt: { type: Date, required: false, default: undefined },
        fileUrl: { type: String, required: false },
        status: {
          type: String,
          required: false,
          enum: ['pending', 'valid', 'expiring', 'expired', 'rejected'],
          default: 'pending',
        },
        verifiedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        verifiedAt: { type: Date, required: false },
      },
    ],
    /**
     * Availability, separate from `status`.
     *
     * A rider on a break is `available: false` and still `active`. Conflating the
     * two means a five-minute break suspends a rider and their payout history stops
     * accumulating.
     */
    available: {
      type: Boolean,
      required: false,
      default: true,
    },
    status: {
      type: String,
      required: false,
      enum: DRIVER_STATUSES,
      default: 'active',
    },
    /** Blocked by admin, distinct from suspended so the reason is legible. */
    isBlocked: {
      type: Boolean,
      required: false,
      default: false,
    },
    blockReason: {
      type: String,
      required: false,
      trim: true,
    },
    statusReason: {
      type: String,
      required: false,
      trim: true,
    },
    /**
     * Who pays this rider. Mirrors `JhatkaOutlet.driverPayoutMode` semantics:
     * `business_pays` for an outlet-owned fleet, `platform_pays` for the pool.
     *
     * Copied onto the DELIVERY at assignment time rather than read from the outlet
     * at settlement time — an outlet that changes its mode mid-day must not
     * retroactively change who paid last week's riders.
     */
    payoutMode: {
      type: String,
      required: false,
      enum: ['business_pays', 'platform_pays'],
      default: 'platform_pays',
    },
    rating: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
      max: 5,
    },
    /** Lifetime counters. Read-only. */
    stats: {
      totalDeliveries: { type: Number, required: false, default: 0, min: 0 },
      totalOnTime: { type: Number, required: false, default: 0, min: 0 },
      totalCodCollected: moneyField(0),
      totalFailed: { type: Number, required: false, default: 0, min: 0 },
      lastDeliveryAt: { type: Date, required: false },
    },
    activatedAt: { type: Date, required: false },
    suspendedAt: { type: Date, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaDriverSchema.plugin(toJSON);
jhatkaDriverSchema.plugin(paginate);
jhatkaDriverSchema.index({ driverCode: 1 }, { unique: true });
jhatkaDriverSchema.index({ user: 1 }, { unique: true });
/**
 * The dispatcher's rider picker, and `assignAgent`'s own query.
 *
 * The partial index on `outlet: null` is what makes the platform pool lookup
 * cheap. `delivery.run.service` filters `business: null` on `DairyDriver` with no
 * matching index, so that query is a scan of every rider in the system.
 */
jhatkaDriverSchema.index({ outlet: 1, status: 1, available: 1 });
jhatkaDriverSchema.index({ outlet: 1, status: 1, isBlocked: 1 });
jhatkaDriverSchema.index({ mobile: 1 });
// Compliance sweeps for vehicle and rider documents.
jhatkaDriverSchema.index({ 'documents.expiresAt': 1 });
jhatkaDriverSchema.index({ 'vehicle.insuranceExpiry': 1, 'vehicle.permitExpiry': 1 });

jhatkaDriverSchema.statics.STATUSES = DRIVER_STATUSES;

/**
 * May this rider be assigned a delivery right now?
 *
 * The single predicate `jhatka.delivery.service` calls before every assignment,
 * so "can be assigned" has one definition rather than four call sites each
 * remembering a subset of the conditions.
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
jhatkaDriverSchema.methods.canBeAssigned = function (now = new Date()) {
  if (this.status !== 'active') return false;
  if (this.isBlocked) return false;
  if (!this.available) return false;

  // An expired insurance certificate or permit is a legal exposure on the road,
  // not a paperwork item, so it blocks assignment rather than only warning.
  const v = this.vehicle || {};
  if (v.insuranceExpiry && new Date(v.insuranceExpiry) <= now) return false;
  if (v.permitExpiry && new Date(v.permitExpiry) <= now) return false;

  return true;
};

/**
 * Is this rider a platform-pool rider?
 */
jhatkaDriverSchema.methods.isPlatformPool = function () {
  return this.outlet === null || this.outlet === undefined;
};

/**
 * @typedef JhatkaDriver
 */
const JhatkaDriver = mongoose.model('JhatkaDriver', jhatkaDriverSchema);

module.exports = JhatkaDriver;