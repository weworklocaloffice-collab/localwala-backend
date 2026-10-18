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
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const RealEstateProperty = require('../models/realestate.property.model');
const categoryService = require('./realestate.category.service');

/**
 * Public property search.
 *
 * ## The one rule this file exists to enforce
 *
 * Every query built here carries `status: 'PUBLISHED'`. It is not a caller option and
 * there is no way to omit it. Blueprint §8 and BR-03 say only `PUBLISHED` is
 * customer-visible; a search service where a caller can pass a status is a search
 * service that will one day return a vendor's unverified draft.
 *
 * `source` is NOT filtered. A LocalWala Direct listing and a vendor listing are both
 * customer-visible once published — `source` is an internal fact (BR-01).
 *
 * ## `ON_HOLD` is visible, `SOLD`/`RENTED`/`SUSPENDED` are not
 *
 * A held property is one somebody else is negotiating for. Hiding it means a customer
 * who saw it yesterday cannot find it today and telephones support. Blueprint §49
 * expects the app to show a held unit as "On hold" and offer a waitlist, which
 * requires it to be returned.
 *
 * ## Filtering on `specs` is gated by the category
 *
 * BHK, area, bathrooms and the rest live in `specs`, which Mongo cannot index. Two
 * consequences, both handled here:
 *
 *   1. Only keys in some active category's `filterableKeys` are accepted. Without that
 *      gate, `?specs[$gt]=` reaches straight into the query object.
 *   2. Filtering on `specs` is slower than filtering on a first-class field, because it
 *      cannot use the compound index. It is supported because the blueprint requires
 *      it, and the hot filters (city, locality, category, transactionType, price) are
 *      all indexed.
 */

/** BR-03. Non-negotiable. */
const PUBLIC_STATUS = 'PUBLISHED';

/** Blueprint §49. Held is visible; these are not. */
const HIDDEN_AVAILABILITY = ['SOLD', 'RENTED', 'SUSPENDED'];

/**
 * A spec key that must never reach the query.
 *
 * `$` is a Mongo operator and `.` is a path traversal. Neither can be a real category
 * field: `specSchema` keys are validated to `^[a-zA-Z][a-zA-Z0-9_]*$` at category-save
 * time, so an underscore IS legal and must not be forbidden here.
 */
const FORBIDDEN_SPEC_KEY = /[$.]|^(__proto__|constructor|prototype)$/;

/**
 * Fields a search result needs. Excludes `specs` detail and the full media array —
 * `$slice` keeps the card cheap while still giving it a cover image.
 */
const CARD_PROJECTION = {
  propertyCode: 1,
  source: 1,
  title: 1,
  price: 1,
  priceOnRequest: 1,
  pricePeriod: 1,
  transactionType: 1,
  category: 1,
  categorySnapshot: 1,
  locality: 1,
  city: 1,
  state: 1,
  pincode: 1,
  location: 1,
  mapAddress: 1,
  specs: 1,
  amenities: 1,
  media: { $slice: 1 },
  status: 1,
  availability: 1,
  verifiedAt: 1,
  publishedAt: 1,
  views: 1,
};

