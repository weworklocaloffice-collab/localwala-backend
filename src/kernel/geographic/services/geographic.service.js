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

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const State = require('../models/state.model');
const OperationalZone = require('../models/operational.zone.model');
const GeoBoundary = require('../models/geo.boundary.model');

/**
 * Geographic kernel service.
 *
 * ## Scope
 *
 * Shared, vertical-agnostic geography. It knows about states, operational zones and
 * boundaries. It does **not** know about properties, executives or leads — those hold
 * a `zone` ref and resolve it through here when they need to.
 *
 * ## The one rule this service exists to enforce
 *
 * A zone is derived, never chosen. Nothing in here writes a zone onto a customer
 * address, because a zone is an operational decision that changes and a customer's
 * address is not (Real Estate plan BR-19).
 *
 * ## Deliberately absent
 *
 * - No `Country` or `City` write methods. Those models are food-path; adding a
 *   `state` ref to `City` is a platform change (21 models reference it), not kernel
 *   groundwork. See plan §4.2.2.
 * - No geometry maths beyond what the callers need. `haversineMeters` and
 *   `pointInRings` are here because both the assignment engine and the radius search
 *   need them, and two copies of a distance formula is how two features start
 *   disagreeing about whether a customer is within range.
 */

const EARTH_RADIUS_METERS = 6378137;

/**
 * Great-circle distance in metres.
 *
 * Used for executive assignment (BR-08 geofence) and for ordering candidates by
 * distance. Not used for customer-initiated radius search — that uses
 * `$centerSphere` on a `2dsphere` index so Mongo does the work, not the application
 * loop.
 *
 * @param {number} lng1
 * @param {number} lat1
 * @param {number} lng2
 * @param {number} lat2
 * @returns {number} metres
 */
const haversineMeters = (lng1, lat1, lng2, lat2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
};

/**
 * Classify a geometry argument into polygons-of-rings-of-vertices.
 *
 * The difficulty is that four shapes are all plausible at a call site and three of
 * them differ only by one level of nesting. Guessing wrong is the bug this exists to
 * remove: a `pointInRings` that silently treats a vertex pair as a vertex pair's
 * parent returns `false` for every point, which reads as "this address is outside our
 * coverage" rather than as a mistake.
 *
 * The three shapes, told apart by inspecting `geometry[0][0]`:
 *
 *   RING          [[78,17], [79,17], [79,18], [78,17]]           a bare ring
 *   POLYGON       [[[78,17],[79,17],…]]                            one polygon, ring 0
 *   MULTIPOLYGON  [[[[78,17],…], …], [[[80,17],…], …]]             several polygons
 *
 * @param {Array} geometry
 * @returns {{shape: string, polygons: Array<Array<Array<number>>>>}}
 * @throws {ApiError} when the shape is not recognised
 */
const classifyGeometry = (geometry) => {
  if (!Array.isArray(geometry) || geometry.length === 0) {
    return { shape: 'EMPTY', polygons: [] };
  }

  const first = geometry[0];
  if (!Array.isArray(first)) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'Unrecognised geometry shape: expected an array of coordinates, received ' + typeof first
    );
  }

  // A well-formed vertex is [number, number]. Check the element type rather than
  // calling isFinite on it: isFinite([78,17]) is false, which reads as "malformed"
  // and silently returns EMPTY for perfectly good geometry.
  const isVertex = (v) => Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]);

  if (isVertex(first)) {
    // geometry[0] is a vertex  ->  geometry is a bare RING of vertices.
    return { shape: 'RING', polygons: [[geometry]] };
  }

  if (isVertex(first[0])) {
    // geometry[0] is a ring of vertices  ->  geometry is one POLYGON.
    return { shape: 'POLYGON', polygons: [geometry] };
  }

  if (Array.isArray(first[0])) {
    // geometry[0] is a list of rings  ->  geometry is a MULTIPOLYGON.
    return { shape: 'MULTIPOLYGON', polygons: geometry };
  }

  return { shape: 'EMPTY', polygons: [] };
};

/**
 * Ray-casting test for one point against one polygon.
 *
 * @param {Array<Array<number>>} rings ring 0 is the outer boundary, the rest are holes
 * @param {number} lng
 * @param {number} lat
 * @returns {boolean}
 */
