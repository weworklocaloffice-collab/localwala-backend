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
 * Business — the operating entity of a vertical.
 *
 * Deliberately introduced as a separate collection from `Restaurant` rather than
 * generalising it. Generalising `Restaurant` would touch `orders.service.js`
 * (441 KB) and `restaurant.service.js` (409 KB), neither of which has test
 * coverage.
 *
 * For the dairy vertical this represents a collection centre, a dairy unit, a
 * franchise outlet, or a commission-partner store.
 */
const businessSchema = mongoose.Schema(
  {
    vertical: {
      type: String,
      required: true,
      default: 'dairy', // dairy, food, grocery, ...
    },
    businessModel: {
      type: String,
      required: true,
      default: 'direct', // direct, franchise, commission_partner
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      required: false,
      trim: true,
    },
    logo: {
      type: String,
      required: false,
      trim: true,
    },
    cover: {
      type: String,
      required: false,
      trim: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
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
     * No nested `default: 'Point'` — see the note on `DeliveryStop.location`. A
     * default would create a malformed point for any outlet without GPS and the
     * 2dsphere index would then reject the document.
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
    owner: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    contact: {
      name: {
        type: String,
        required: false,
        trim: true,
      },
      mobile: {
        type: Number,
        required: false,
      },
      countryCode: {
        type: String,
        required: false,
      },
      email: {
        type: String,
        required: false,
        trim: true,
        lowercase: true,
      },
    },
    /**
     * Mirrors `Restaurant.ownDriver` (models/restaurant.model.js:131).
     *
     * When true, delivery runs for this business are assigned from
     * `DairyDriver` documents that carry this business id. When false, runs are
     * assigned from the platform pool (`DairyDriver.business === null`).
     *
     * Shipped from day one even though nothing populates it until the delivery
     * slice — retrofitting it rebuilds the run spine and every downstream
     * consumer inherits the rework.
     */
    ownDeliveryPartner: {
      type: Boolean,
      required: false,
      default: false,
    },
    driverPayoutMode: {
      type: String,
      required: false,
      // Restaurant still has platform-employed riders, so this keeps both values.
      // Dairy has none, so it is always `business_pays` there.
      default: 'platform_pays', // business_pays, platform_pays
    },
    deliveryPartners: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
        required: false,
      },
    ],
    commissionPercentage: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    /**
     * Franchise / partner territory. `localities` is the authoritative scope;
     * `polygon` is optional and only needed when territories must not overlap.
     */
    territory: {
      city: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'City',
        required: false,
      },
      localities: [
        {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'Locality',
          required: false,
        },
      ],
      polygon: {
        type: {
          type: String,
          enum: ['Polygon'],
          default: undefined,
        },
        coordinates: {
          type: [[[Number]]],
          required: false,
        },
      },
    },
    /**
     * Milk acceptance thresholds for the procurement slice.
     *
     * Defaults follow common Indian dairy practice (cow milk SNF ≥ 8.5%,
     * fat ≥ 3.5%) but every outlet sets its own, because buffalo milk is
     * legitimately fatter and a cooperative buying from a mixed herd has
     * different limits from a single-farm unit. Hard-coding these would reject
     * good buffalo milk.
     */
    qualityConfig: {
      minFatPercentage: {
        type: Number,
        required: false,
        default: 3.5,
      },
      minSnfPercentage: {
        type: Number,
        required: false,
        default: 8.5,
      },
      maxFatPercentage: {
        type: Number,
        required: false,
        default: 7,
      },
      maxSnfPercentage: {
        type: Number,
        required: false,
        default: 10,
      },
      /**
       * Rejection thresholds are looser than acceptance. Milk outside these is
       * auto-rejected without an operator deciding, which is the point — the
       * queue should only contain genuinely borderline cases.
       */
      rejectBelowFat: {
        type: Number,
        required: false,
        default: 3,
      },
      rejectBelowSnf: {
        type: Number,
        required: false,
        default: 8,
      },
      /**
       * Raw milk is perishable. Hours from collection to expiry, which drives
       * FEFO allocation.
       */
      shelfLifeHours: {
        type: Number,
        required: false,
        default: 12,
      },
      /**
       * Maximum temperature accepted at intake, in °C. Milk above this has been
       * unrefrigerated too long.
       */
      maxIntakeTemperature: {
        type: Number,
        required: false,
        default: 27,
      },
    },
    verified: {
      type: Boolean,
      required: false,
      default: false,
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
businessSchema.plugin(toJSON);
businessSchema.plugin(paginate);
businessSchema.index({ location: '2dsphere' });
businessSchema.index({ vertical: 1, city: 1, status: 1 });
businessSchema.index({ owner: 1 });
businessSchema.index({ name: 'text', code: 'text' });

/**
 * @typedef Business
 */
const Business = mongoose.model('Business', businessSchema);

module.exports = Business;