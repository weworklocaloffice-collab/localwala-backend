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
 * GeoBoundary — a polygon or multipolygon describing an area.
 *
 * ## Why polygons at all, when zones hold a locality list
 *
 * `OperationalZone.localities` is the authoritative membership (§ see
 * operational.zone.model.js). `GeoBoundary` exists for the two cases a point-in-polygon
 * test answers and a list does not:
 *
 *   1. **Coverage questions.** "Which zones does this pin fall in?" — needed to warn
 *      an admin that a new property sits outside every active zone, which is the
 *      single most common cause of a lead that nobody is ever assigned.
 *   2. **Draw-a-zone UI.** An admin draws an area; the service resolves which existing
 *      localities fall inside and proposes them as members. The admin still confirms.
 *
 * It is never authoritative for membership. A pin can be inside a polygon whose zone
 * does not list its locality — the polygon is a hint, the list is the truth.
 *
 * ## Polygon, not the deprecated `type` field
 *
 * Mongoose's default GeoJSON subdocument uses `{ type: <string>, coordinates: <array> }`,
 * which needs `coordinates` to be deeply mixed and loses the object schema. It also
 * cannot express validation per vertex. The `coordinates` field here is a plain
 * `[Number]` pair and the shape is carried by `geometryType` plus the extra fields.
 *
 * A true GeoJSON `Polygon` (with a closing ring) can be stored by enabling
 * `mongoose.Schema.Types.GeoJSON` — see `geoJsonEnabled` below. Until that is switched
 * on, `rings[]` holds one array per ring and the service reads them. This is deliberate:
 * `mongoose.Schema.Types.GeoJSON` has no `required` semantics and no per-vertex
 * validation, and a boundary with an invalid vertex is worse than one without an index.
 *
 * ## Geometry: no default on the nested `type`
 *
 * `City` (line 37), `Locality` (line 34) and `Restaurant` (line 85) ALL set
 * `default: 'Point'` on a nested GeoJSON `type`. That writes `type: 'Point'` into any
 * document saved without coordinates, producing an empty array that the `2dsphere`
 * index rejects. `State.location` is the reference implementation — copy that.
 */
const geoBoundarySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * What this boundary describes. Deliberately loose — a future vertical may add a
     * kind this plan has not thought of, and a closed enum here would block it.
     */
    kind: {
      type: String,
      required: false,
      trim: true,
      // city_limit, service_area, catchment, ward, pincode_cluster, custom
    },

    /**
     * GeoJSON geometry type. `Polygon` and `MultiPolygon` only — a `Point` boundary is
     * a zone centroid and belongs on `OperationalZone.location`.
     */
    geometryType: {
      type: String,
      required: true,
      enum: ['Polygon', 'MultiPolygon'],
    },

    /**
     * One array of `[lng, lat]` pairs per ring.
     *
     * For `Polygon`: ring 0 is the outer boundary, the rest are holes.
     * For `MultiPolygon`: each entry is itself an array of rings.
     *
     * Not validated as a closed ring here; `geographic.service.js` validates on write
     * and rejects an unclosed ring, because a silently open ring produces a coverage
     * answer that is wrong in a way nobody notices.
     */
    rings: {
      type: [[Number]],
      required: false,
      default: undefined,
      validate: {
        validator: function (v) {
          if (!Array.isArray(v) || v.length === 0) return true; // absent is allowed
          // Every vertex must be a finite [lng, lat] pair in range.
          const walk = (pairs) => {
            for (const p of pairs) {
              if (!Array.isArray(p) || p.length < 2) return false;
              const [lng, lat] = p;
              if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
              if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
              if (lng === 0 && lat === 0) return false;
            }
            return true;
          };
          if (this.geometryType === 'MultiPolygon') {
            return v.every((polygon) => Array.isArray(polygon) && walk(polygon[0] || []));
          }
          return walk(v);
        },
        message:
          'rings must contain finite [lng, lat] pairs with lng in [-180,180], lat in [-90,90], and no [0,0] vertex',
      },
    },

    /**
     * Rough centre, kept in sync by `geographic.service.js` on write. Used for map
     * display and distance ordering only — never for a membership decision.
     */
    centroid: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        required: false,
      },
    },

    /**
     * Optional scoping. A boundary with no city is a country- or region-wide shape.
     */
    country: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Country',
      required: false,
    },
    state: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'State',
      required: false,
    },
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: false,
    },

    /**
     * The zone this boundary supports, when there is one.
     *
     * Optional: a catchment or ward boundary may exist before any zone claims it.
     */
    operationalZone: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'OperationalZone',
      required: false,
    },

    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
geoBoundarySchema.plugin(toJSON);
geoBoundarySchema.plugin(paginate);

/**
 * Not `unique: true` on `name` on purpose.
 *
 * A boundary is a shape with a version history. Two boundaries called "Hyderabad
 * service area" is the normal state while one is being redrawn — that is what
 * `supersededBy` records. Unique-by-name would forbid the correction it exists for.
 * Uniqueness that IS required is "one ACTIVE boundary per zone", which is a partial
 * index below rather than a field constraint.
 */
geoBoundarySchema.index({ centroid: '2dsphere' });
geoBoundarySchema.index({ operationalZone: 1, status: 1 });
geoBoundarySchema.index({ city: 1, kind: 1, status: 1 });
geoBoundarySchema.index({ kind: 1, status: 1 });
// One live boundary per zone. sparse so a boundary with no zone (a ward, a catchment
// nobody has adopted) is not blocked by the unique constraint.
geoBoundarySchema.index(
  { operationalZone: 1 },
  { unique: true, partialFilterExpression: { status: true } }
);

/**
 * @typedef GeoBoundary
 */
const GeoBoundary = mongoose.model('GeoBoundary', geoBoundarySchema);

module.exports = GeoBoundary;
