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

const Reel = require('../../../models/reel.model');
const Restaurant = require('../../../models/restaurant.model');
const Food = require('../../../models/food.model');
const Cuisine = require('../../../models/cuisine.model');
const { socialProofService } = require('../../social');
const likerRepository = require('../repositories/reel.liker.repository');

const isObjectId = (value) => /^[0-9a-f]{24}$/i.test(String(value || ''));

// Haversine formula for distance between two lat/lng points
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (deg) => deg * (Math.PI / 180);

// The customer app opens a restaurant by slug (never by id), so the feed
// carries a resolved summary next to target.refId. Resolved in bulk for the
// whole page — never one query per reel (§9).
const loadTargetSummaries = async (reels, viewerLocation) => {
  const restaurantIds = new Set();
  const foodIds = new Set();

  reels.forEach((reel) => {
    const target = reel.target;
    if (!target?.refId || !isObjectId(target.refId)) return;
    if (target.type === 'RESTAURANT') restaurantIds.add(String(target.refId));
    else if (target.type === 'PRODUCT') foodIds.add(String(target.refId));
  });

  const summaryByRefId = new Map();

  if (restaurantIds.size) {
    const restaurants = await Restaurant.find(
      { _id: { $in: [...restaurantIds] } },
      {
        name: 1,
        slug: 1,
        logo: 1,
        translations: 1,
        rating: 1,
        cuisine: 1,
        location: 1,
        status: 1,
        temporaryClosed: 1,
      }
    );

    // `cuisine` holds Cuisine ObjectIds, not names. Resolve them in one bulk
    // query for the page — the ids alone would render as raw hex tags (§9).
    const cuisineIds = new Set();
    restaurants.forEach((r) => {
      (r.cuisine || []).forEach((id) => {
        if (id) cuisineIds.add(String(id));
      });
    });
    const cuisineNameById = new Map();
    if (cuisineIds.size) {
      const cuisines = await Cuisine.find(
        { _id: { $in: [...cuisineIds] } },
        { name: 1 }
      );
      cuisines.forEach((c) => cuisineNameById.set(String(c._id), c.name || ''));
    }

    restaurants.forEach((r) => {
      // Availability comes from `temporaryClosed` + `status`. The restaurant
      // schema stores NO opening hours, so any hour-of-day comparison here
      // would be invented data.
      const isOpen = r.status === true && r.temporaryClosed !== true;

      let distanceKm = null;
      if (viewerLocation && r.location?.coordinates) {
        const [lon, lat] = r.location.coordinates;
        distanceKm = calculateDistance(
          viewerLocation.lat,
          viewerLocation.lng,
          lat,
          lon
        );
      }

      summaryByRefId.set(String(r._id), {
        name: r.name || '',
        slug: r.slug || '',
        image: r.logo || '',
        // The app's card tap is gated on this field, so a restaurant summary
        // without it is a dead tap. Food summaries carry their parent id under
        // the same key; keep the two branches shape-compatible.
        restaurantId: String(r._id),
        rating: r.rating || null,
        isOpen,
        distanceKm: distanceKm ? Math.round(distanceKm * 10) / 10 : null,
        cuisines: (r.cuisine || [])
          .map((id) => cuisineNameById.get(String(id)))
          .filter(Boolean),
        translations: r.translations || [],
      });
    });
  }

  if (foodIds.size) {
    const foods = await Food.find(
      { _id: { $in: [...foodIds] } },
      { name: 1, image: 1, translations: 1, restaurant: 1 }
    );
    foods.forEach((f) => {
      summaryByRefId.set(String(f._id), {
        name: f.name || '',
        slug: '',
        image: f.image || '',
        restaurantId: String(f.restaurant || ''),
        translations: f.translations || [],
      });
    });
  }

  return summaryByRefId;
};

// Feed owns pagination shape; social proof is attached in bulk AFTER the page
// resolves — never one query per reel (docs §9).
const getFeed = async ({ page = 1, limit = 10, sortBy = 'createdAt:desc' } = {}, viewerId, viewerLocation) => {
  const options = { page: Number(page) || 1, limit: Math.min(Number(limit) || 10, 50), sortBy };
  // Visibility: PUBLISHED, due SCHEDULED (covers scheduler lag), and legacy
  // docs that predate `status`. PAUSED is excluded via isLocked (§8).
  const now = new Date();
  const result = await Reel.paginate(
    {
      isLocked: { $ne: true },
      $or: [
        { status: 'PUBLISHED' },
        { status: 'SCHEDULED', publishAt: { $lte: now } },
        { status: { $exists: false } },
      ],
    },
    options
  );

  const reelIds = result.results.map((r) => String(r._id || r.id));
  const [proofByReel, summaryByRefId] = await Promise.all([
    viewerId
      ? socialProofService.getBulkSocialProof(
          reelIds,
          viewerId,
          await likerRepository.likerIdsForReels(reelIds)
        )
      : Promise.resolve({}),
    loadTargetSummaries(result.results, viewerLocation),
  ]);

  result.results = result.results.map((reel) => {
    const id = String(reel._id || reel.id);
    const json = typeof reel.toJSON === 'function' ? reel.toJSON() : { ...reel };
    const refId = reel.target?.refId ? String(reel.target.refId) : '';
    return {
      ...json,
      id,
      likesCount: reel.likes || 0,
      socialProof: proofByReel[id] || { people: [], total: 0 },
      targetSummary: refId ? summaryByRefId.get(refId) || null : null,
    };
  });
  return result;
};

module.exports = {
  getFeed,
};