const pointInOnePolygon = (rings, lng, lat) => {
  if (!Array.isArray(rings) || rings.length === 0) return false;

  const inRing = (ring) => {
    // Malformed stored geometry is a data problem, not a caller problem — return
    // "outside" rather than throwing, so one bad row cannot fail a coverage query.
    if (!Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      const xi = a[0];
      const yi = a[1];
      const xj = b[0];
      const yj = b[1];
      if (![xi, yi, xj, yj].every((n) => Number.isFinite(n))) return false;
      const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  };

  if (!inRing(rings[0])) return false;
  // Any hole containing the point means it is outside this polygon.
  for (let h = 1; h < rings.length; h++) {
    if (inRing(rings[h])) return false;
  }
  return true;
};

/**
 * Is this point inside the geometry?
 *
 * Accepts a bare ring, one polygon of rings, or a MultiPolygon — see
 * {@link classifyGeometry}. Inside **any** polygon counts as inside.
 *
 * ## Edge behaviour is undefined
 *
 * A point exactly on a boundary vertex or edge may return either value. That is
 * inherent to ray casting, not an oversight. Callers must not depend on it: for the
 * check-in geofence (BR-08) the radius is 200 m and a property pin will never sit on
 * the 1-pixel edge of a coverage polygon.
 *
 * @param {Array} geometry
 * @param {number} lng
 * @param {number} lat
 * @returns {boolean}
 */
const pointInRings = (geometry, lng, lat) => {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  const { polygons } = classifyGeometry(geometry);
  return polygons.some((polygon) => pointInOnePolygon(polygon, lng, lat));
};

/**
 * Rejects an unclosed ring.
 *
 * A silently open ring produces a coverage answer that is wrong in a way nobody
 * notices — the boundary just appears to cover slightly more or less than intended,
 * and the symptom shows up as a property nobody can assign. Closing is enforced here
 * rather than trusted from the client.
 *
 * @param {Array<Array<number>>} rings
 * @throws {ApiError} 422
 */
const assertClosedRings = (rings) => {
  if (!Array.isArray(rings) || rings.length === 0) return;
  rings.forEach((ring, i) => {
    if (!Array.isArray(ring) || ring.length < 4) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Ring ${i} needs at least 4 vertices (3 plus the closing vertex)`
      );
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Ring ${i} is not closed — the last vertex must repeat the first`
      );
    }
  });
};

/**
 * Arithmetic mean of the vertices. Crude, and labelled as such.
 *
 * A true centroid needs polygon area maths, and a mean is wrong for a concave shape —
 * it can land outside the polygon. That is acceptable **because this value is only
 * ever used for map display and distance ordering**, both of which tolerate being
 * slightly off. It must never gate a membership decision; that is
 * `OperationalZone.localities`.
 *
 * ## The closing vertex is excluded
 *
 * GeoJSON rings repeat their first vertex to close the loop. Averaging it in weights
 * that corner twice, so a unit square centred on 78.5 would come out at 78.4 — a
 * 0.1° bias, which is roughly 10 km. Harmless for a map pin, but it is a wrong answer
 * and it is free to fix.
 *
 * For a `MultiPolygon` only the **first** polygon is averaged. Averaging across parts
 * of a disjoint shape produces a point in the gap between them, which is worse than
 * picking one part.
 *
 * @param {Array} geometry bare ring, one polygon, or MultiPolygon
 * @returns {[number, number] | null} `[lng, lat]`
 */
const approximateCentroid = (geometry) => {
  const { polygons } = classifyGeometry(geometry);
  if (!polygons.length) return null;

  const outerRing = polygons[0][0];
  if (!Array.isArray(outerRing) || !outerRing.length) return null;

  // Drop the closing duplicate if present.
  let vertices = outerRing;
  if (vertices.length > 1) {
    const first = vertices[0];
    const last = vertices[vertices.length - 1];
    if (
      Array.isArray(first) &&
      Array.isArray(last) &&
      first[0] === last[0] &&
      first[1] === last[1]
    ) {
      vertices = vertices.slice(0, -1);
    }
  }

  let lng = 0;
  let lat = 0;
  let counted = 0;
  for (const vertex of vertices) {
    if (!Array.isArray(vertex)) continue;
    const [x, y] = vertex;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    lng += x;
    lat += y;
    counted++;
  }
  if (!counted) return null;
  return [lng / counted, lat / counted];
};

