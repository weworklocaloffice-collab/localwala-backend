/**
 * jhatka.browse.service.js — what a customer can see before they have a cart.
 *
 * Backs `GET /home` and `GET /availability` (§15.2). Both are READ surfaces that run
 * before any order exists, so neither is a tenancy-scoped outlet route — they take
 * lat/lng and return what is near the customer.
 *
 * ## Availability is explicitly ESTIMATED, not a promise
 *
 * `JhatkaInventoryItem` is per-batch. "Is this shop selling chicken right now" means
 * summing every unexpired, unquarantined batch for the variant across the outlet's
 * SKUs, and doing it per variant per request is a query explosion. `estimatedAvailability`
 * on the variant is the coarse figure the shop maintains.
 *
 * So this returns the estimate and LABELS IT as one. A precise figure here would be a
 * lie: the last batch can be sold between the read and the checkout. That is precisely
 * why the estimate is recomputed at checkout from `JhatkaInventoryItem`, and why an
 * estimate that turns out to be wrong produces a REFUND rather than a no-order.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');

/** Earth radius in km. Haversine below, so no geo dependency is needed. */
const EARTH_RADIUS_KM = 6371;

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Distance in km between two `{lat, lng}` points.
 *
 * Haversine rather than a planar approximation: at city scale the error in the
 * "equirectangular" shortcut is metres, but the shortcuts that ARE tempting here
 * (treating degrees as a flat grid) are wrong by tens of kilometres at 5 km range,
 * which is the entire delivery radius.
 */
function distanceKm(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Parse and validate `?lat&lng`.
 *
 * Rejected rather than defaulted. A browse endpoint that silently treats a missing
 * coordinate as (0,0) returns the shops near the Gulf of Guinea and calls it the
 * customer's area, which is a worse failure than a 400.
 */
function parsePoint(query) {
  const lat = Number(query.lat);
  const lng = Number(query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'lat and lng are required as numbers (e.g. ?lat=18.52&lng=73.85)'
    );
  }
  if (lat < -90 || lat > 90) throw new ApiError(httpStatus.BAD_REQUEST, 'lat must be -90..90');
  if (lng < -180 || lng > 180) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'lng must be -180..180');
  }

  return { lat, lng };
}

/**
 * `GET /home` — nearby outlets and what they sell.
 *
 * Only `active` outlets. A suspended or closed shop that still appears in browse is a
 * customer who drives to a shuttered door; §15.2's availability surface depends on this
 * being trustworthy, so the filter is here rather than in the client.
 */
