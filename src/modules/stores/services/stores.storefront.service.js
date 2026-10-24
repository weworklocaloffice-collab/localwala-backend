/**
 * LocalWala �?" Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Ac 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * Customer storefront reads.
 *
 * The customer contract is CHAIN-first: a brand owns the catalogue and the customer picks
 * an outlet for stock. The older `/:store` handlers in `stores.storefront.route.js` are
 * kept for the already-shipped outlet screen, but they cannot answer "which outlets of
 * this chain can deliver to me", "what are this chain's policies" or "what is live for
 * the whole chain". Those reads live here.
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const catalogService = require('./stores.catalog.service');

const PUBLIC_CHAIN_FIELDS =
  'name slug logo cover description rating ratingCount featured verified outletCount catalogueScope categories subcategories';

const PUBLIC_OUTLET_FIELDS =
  'name slug outletCode logo cover photos description address location operatingHours holidays deliveryConfig rating ratingCount isOrganicCertified featured verified';

const activeOutletFilter = (chain) => ({
  chain,
  status: { $in: ['active', 'reactivated'] },
  operational: true,
});

const isOpenNow = (outlet, at = new Date()) => {
  const day = at.getDay();
  const currentTime = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const today = (outlet.operatingHours || []).find((h) => h.day === day);
  if (!today) return true;
  if (today.isOpen === false) return false;
  if (!today.opensAt || !today.closesAt) return true;
  return currentTime >= today.opensAt && currentTime <= today.closesAt;
};

const withDistance = (outlet, lat, lng) => {
  if (!outlet.location || !Array.isArray(outlet.location.coordinates)) return outlet;
  const [outletLng, outletLat] = outlet.location.coordinates;
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(outletLat - lat);
  const dLng = toRadians(outletLng - lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat)) * Math.cos(toRadians(outletLat)) * Math.sin(dLng / 2) ** 2;
  const distanceKm = earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return {
    ...outlet,
    distanceKm: Math.round(distanceKm * 10) / 10,
    isOpenNow: isOpenNow(outlet),
  };
};

/**
 * Nearby CHAINS, each carrying its eligible outlets for the inline outlet picker.
 *
 * Grouping is done after the geo query because Mongo cannot group a `$near` result without
 * losing the distance sort. The nearby query is bounded by radius and limit, so the group
 * set is small.
 */
const listChains = async ({ lat, lng, radiusKm = 10, limit = 20 }) => {
  const StoreOutlet = mongoose.model('StoreOutlet');
  const StoreChain = mongoose.model('StoreChain');

  const outlets = await StoreOutlet.find({
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: radiusKm * 1000,
      },
    },
    status: { $in: ['active', 'reactivated'] },
    operational: true,
  })
    .select(PUBLIC_OUTLET_FIELDS)
    .limit(limit * 4)
    .lean();

  if (!outlets.length) return [];

  const chainIds = [...new Set(outlets.map((outlet) => String(outlet.chain)))];
  const chains = await StoreChain.find({
    _id: { $in: chainIds },
    status: { $in: ['active', 'reactivated'] },
  })
    .select(PUBLIC_CHAIN_FIELDS)
    .populate('categories', 'key name icon sortOrder')
    .lean();

  const chainById = new Map(chains.map((chain) => [String(chain._id), chain]));
  const grouped = new Map();

  for (const outlet of outlets) {
    const chain = chainById.get(String(outlet.chain));
    if (!chain) continue;
    const key = String(chain._id);
    if (!grouped.has(key)) grouped.set(key, { ...chain, outlets: [] });
    grouped.get(key).outlets.push(withDistance(outlet, lat, lng));
  }

  return [...grouped.values()]
    .map((chain) => ({
      ...chain,
      nearestOutletKm: Math.min(...chain.outlets.map((outlet) => outlet.distanceKm ?? Infinity)),
      openOutletCount: chain.outlets.filter((outlet) => outlet.isOpenNow).length,
    }))
    .sort((a, b) => {
      if (a.nearestOutletKm !== b.nearestOutletKm) return a.nearestOutletKm - b.nearestOutletKm;
      if ((b.rating || 0) !== (a.rating || 0)) return (b.rating || 0) - (a.rating || 0);
      return String(a.name).localeCompare(String(b.name));
    })
    .slice(0, limit);
};

/**
 * Chain profile: public brand record, eligible outlets, and the four policies.
 *
 * `policies` is resolved for the requested outlet when one is supplied: an outlet row wins
 * over the chain row for the same type. Without an outlet the chain defaults are returned.
 * Category/product-level policy rows do not exist in the schema yet, so this is the full
 * resolution this vertical can honestly perform.
 */
