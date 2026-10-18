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
 * DairyDriver — a dairy route rider.
 *
 * Modelled separately from `Driver` (models/driver.model.js) because that model
 * requires both `vehicle` and `drivingLicense`, which a cycle-based milk rider
 * will not have. The `ownFleet` vs `platformPool` split reuses the pattern
 * already proven at `models/driver.model.js:36` where `Driver.restaurant` is
 * `required: false`:
 *
 *   business set    → the rider belongs to this business (own fleet)
 *   business null   → the rider belongs to the platform pool
 */
const dairyDriverSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
      /**
       * The outlet that employs this rider. Required.
       *
       * This used to be the own-fleet / platform-pool discriminator, nullable to
       * mean "the platform dispatches this rider". There is no platform pool in
       * dairy, so the field can no longer be null: a rider without an outlet would
       * have nobody to inherit a location from, nobody to inherit a route from, and
       * nobody paying them.
       */
      business: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Business',
        required: true,
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
    /**
     * Where this rider is based, as a GeoJSON point.
     *
     * Copied from the inviting outlet at registration, so a rider is never at null
     * island. The field had to exist for that to work: `registerDriver` has always
     * written `location: inheritedLocation.location`, but with no `location` path on
     * the schema Mongoose strict mode dropped it on every save. The write looked
     * correct and stored nothing.
     *
     * Optional, because an outlet may itself have no coordinates. A rider with none
     * is a real possibility, and forcing a value would mean inventing a position.
     * A `2dsphere` index ignores documents where the field is missing, so an absent
     * point does not break the index.
     *
     * Mirrors `Business.location` so both are queryable the same way.
     */
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
    territory: {
      localities: [
        {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'Locality',
          required: false,
        },
      ],
    },
    /**
     * Determines the shape of the rider earnings screen: a per-litre or per-can
     * payout does not read like the food driver's per-order incentive.
     */
    payoutMode: {
      type: String,
      required: false,
      default: 'per_can', // per_litre, per_can, salary
    },
    payoutRate: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    /**
     * How many cans the rider can physically carry. Used by the depot
     * reconciliation maths and by manifest planning.
     */
    canCapacity: {
      type: Number,
      required: false,
      default: 0,
    },
    vehicleType: {
      type: String,
      required: false,
      default: 'cycle', // cycle, bike, mini_truck, on_foot
    },
    identity: {
      type: String,
      required: false,
    },
    identityNumber: {
      type: String,
      required: false,
    },
    identityProof: {
      type: String,
      required: false,
    },
    /**
     * Rider licence. Not `drivingLicense` — see the file header.
     */
    licence: {
      type: String,
      required: false,
    },
    licenceExpiry: {
      type: Date,
      required: false,
    },
    fssaiLicence: {
      type: String,
      required: false,
    },
    age: {
      type: Number,
      required: false,
    },
    dob: {
      type: Date,
      required: false,
    },
    isBlocked: {
      type: Boolean,
      required: false,
      default: false,
    },
    offlineReason: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DriverOfflineMessages',
      required: false,
    },
    activeStatus: {
      type: Boolean,
      required: false,
      default: true,
    },
    orderHandling: {
      type: Number,
      required: false,
      default: 0,
    },
    rating: {
      type: Number,
      required: false,
      default: 0,
    },
    status: {
      type: Boolean,
      required: false,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairyDriverSchema.plugin(toJSON);
dairyDriverSchema.plugin(paginate);
dairyDriverSchema.index({ userId: 1 });
dairyDriverSchema.index({ business: 1, activeStatus: 1 });
dairyDriverSchema.index({ city: 1, locality: 1, status: 1 });
dairyDriverSchema.index({ location: '2dsphere' });

/**
 * @typedef DairyDriver
 */
const DairyDriver = mongoose.model('DairyDriver', dairyDriverSchema);

module.exports = DairyDriver;