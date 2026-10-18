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
const { toJSON, slugGenerator, paginate } = require('../../../models/plugins');

/**
 * OperationalZone — LocalWala's internal service area.
 *
 * ## What this is NOT
 *
 * This is **not** a customer address component and **not** a delivery area in the
 * courier sense. A customer does not choose a zone, does not see one, and it is never
 * written to `UserAddress`.
 *
 * ## What it is for
 *
 * Four things, and only these four (Real Estate plan BR-19):
 *
 *   1. discovery        — which localities a customer can browse properties in
 *   2. filtering        — "properties in my area"
 *   3. executive assignment — which field executive is nearest to a property
 *   4. operational analytics — leads, visits and commission grouped by service area
 *
 * ## Why it is derived rather than chosen
 *
 * A zone is an *operational* decision made by LocalWala, not a fact about a place. The
 * same locality can be in zone `HYD-CENTRAL` this month and `HYD-EAST` next quarter
 * when the boundary is redrawn. Storing it on the customer address would make a
 * business decision look like a permanent property of the customer's home, and the
 * next boundary change would either be ignored or would silently rewrite customer data.
 *
 * So it is stored on the *executive* and on the *lead*, resolved at the moment of use,
 * and never on the customer.
 *
 * ## Membership is an explicit list, not a computed containment test
 *
 * `localities[]` lists the member localities. That looks redundant against `location`
 * and it is deliberate:
 *
 *   - a computed `$geoWithin` test would move localities between zones silently as
 *     polygons are edited, so a lead's zone would change underneath an open case
 *   - an explicit list makes the assignment auditable: "why was this lead in
 *     HYD-EAST" is answerable by reading the document
 *   - overlapping polygons are then a data error an admin can see, rather than a
 *     silent race between two queries
 *
 * `location` is the zone's own centroid, used for map display and distance ordering —
 * never for "is X in this zone".
 */
const operationalZoneSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    slug: {
      type: String,
      source: 'name',
      unique: true,
    },

    /**
     * Optional grouping, e.g. a city or a region. Lets zones be listed per metro
     * without inferring it from the member localities, which may span a border.
     */
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: false,
    },

    state: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'State',
      required: false,
    },

    /**
     * The localities this zone covers.
     *
     * Explicit membership. See the class doc for why this is not a containment test.
     */
    localities: {
      type: [
        {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'Locality',
        },
      ],
      default: undefined,
    },

    /**
     * Zone centroid for map display and distance ordering only.
     *
     * ## Geometry: no default on the nested `type`
     *
     * `City` (line 37), `Locality` (line 34) and `Restaurant` (line 85) ALL set
     * `default: 'Point'` here. That writes `type: 'Point'` into any document saved
     * without coordinates, producing a Point with an empty array, which the `2dsphere`
     * index then rejects.
     *
     * `State` is the reference implementation. Copy `State.location`, not `Restaurant`.
     */
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function (v) {
            if (!Array.isArray(v) || v.length !== 2) return false;
            const [lng, lat] = v;
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
            if (lng < -180 || lng > 180) return false;
            if (lat < -90 || lat > 90) return false;
            if (lng === 0 && lat === 0) return false;
            return true;
          },
          message:
            'coordinates must be [lng, lat] with lng in [-180,180], lat in [-90,90], and not [0,0]',
        },
      },
    },

    /**
     * Who last changed the boundary, and when.
     *
     * Redrawing a zone reassigns open leads. Without this, "which leads moved and why"
     * is unanswerable.
     */
    boundaryChangedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    boundaryChangedAt: {
      type: Date,
      required: false,
    },
    boundaryChangeReason: {
      type: String,
      required: false,
      trim: true,
    },

    translations: {
      type: Array,
      default: [],
    },

    status: {
      type: Boolean,
      default: true,
    },

    sortOrder: {
      type: Number,
      required: false,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
operationalZoneSchema.plugin(toJSON);
operationalZoneSchema.plugin(paginate);
operationalZoneSchema.plugin(slugGenerator);

operationalZoneSchema.index({ location: '2dsphere' });
operationalZoneSchema.index({ status: 1, sortOrder: 1 });
operationalZoneSchema.index({ localities: 1 });
operationalZoneSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

/**
 * @typedef OperationalZone
 */
const OperationalZone = mongoose.model('OperationalZone', operationalZoneSchema);

module.exports = OperationalZone;