const geographicService = {
  EARTH_RADIUS_METERS,
  haversineMeters,
  classifyGeometry,
  pointInOnePolygon,
  pointInRings,
  approximateCentroid,
  assertClosedRings,

  // ---------------------------------------------------------------- states

  /**
   * Resolve a typed state name or alias to a canonical `State`.
   *
   * An exact `name` match wins over an alias, mirroring `Locality.resolveByNameOrAlias`
   * so both behave the same way for a caller typing "Telangana" vs "tg".
   *
   * @param {string} typedName
   * @returns {Promise<object|null>}
   */
  async resolveStateByNameOrAlias(typedName) {
    const name = String(typedName || '').trim();
    if (!name) return null;

    const byName = await State.findOne({ name }).lean();
    if (byName) return byName;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`^${escaped}$`, 'i');

    return State.findOne({ aliases: rx, status: true }).lean();
  },

  /**
   * @returns {Promise<object|null>}
   */
  async findStateById(id) {
    if (!id) return null;
    return State.findById(id).lean();
  },

  // ------------------------------------------------------- operational zones

  /**
   * The zone a locality belongs to.
   *
   * Resolution is the explicit `localities` list, never a `$geoWithin` test against
   * `OperationalZone.location`. See operational.zone.model.js for why.
   *
   * @param {string|ObjectId} localityId
   * @returns {Promise<object|null>} the zone, or null if the locality is uncovered
   */
  async findZoneByLocality(localityId) {
    if (!localityId) return null;
    return OperationalZone.findOne({ localities: localityId, status: true }).lean();
  },

  /**
   * Every active zone covering any of these localities.
   *
   * Bulk form of {@link findZoneByLocality}. A locality can legitimately be in more
   * than one zone during a boundary redraw, so this returns a list.
   *
   * @param {Array<string|ObjectId>} localityIds
   * @returns {Promise<Array<object>>}
   */
  async findZonesByLocalities(localityIds) {
    const ids = (localityIds || []).filter(Boolean);
    if (!ids.length) return [];
    return OperationalZone.find({ localities: { $in: ids }, status: true }).lean();
  },

  /**
   * Active zones in a city, in display order.
   *
   * @param {string|ObjectId} cityId
   * @returns {Promise<Array<object>>}
   */
  async listZonesByCity(cityId) {
    if (!cityId) return [];
    return OperationalZone.find({ city: cityId, status: true })
      .sort({ sortOrder: 1, name: 1 })
      .lean();
  },

  // -------------------------------------------------------------- boundaries

  /**
   * Which active boundaries contain this pin.
   *
   * The coverage check. Its main caller is the property-save path, which warns when a
   * property sits outside every active zone — the most common cause of a lead that
   * is never assigned to anyone.
   *
   * Boundaries are fetched and tested in the application rather than via
   * `$geoIntersects`, because `rings` is not a native GeoJSON geometry (see
   * geo.boundary.model.js). The candidate set is narrowed by city/state first so this
   * is a small scan; if boundary count grows past a few hundred per city, revisit with
   * `mongoose.Schema.Types.GeoJSON`.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {{city?: string, state?: string, kind?: string}} [scope]
   * @returns {Promise<Array<object>>}
   */
  async findBoundariesContaining(lng, lat, scope = {}) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];

    const query = { status: true };
    if (scope.city) query.city = scope.city;
    if (scope.state) query.state = scope.state;
    if (scope.kind) query.kind = scope.kind;

    const candidates = await GeoBoundary.find(query).lean();

    // `pointInRings` handles RING, POLYGON and MULTIPOLYGON shapes, so a stored
    // `rings` array needs no branching here.
    return candidates.filter((b) => {
      if (!b.rings) return false;
      return pointInRings(b.rings, lng, lat);
    });
  },

  /**
   * Persist a boundary, filling in the centroid and enforcing ring closure.
   *
   * @param {object} payload
   * @returns {Promise<object>}
   * @throws {ApiError} 422 on an unclosed ring
   */
  async saveBoundary(payload = {}) {
    const rings = payload.rings;
    if (Array.isArray(rings) && rings.length) {
      if (payload.geometryType === 'MultiPolygon') {
        rings.forEach((polygon) => geographicService.assertClosedRings(polygon));
      } else {
        geographicService.assertClosedRings(rings);
      }

      // `normaliseRings` handles the MultiPolygon shape, so no branching here.
      const centroid = approximateCentroid(rings);
      if (centroid) payload.centroid = { type: 'Point', coordinates: centroid };
    }
    return GeoBoundary.create(payload);
  },

  /**
   * Distance from an executive to a property, in metres.
   *
   * The BR-08 check-in geofence calls this. It is exported rather than reached
   * through a boundary lookup because the property already carries its own
   * `location.coordinates` and fetching a boundary to compare two points would be a
   * pointless query.
   *
   * @param {Array<number>} from `[lng, lat]`
   * @param {Array<number>} to `[lng, lat]`
   * @returns {number|null} metres, or null if either point is unusable
   */
  distanceBetween(from, to) {
    if (!Array.isArray(from) || !Array.isArray(to)) return null;
    if (from.length < 2 || to.length < 2) return null;
    const [lng1, lat1] = from;
    const [lng2, lat2] = to;
    if (![lng1, lat1, lng2, lat2].every((n) => Number.isFinite(n))) return null;
    return haversineMeters(lng1, lat1, lng2, lat2);
  },
};

module.exports = geographicService;