async function home({ query, models }) {
  const { JhatkaOutlet, JhatkaProduct } = models;
  const point = parsePoint(query);

  const outlets = await JhatkaOutlet.find({ status: 'active' })
    .select('name outletCode address location serviceArea businessModel business minDeliveryMinutes')
    .lean();

  const withDistance = outlets
    .map((o) => {
      const loc = o.location?.coordinates;
      if (!loc || loc.length !== 2) return null;

      const d = distanceKm(point, { lat: loc[1], lng: loc[0] });
      const radiusKm = o.serviceArea?.radiusKm ?? 5;

      return {
        id: String(o._id),
        name: o.name,
        outletCode: o.outletCode,
        locality: o.address?.locality,
        city: o.address?.city,
        distanceKm: Math.round(d * 100) / 100,
        serviceRadiusKm: radiusKm,
        // A shop outside its own radius still lists, but is marked. Hiding it would
        // make the app look empty in a suburb with one butcher; showing it unmarked
        // would send the customer to a shop that will refuse the order.
        inDeliveryRange: d <= radiusKm,
        minDeliveryMinutes: o.minDeliveryMinutes ?? o.orderConfig?.minDeliveryMinutes,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  // A category strip, so the app has something to render before a shop is picked.
  const categories = await JhatkaProduct.distinct('category');

  return {
    location: point,
    outletCount: withDistance.length,
    inRangeCount: withDistance.filter((o) => o.inDeliveryRange).length,
    outlets: withDistance,
    categoryIds: categories.map(String),
  };
}

/**
 * `GET /availability` — which variants are near the customer, and roughly how much.
 *
 * §16 blueprint: ADDRESS-SCOPED. Takes the same lat/lng as `/home` because the
 * alternative — resolving from a stored address the customer may have moved away from
 * — silently answers for the wrong house.
 */
async function availability({ query, models }) {
  const { JhatkaOutlet, JhatkaProduct, JhatkaVariant } = models;
  const point = parsePoint(query);

  const outlets = await JhatkaOutlet.find({ status: 'active' })
    .select('name outletCode location serviceArea')
    .lean();

  const near = outlets.filter((o) => {
    const loc = o.location?.coordinates;
    if (!loc || loc.length !== 2) return false;
    const d = distanceKm(point, { lat: loc[1], lng: loc[0] });
    return d <= (o.serviceArea?.radiusKm ?? 5);
  });

  if (!near.length) {
    return {
      location: point,
      outletCount: 0,
      outlets: [],
      items: [],
      note: 'No Jhatka outlet serves this location yet',
    };
  }

  const variants = await JhatkaVariant.find({
    status: { $in: ['active', 'in_stock', 'out_of_stock'] },
  })
    .select('product sku name measurementMode pricePerUnit priceBasis isActive estimatedAvailability availabilityUnit status packSize')
    .lean();

  const active = variants.filter((v) => v.isActive !== false && v.status !== 'archived');
  const productIds = [...new Set(active.map((v) => String(v.product)))];

  const products = await JhatkaProduct.find({ _id: { $in: productIds }, isActive: { $ne: false } })
    .select('name category image')
    .lean();

  const productById = new Map(products.map((p) => [String(p._id), p]));

  return {
    location: point,
    outletCount: near.length,
    outlets: near.map((o) => ({ id: String(o._id), name: o.name, outletCode: o.outletCode })),
    items: active
      .filter((v) => productById.has(String(v.product)))
      .map((v) => ({
        // `JhatkaVariant` is CATALOGUE-WIDE — it carries no outlet reference, because
        // the same SKU is sold by every Jhatka shop. So a variant is not attributed to
        // one outlet here; `outletIds` below is the honest answer to "who could fulfil
        // this", and the per-variant figure below is each shop's own estimate.
        product: String(v.product),
        productName: productById.get(String(v.product))?.name,
        variant: String(v._id),
        sku: v.sku,
        name: v.name,
        image: productById.get(String(v.product))?.image,
        measurementMode: v.measurementMode,
        pricePerUnit: v.pricePerUnit,
        priceBasis: v.priceBasis,
        packSize: v.packSize,
        // EXPLICITLY an estimate. See the note at the top of this file.
        estimatedAvailability: v.estimatedAvailability ?? 0,
        availabilityUnit: v.availabilityUnit || (v.measurementMode === 'WEIGHT' ? 'KG' : 'PIECE'),
        inStock: (v.estimatedAvailability ?? 0) > 0,
      })),
    outletIds: near.map((o) => String(o._id)),
    note: 'Availability is an estimate maintained by each outlet; it is confirmed at checkout',
  };
}

/**
 * Products at one outlet: active catalogue plus that outlet's estimate and
 * any in-force price override.
 *
 * Deliberately estimate-based, like `availability`: the variant carries the
 * shop-maintained `estimatedAvailability`, and checkout reconfirms from
 * `JhatkaInventoryItem`. Override matching mirrors the order-pricing lookup
 * (active + in force + this outlet + this variant) without repricing anything
 * — the number shown is still an estimate, and the order remains the price.
 */
async function outletProducts({ outletId, models, query }) {
  const { JhatkaProduct, JhatkaVariant, JhatkaPriceOverride } = models;
  const { category, search, page = 1, limit = 50 } = query || {};

  const productMatch = { isActive: { $ne: false } };
  if (category) productMatch.category = category;
  if (search) {
    const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    productMatch.name = new RegExp(safe, 'i');
  }

  const products = await JhatkaProduct.find(productMatch)
    .select('name description image category')
    .sort({ name: 1 })
    .skip((Math.max(1, Number(page)) - 1) * Number(limit))
    .limit(Math.min(200, Math.max(1, Number(limit))))
    .lean();

  const variants = await JhatkaVariant.find({
    product: { $in: products.map((p) => p._id) },
    status: { $ne: 'archived' },
    isActive: { $ne: false },
  })
    .select('product sku name measurementMode pricePerUnit priceBasis packSize estimatedAvailability availabilityUnit')
    .lean();

  const overrides = await JhatkaPriceOverride.find({
    outlet: outletId,
    variant: { $in: variants.map((v) => v._id) },
    status: 'active',
  }).lean();
  const now = new Date();
  const overrideByVariant = new Map();
  for (const o of overrides) {
    if (o.effectiveFrom && new Date(o.effectiveFrom) > now) continue;
    if (o.effectiveTo && new Date(o.effectiveTo) <= now) continue;
    if (!overrideByVariant.has(String(o.variant))) {
      overrideByVariant.set(String(o.variant), o);
    }
  }

  return {
    outlet: String(outletId),
    products: products.map((p) => ({
      id: String(p._id),
      name: p.name,
      description: p.description,
      image: p.image,
      variants: variants
        .filter((v) => String(v.product) === String(p._id))
        .map((v) => {
          const override = overrideByVariant.get(String(v._id));
          return {
            id: String(v._id),
            sku: v.sku,
            name: v.name,
            measurementMode: v.measurementMode,
            pricePerUnit: override ? override.pricePerUnit : v.pricePerUnit,
            listPricePerUnit: v.pricePerUnit,
            priceOverridden: !!override,
            priceBasis: v.priceBasis,
            packSize: v.packSize,
            estimatedAvailability: v.estimatedAvailability ?? 0,
            availabilityUnit: v.availabilityUnit || (v.measurementMode === 'WEIGHT' ? 'KG' : 'PIECE'),
            inStock: (v.estimatedAvailability ?? 0) > 0,
          };
        }),
    })),
    page: Number(page),
    limit: Number(limit),
    note: 'Prices and availability are estimates; the order confirms both',
  };
}

module.exports = { home, availability, outletProducts, distanceKm, parsePoint };