const realEstateSearchService = {
  PUBLIC_STATUS,
  HIDDEN_AVAILABILITY,
  CARD_PROJECTION,

  // ------------------------------------------------------------- validation

  /**
   * The union of every active category's filterable spec keys.
   *
   * Computed only when a `specs.*` filter is actually present, so the common search
   * costs no extra query. If spec filtering ever becomes hot, this is the thing to
   * cache — not the search results themselves.
   *
   * @returns {Promise<Set<string>>}
   */
  async _filterableSpecKeys() {
    const cats = await categoryService.listActive();
    const keys = new Set();
    cats.forEach((c) => (c.filterableKeys || []).forEach((k) => keys.add(k)));
    return keys;
  },

  /**
   * Turn a validated query object into a Mongo filter.
   *
   * @param {object} query
   * @returns {Promise<object>} a Mongo filter, always including `status: PUBLISHED`
   * @throws {ApiError} 422 on an unusable filter
   */
  async buildPublicFilter(query = {}) {
    const filter = {
      // Hardcoded, not `query.status`. See the class doc.
      status: PUBLIC_STATUS,
      availability: { $nin: HIDDEN_AVAILABILITY },
    };

    if (query.category) filter.category = query.category;
    if (query.categoryKey) {
      const cat = await categoryService.findByKey(query.categoryKey);
      if (!cat)
        throw new ApiError(
          httpStatus.UNPROCESSABLE_ENTITY,
          `Unknown category "${query.categoryKey}"`
        );
      filter.category = cat._id;
    }
    if (query.transactionType) filter.transactionType = query.transactionType;
    if (query.locality) filter.locality = query.locality;
    if (query.city) filter.city = query.city;
    if (query.state) filter.state = query.state;
    if (query.operationalZone) filter.operationalZone = query.operationalZone;

    // ---------------------------------------------------------------- price
    const hasMin = Number.isFinite(query.priceMin);
    const hasMax = Number.isFinite(query.priceMax);
    if (hasMin && hasMax && query.priceMin > query.priceMax) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `priceMin (${query.priceMin}) is greater than priceMax (${query.priceMax})`
      );
    }
    if (hasMin || hasMax) {
      // A customer who narrows by price does not want "price on request" in the
      // results — and a "price on request" listing has no comparable price, so
      // including it would be answering a different question.
      filter.priceOnRequest = { $ne: true };
      filter.price = {};
      // `priceMin` / `priceMax` arrive in RUPEES (validated query); the `price`
      // column stores paise. Compare in paise — comparing rupees against the
      // paise column narrows every range 100x (money-edges gate [10e]).
      if (hasMin) filter.price.$gte = Math.round(query.priceMin * 100);
      if (hasMax) filter.price.$lte = Math.round(query.priceMax * 100);
    }

    // ------------------------------------------------------- amenities
    if (Array.isArray(query.amenities) && query.amenities.length) {
      // `$all` — a customer ticking "Lift" and "Gym" wants both, not either.
      filter.amenities = { $all: query.amenities };
    }

    // --------------------------------------------------------- verified
    if (query.verified === true) {
      filter.verifiedAt = { $ne: null };
    }

    // ------------------------------------------------------ readiness
    // Blueprint §12 groups Ready-to-move / Under-construction / New / Resale. All four
    // live in `specs`, so they are handled by the spec filter below — but they are
    // common enough to name explicitly.
    if (query.readiness) {
      const map = {
        READY_TO_MOVE: { 'specs.possessionStatus': 'READY_TO_MOVE' },
        UNDER_CONSTRUCTION: { 'specs.possessionStatus': 'UNDER_CONSTRUCTION' },
        NEW: { 'specs.configurationType': 'NEW' },
        RESALE: { 'specs.configurationType': 'RESALE' },
      };
      Object.assign(filter, map[query.readiness] || {});
    }

    // ------------------------------------------------------ radius (map)
    // `$geoWithin`, not `$near`: `$geoWithin` composes with every other filter and
    // with pagination, whereas `$near` must be the whole geo clause and forces a
    // distance sort. `nearby()` below uses `$near` because it wants that sort.
    if (Number.isFinite(query.lng) && Number.isFinite(query.lat)) {
      const radiusMeters = Math.min(
        Number.isFinite(query.radiusMeters) ? query.radiusMeters : 5000,
        realEstateSearchService.maxRadiusMeters()
      );
      filter['location.coordinates'] = {
        $geoWithin: {
          $centerSphere: [[query.lng, query.lat], radiusMeters / 6378137],
        },
      };
    }

    // --------------------------------------------------------- specs.*
    if (query.specs && typeof query.specs === 'object' && Object.keys(query.specs).length) {
      const allowed = await realEstateSearchService._filterableSpecKeys();
      Object.entries(query.specs).forEach(([key, value]) => {
        // Belt and braces. The validation layer already refuses a leading underscore
        // and the key must be in some category's filterableKeys, but a Mongo operator
        // or a dotted path reaching the query object is the one mistake in this file
        // whose consequence is data disclosure rather than a wrong result. So it is
        // refused here too, by shape, regardless of the allowlist.
        if (FORBIDDEN_SPEC_KEY.test(key)) {
          throw new ApiError(
            httpStatus.UNPROCESSABLE_ENTITY,
            `"${key}" is not a valid spec filter key`
          );
        }
        if (!allowed.has(key)) {
          throw new ApiError(
            httpStatus.UNPROCESSABLE_ENTITY,
            `"${key}" is not a filterable field for any active category. ` +
              `Allowed: ${[...allowed].sort().join(', ') || '(none)'}`
          );
        }
        // A range object for numeric specs, a plain equality otherwise.
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const range = {};
          if (Number.isFinite(value.min)) range.$gte = value.min;
          if (Number.isFinite(value.max)) range.$lte = value.max;
          if (Object.keys(range).length) filter[`specs.${key}`] = range;
        } else {
          filter[`specs.${key}`] = value;
        }
      });
    }

    // --------------------------------------------------------- text
    if (query.search) {
      filter.$text = { $search: String(query.search) };
    }

    return filter;
  },

  /**
   * Search radius ceiling. Blueprint §12 allows a map/radius search; an uncapped
   * radius is an unauthenticated way to ask for every property in the country.
   *
   * @returns {number} metres
   */
  maxRadiusMeters() {
    const km = Number(process.env.REALESTATE_SEARCH_MAX_RADIUS_KM) || 50;
    return km * 1000;
  },

  // ----------------------------------------------------------------- search

  /**
   * Paginated public search.
   *
   * ## Why this does not call `RealEstateProperty.paginate()`
   *
   * The shared paginate plugin (`models/plugins/paginate.plugin.js`) supports
   * `sortBy`, `populate`, `limit` and `page` — but **not `projection`**. A search
   * result needs `CARD_PROJECTION`: twenty image URLs and every spec on every row of a
   * paginated list is mostly bytes the client will not render.
   *
   * The two ways to fix that are to extend the shared plugin or to paginate here. This
   * paginates here. The plugin is used by every list endpoint on the platform — dairy,
   * stores, orders, everything — and an optional-key change to it is a change whose
   * blast radius is the whole API, for a benefit this one screen needs. Fifteen lines
   * in the module is the cheaper trade.
   *
   * @param {object} query validated query
   * @returns {Promise<{results, page, limit, totalPages, totalResults}>}
   */
  async search(query = {}) {
    const filter = await realEstateSearchService.buildPublicFilter(query);

    const limit = query.limit && parseInt(query.limit, 10) > 0 ? parseInt(query.limit, 10) : 20;
    const page = query.page && parseInt(query.page, 10) > 0 ? parseInt(query.page, 10) : 1;
    const skip = (page - 1) * limit;

    // `$text` sorts by relevance by default; an explicit `sortBy` from the client wins,
    // but a relevance search sorted by `createdAt` silently discards the ranking, so
    // the default is `score` whenever the query has a `$text` clause.
    let sort = { createdAt: -1 };
    if (query.sortBy) {
      sort = {};
      query.sortBy.split(',').forEach((part) => {
        const [key, order] = part.split(':');
        sort[key] = order === 'desc' ? -1 : 1;
      });
    } else if (filter.$text) {
      sort = { score: { $meta: 'textScore' } };
    }

    const projection = { ...CARD_PROJECTION };
    if (filter.$text) projection.score = { $meta: 'textScore' };

    // `allowDiskUse` because a `$text` search combined with a sort can exceed the
    // in-memory limit on a large collection. Search is read-only, so the trade is safe.
    const [totalResults, docs] = await Promise.all([
      RealEstateProperty.countDocuments(filter),
      RealEstateProperty.find(filter)
        .select(projection)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .allowDiskUse(true),
    ]);

    // Hydrated, not `.lean()` — `price` is a moneyField and a lean read
    // ships paise (the money-edges gate guards this).
    const results = docs.map((d) => d.toObject({ getters: true }));
    return {
      results,
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit),
      totalResults,
    };
  },

  /**
   * Nearby listings, ordered by distance.
   *
   * Uses `$near`, which is the only way to get a distance sort from Mongo. That means
   * `$text` cannot be combined with it — Mongo rejects a query that mixes `$near` with
   * `$text`. The two are therefore separate endpoints rather than one clever one.
   *
   * @param {number} lng
   * @param {number} lat
   * @param {object} query
   * @returns {Promise<Array>} listings, nearest first
   */
  async nearby(lng, lat, query = {}) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'lng and lat are required');
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'lng/lat out of range');
    }
    if (lng === 0 && lat === 0) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'lng/lat cannot be (0,0)');
    }

    const radiusMeters = Math.min(
      Number.isFinite(query.radiusMeters) ? query.radiusMeters : 5000,
      realEstateSearchService.maxRadiusMeters()
    );

    // Reuse the filter builder without the geo clause, then add $near by hand.
    const { lng: _lng, lat: _lat, radiusMeters: _r, ...rest } = query;
    const filter = await realEstateSearchService.buildPublicFilter(rest);
    delete filter.$text; // incompatible with $near

    filter['location.coordinates'] = {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: radiusMeters,
      },
    };

    const limit = Math.min(Number(query.limit) || 20, 100);
    // Hydrated — `price` is a moneyField (money-edges gate).
    const docs = await RealEstateProperty.find(filter).limit(limit);
    return docs.map((d) => d.toObject({ getters: true }));
  },

  /**
   * Most-viewed published listings. Blueprint §44's "featured" strip.
   *
   * This is view-count based, NOT paid promotion. Paid featured listings are
   * `RealEstatePropertyPromotion` and land in Phase 10 — do not conflate the two, or a
   * customer-facing "Featured" badge will claim a commercial relationship that does not
   * exist yet.
   *
   * @param {number} [limit]
   * @returns {Promise<Array>}
   */
  async featured(limit = 10) {
    // Hydrated — `price` is a moneyField (money-edges gate).
    const docs = await RealEstateProperty.find({
      status: PUBLIC_STATUS,
      availability: { $nin: HIDDEN_AVAILABILITY },
    })
      .sort({ views: -1, publishedAt: -1 })
      .limit(Math.min(limit, 50))
      .select(CARD_PROJECTION);
    return docs.map((d) => d.toObject({ getters: true }));
  },

  /**
   * Newest published listings.
   *
   * @param {number} [limit]
   * @returns {Promise<Array>}
   */
  async recent(limit = 10) {
    // Hydrated — `price` is a moneyField (money-edges gate).
    const docs = await RealEstateProperty.find({
      status: PUBLIC_STATUS,
      availability: { $nin: HIDDEN_AVAILABILITY },
    })
      .sort({ publishedAt: -1 })
      .limit(Math.min(limit, 50))
      .select(CARD_PROJECTION);
    return docs.map((d) => d.toObject({ getters: true }));
  },

  /**
   * Listings similar to one property.
   *
   * Similar on the axes a customer actually compares: same category, same transaction
   * type, same city, price within ±30%. Price is widened twice if nothing matches,
   * because returning zero "similar properties" on a listing page is worse than
   * returning something 50% away.
   *
   * @param {object} property the source listing (needs category, transactionType, city, price)
   * @param {number} [limit]
   * @returns {Promise<Array>}
   */
  async similar(property, limit = 6) {
    if (!property) return [];

    const base = {
      status: PUBLIC_STATUS,
      availability: { $nin: HIDDEN_AVAILABILITY },
      _id: { $ne: property._id },
      category: property.category,
      transactionType: property.transactionType,
    };
    if (property.city) base.city = property.city;

    // `property.price` arrives in RUPEES (every read edge returns rupees —
    // money-edges gate), but the `price` column stores paise. Compare in
    // paise, or the range matches nothing and every listing page shows
    // zero "similar properties".
    const pricePaise = Math.round((Number(property.price) || 0) * 100);
    const multipliers = [0.3, 0.5, 1.0];

    for (const m of multipliers) {
      const filter = { ...base };
      if (pricePaise > 0) {
        filter.priceOnRequest = { $ne: true };
        filter.price = { $gte: pricePaise * (1 - m), $lte: pricePaise * (1 + m) };
      }
      const docs = await RealEstateProperty.find(filter)
        .sort({ views: -1 })
        .limit(limit)
        .select(CARD_PROJECTION);
      // Hydrated — the rows carry `price` back in rupees.
      const found = docs.map((d) => d.toObject({ getters: true }));
      if (found.length) return found;
    }
    return [];
  },

  // -------------------------------------------------------- verification

  /**
   * The safe, customer-facing verification summary (blueprint §14, BR-18).
   *
   * Returns document TYPES that cleared, never a file URL and never a filename. A
   * customer is entitled to know "Ownership ✓, Approval ✓"; they are not entitled to
   * the deed itself, and returning a URL and trusting the client to hide it is not
   * access control.
   *
   * @param {object} property
   * @param {Array<object>} documents accepted `CUSTOMER_VISIBLE` documents
   * @returns {object}
   */
  verificationSummary(property, documents = []) {
    const categoriesCleared = [
      ...new Set(
        documents
          .filter((d) => d.status === 'ACCEPTED' && d.visibility === 'CUSTOMER_VISIBLE')
          .map((d) => d.category)
      ),
    ].sort();

    return {
      verified: Boolean(property && property.verifiedAt),
      verifiedAt: property ? property.verifiedAt || null : null,
      // Types only. No ids, no urls, no filenames.
      documentsCleared: categoriesCleared,
    };
  },
};

module.exports = realEstateSearchService;
