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
const { toJSON, slugGenerator, paginate } = require('./plugins');

const restaurantSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    address: {
      type: String,
      required: true,
    },
    shortDescription: {
      type: String,
      required: true,
    },
    cuisine: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Cuisine',
        required: true,
      },
    ],
    category: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Category',
        required: false,
      },
    ],
    diningCategory: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'DiningCategory',
        required: false,
      },
    ],
    logo: {
      type: String,
      required: true,
    },
    cover: {
      type: String,
      required: true,
    },
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: true,
    },
    locality: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Locality',
      required: false,
    },
    location: {
      type: {
        type: String, // Don't do `{ location: { type: String } }`
        enum: ['Point'], // 'location.type' must be 'Point'
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    type: {
      type: String,
      required: true,
      default: 'commission', // commission or subscription or derived
    },
    commission: {
      type: Number,
      required: false,
      default: 0,
    },
    posOrderCommission: {
      type: Number,
      required: false,
      default: 0,
    },
    tableOrderCommission: {
      type: Number,
      required: false,
      default: 0,
    },
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Subscriptions',
      required: false,
    },
    approxDeliveryTime: {
      type: String,
      required: true,
    },
    dishPriceForTwo: {
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      required: true,
    },
    pos: {
      type: Boolean,
      default: false,
    },
    ownDriver: {
      type: Boolean,
      default: false,
    },
    promote: {
      type: Boolean,
      default: false,
    },
    customCategory: {
      type: Boolean,
      default: false,
    },
    multiOutlet: {
      type: Boolean,
      default: false,
    },
    preBooking: {
      type: Boolean,
      default: false,
    },
    tableOrder: {
      type: Boolean,
      default: false,
    },
    tiffinSubscription: {
      type: Boolean,
      default: false,
    },
    ownWaiter: {
      type: Boolean,
      default: false,
    },
    ownKitchen: {
      type: Boolean,
      default: false,
    },
    takeAway: {
      type: Boolean,
      default: true,
    },
    slug: {
      type: 'String',
      source: 'name',
      unique: true,
    },
    translations: {
      type: Array,
      default: [],
    },
    slots: {
      type: Array,
      default: [],
    },
    isOutlet: {
      type: Boolean,
      default: false,
    },
    outletManagerId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: false,
    },
    orderLimit: {
      type: Number,
      default: -1, // -1 means unlimited
    },
    productLimit: {
      type: Number,
      default: -1, // -1 means unlimited
    },
    rating: {
      type: Number,
      default: 0,
    },
    restaurantType: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'RestaurantType',
        required: true,
      },
    ],
    restaurantFacility: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'RestaurantFacility',
        required: true,
      },
    ],
    temporaryClosed: {
      type: Boolean,
      default: false,
    },
    acceptScheduleDelivery: {
      type: Boolean,
      default: true,
    },
    acceptHomeDelivery: {
      type: Boolean,
      default: true,
    },
    minOrderAmount: {
      type: Number,
      default: 1000,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      required: true,
    },
    license: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RestaurantFoodLicense',
      required: false,
    },
    licenseId: {
      type: String,
      default: '',
      required: false,
    },
    socialFacebook: {
      type: String,
      default: '',
      required: false,
    },
    socialInstagram: {
      type: String,
      default: '',
      required: false,
    },
    socialX: {
      type: String,
      default: '',
      required: false,
    },
    socialYoutube: {
      type: String,
      default: '',
      required: false,
    },
    socialLinkedIn: {
      type: String,
      default: '',
      required: false,
    },
    socialPinterest: {
      type: String,
      default: '',
      required: false,
    },
    status: {
      type: Boolean,
      default: true,
    },
    // Per-restaurant dispatch policy (Phase 3). Purely additive and entirely
    // optional: when absent, every reader falls back to the platform-wide
    // `BusinessSettings.deliveryArea` / `findMode` and the default cascade
    // ladder, so behaviour is identical. Never repurpose or remove
    // `BusinessSettings.deliveryArea` — ~20 readers across 15+ food services
    // depend on it (plan §5.1 C-2).
    deliveryConfig: {
      // Override for `BusinessSettings.deliveryArea`, in metres. Null/absent
      // means "use the platform value".
      deliveryRadiusMeters: {
        type: Number,
        required: false,
        default: null,
      },
      // When true the engine offers own-fleet riders before the platform pool.
      fleetFirst: {
        type: Boolean,
        required: false,
        default: null,
      },
      // Parallel arrays that compose an escalation ladder when
      // `escalationLadder` is not given explicitly. Absent means default ladder.
      batchSizes: {
        type: [Number],
        required: false,
        default: undefined,
      },
      offerTtlSeconds: {
        type: [Number],
        required: false,
        default: undefined,
      },
      // Explicit per-rung ladder. Each rung: { radiusMeters, batchSize,
      // ttlSeconds }. Absent/empty means "derive from batchSizes /
      // offerTtlSeconds, else the platform default ladder".
      escalationLadder: {
        type: [
          {
            radiusMeters: { type: Number, required: false },
            batchSize: { type: Number, required: false },
            ttlSeconds: { type: Number, required: false },
            _id: false,
          },
        ],
        required: false,
        default: undefined,
      },
      maxDispatchAttempts: {
        type: Number,
        required: false,
        default: null,
      },
      // Polygon delivery zones. Each zone carries a geometry in one of the
      // three shapes `kernel/geographic` understands (bare RING, POLYGON,
      // MULTIPOLYGON — see `classifyGeometry`). Absent/empty means "radius
      // check", so existing restaurants are unaffected.
      zones: {
        type: [
          {
            name: { type: String, required: false, default: '' },
            geometry: { type: mongoose.SchemaTypes.Mixed, required: false, default: null },
            enabled: { type: Boolean, required: false, default: true },
            _id: false,
          },
        ],
        required: false,
        default: undefined,
      },
      // Served localities (Batch A-3). A tick-list of `Locality` ids this
      // kitchen delivers to — the practical middle level between a radius
      // (too blunt) and polygons (too costly). Absent/empty means "not
      // configured": coverage falls through to the radius check. City
      // membership is enforced at write time (`updateDeliveryConfig`), so a
      // locality from another city can never land here.
      localities: {
        type: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'Locality' }],
        required: false,
        default: undefined,
      },
      // Surge pricing policy. The engine only *quotes*; checkout adoption is a
      // separate step, so setting this never changes a charged total by itself.
      surge: {
        enabled: { type: Boolean, required: false, default: false },
        demandThreshold: { type: Number, required: false, default: null },
        multiplierCap: { type: Number, required: false, default: null },
        peakHours: {
          type: [
            {
              startHour: { type: Number, required: false },
              endHour: { type: Number, required: false },
              multiplier: { type: Number, required: false },
              _id: false,
            },
          ],
          required: false,
          default: undefined,
        },
        _id: false,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
restaurantSchema.plugin(toJSON);
restaurantSchema.plugin(slugGenerator);
restaurantSchema.plugin(paginate);
restaurantSchema.index({ location: '2dsphere' });

/**
 * @typedef Restaurant
 */
const Restaurant = mongoose.model('Restaurant', restaurantSchema);

module.exports = Restaurant;