const getChainProfile = async ({ chain, outlet }) => {
  const StoreChain = mongoose.model('StoreChain');
  const StoreOutlet = mongoose.model('StoreOutlet');
  const StorePolicy = mongoose.model('StorePolicy');

  const chainDoc = await StoreChain.findOne({
    _id: chain,
    status: { $in: ['active', 'reactivated'] },
  })
    .select(PUBLIC_CHAIN_FIELDS)
    .populate('categories', 'key name icon sortOrder')
    .populate('subcategories', 'category key name slug icon image sortOrder categoryDefaults')
    .lean();
  if (!chainDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Chain not found');

  const outlets = await StoreOutlet.find(activeOutletFilter(chain))
    .select(PUBLIC_OUTLET_FIELDS)
    .populate('address.city', 'name')
    .populate('address.locality', 'name')
    .sort({ featured: -1, rating: -1, name: 1 })
    .lean();

  if (outlet) {
    const selected = outlets.find((row) => String(row._id) === String(outlet));
    if (!selected) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found for this chain');
  }

  const now = new Date();
  const policies = await StorePolicy.find({
    chain,
    isActive: true,
    effectiveFrom: { $lte: now },
    $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gte: now } }],
    $and: [
      {
        $or: [{ outlet: null }, { outlet: { $exists: false } }, { outlet: { $in: outlets.map((row) => row._id) } }],
      },
    ],
  })
    .sort({ version: -1, createdAt: -1 })
    .lean();

  const resolved = new Map();
  for (const policy of policies) {
    if (policy.outlet) continue;
    if (!resolved.has(policy.type)) resolved.set(policy.type, policy);
  }
  if (outlet) {
    for (const policy of policies) {
      if (policy.outlet && String(policy.outlet) === String(outlet)) {
        resolved.set(policy.type, policy);
      }
    }
  }

  return {
    chain: chainDoc,
    outlets: outlets.map((row) => ({ ...row, isOpenNow: isOpenNow(row) })),
    policies: [...resolved.values()],
  };
};

const listChainProducts = async ({ chain, outlet, query }) => {
  const StoreChain = mongoose.model('StoreChain');
  const StoreOutlet = mongoose.model('StoreOutlet');

  const exists = await StoreChain.exists({
    _id: chain,
    status: { $in: ['active', 'reactivated'] },
  });
  if (!exists) throw new ApiError(httpStatus.NOT_FOUND, 'Chain not found');

  if (outlet) {
    const outletDoc = await StoreOutlet.findOne({ _id: outlet, chain })
      .select('chain status operational')
      .lean();
    if (!outletDoc || !['active', 'reactivated'].includes(outletDoc.status) || !outletDoc.operational) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found for this chain');
    }
  }

  return catalogService.listProducts({ ...query, chain, outlet });
};

const listChainReviews = async ({ chain, page, limit }) => {
  const reviewService = require('./stores.review.service');
  const StoreReview = mongoose.model('StoreReview');

  const [result, breakdown] = await Promise.all([
    reviewService.listReviews({ chain, status: 'approved', page, limit }),
    StoreReview.aggregate([
      { $match: { chain: new mongoose.Types.ObjectId(String(chain)), status: 'approved' } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
  ]);

  return {
    ...result,
    ratingBreakdown: breakdown.reduce(
      (acc, row) => ({ ...acc, [row._id]: row.count }),
      { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    ),
  };
};

const listChainOffers = async ({ chain }) => {
  const StorePromotion = mongoose.model('StorePromotion');
  const now = new Date();
  return StorePromotion.find({
    chain,
    ...StorePromotion.redeemableFilter(now),
  })
    .select('name description type value maxDiscount minOrderAmount code startsAt endsAt outlet')
    .populate('outlet', 'name outletCode')
    .sort({ priority: -1, createdAt: -1 })
    .lean();
};

/**
 * The live taxonomy tree: category -> subcategory -> attribute templates.
 *
 * `StoreSubcategory.attributeTemplates` is the intended per-subcategory list, but the
 * product form currently exposes every active template. The tree mirrors the form: a
 * subcategory with explicit templates gets those, otherwise it gets the global set, so
 * the browse screen and the form cannot disagree about what a product may carry.
 */
const getCatalogTree = async () => {
  const StoreCategory = mongoose.model('StoreCategory');
  const StoreSubcategory = mongoose.model('StoreSubcategory');
  const StoreAttributeTemplate = mongoose.model('StoreAttributeTemplate');

  const [categories, subcategories, templates] = await Promise.all([
    StoreCategory.find({ status: true })
      .select('key name icon sortOrder')
      .sort({ sortOrder: 1, name: 1 })
      .lean(),
    StoreSubcategory.find({ status: true })
      .select('category key name slug icon image sortOrder attributeTemplates categoryDefaults')
      .sort({ sortOrder: 1, name: 1 })
      .lean(),
    StoreAttributeTemplate.find({ status: true }).sort({ displayOrder: 1, name: 1 }).lean(),
  ]);

  const templateById = new Map(templates.map((template) => [String(template._id), template]));
  const globalTemplates = templates.map((template) => ({ ...template, variantAxis: template.variantAxis || false }));

  return categories.map((category) => ({
    ...category,
    subcategories: subcategories
      .filter((subcategory) => String(subcategory.category) === String(category._id))
      .map((subcategory) => {
        const explicit = (subcategory.attributeTemplates || [])
          .map((id) => templateById.get(String(id)))
          .filter(Boolean)
          .map((template) => ({ ...template, variantAxis: template.variantAxis || false }));
        return {
          ...subcategory,
          attributes: explicit.length ? explicit : globalTemplates,
        };
      }),
  }));
};

module.exports = {
  listChains,
  getChainProfile,
  listChainProducts,
  listChainReviews,
  listChainOffers,
  getCatalogTree,
  isOpenNow,
};
