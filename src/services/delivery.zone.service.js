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

/**
 * delivery.zone.service.js — city delivery zones as locality groups (Batch A-2).
 *
 * A zone is a named set of `Locality` ids in one city. No shapes, no drawing:
 * every check downstream is membership. The system proposes compact groups by
 * nearest attachment; the city-master disposes (rename, move, split, publish).
 *
 * ## The three rules from the plan
 *
 *   1. One writer: the clustering job proposes, the city-master publishes.
 *      Publish paths are the only writers of `DeliveryZone`.
 *   2. Versioned, never edited destructively: every publish bumps `version`
 *      and appends a full snapshot to `DeliveryZoneHistory`. Events tag
 *      `zone + zoneVersion`, so dashboards stay comparable across edits.
 *   3. One locality, one zone: enforced at publish time. A locality in two
 *      zones would double-count every metric.
 *
 * ## Why clustering cannot build an 18km zone
 *
 * Groups grow by attaching the nearest unassigned locality while the group
 * diameter stays within the city's cap. A far suburb never qualifies, so it
 * seeds its own group. The cap is a construction parameter, not an error
 * message — there is no rejection path because no manual ticking exists.
 *
 * Food only. The kernel geographic service is consumed as-is (C-1):
 * `haversineMeters` only; no signature touched.
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const config = require('../config/config');
const { City, Locality, DeliveryZone, DeliveryZoneHistory, UserAddress, Orders, Restaurant, User } = require('../models');
const geographicService = require('../kernel/geographic/services/geographic.service');

const DEFAULT_MAX_ZONE_DIAMETER_KM = 8;
const MAX_GROUPS_PER_PUBLISH = 50;
const NEAREST_ZONE_SEARCH_KM = 25;

const pinOf = (loc) => {
  const coords = loc && loc.location && loc.location.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
};

const distanceKm = (a, b) =>
  geographicService.haversineMeters(a.lng, a.lat, b.lng, b.lat) / 1000;

/**
 * Max pairwise distance — the group "width". A group is only as compact as
 * its two farthest members.
 */
const diameterKm = (members) => {
  let max = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const d = distanceKm(members[i], members[j]);
      if (d > max) max = d;
    }
  }
  return max;
};

const centroidOf = (members) => {
  if (!members.length) return null;
  let lng = 0;
  let lat = 0;
  for (const m of members) {
    lng += m.lng;
    lat += m.lat;
  }
  return { lng: lng / members.length, lat: lat / members.length };
};

/**
 * Members farther than `capKm` from the group centroid — the outliers an
 * over-wide group must shed. Used for 422 detail, never stored.
 */
const outliersOf = (members, capKm) => {
  const c = centroidOf(members);
  if (!c) return [];
  return members.filter((m) => distanceKm(m, c) > capKm);
};

/**
 * Greedy nearest-attachment clustering. Deterministic: same pins, same cap,
 * same groups — every run. Seeds scan south-to-north so output ordering is
 * stable for review.
 *
 * @param {Array<{_id, lng, lat}>} points
 * @param {number} capKm
 * @returns {Array<Array<object>>} groups of points
 */
const clusterLocalities = (points, capKm) => {
  const cap = Number(capKm) > 0 ? Number(capKm) : DEFAULT_MAX_ZONE_DIAMETER_KM;
  const sorted = [...points].sort((a, b) => a.lat - b.lat || a.lng - b.lng);
  const unassigned = new Map(sorted.map((p) => [String(p._id), p]));
  const groups = [];

  while (unassigned.size) {
    // Deterministic seed: the southernmost remaining pin, so output ordering
    // is stable run over run for review.
    let seed = null;
    for (const p of sorted) {
      if (unassigned.has(String(p._id))) {
        seed = p;
        break;
      }
    }
    const group = [seed];
    unassigned.delete(String(seed._id));

    for (;;) {
      const c = centroidOf(group);
      let best = null;
      let bestDist = Infinity;
      for (const p of unassigned.values()) {
        const d = distanceKm(c, p);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      if (!best) break;
      if (diameterKm([...group, best]) <= cap) {
        group.push(best);
        unassigned.delete(String(best._id));
      } else {
        // The nearest no longer fits; try the rest in nearest order before
        // closing the group — a gap (river, cantonment) can sit between two
        // attachable neighbours.
        let attached = false;
        const rest = [...unassigned.values()].sort(
          (a, b) => distanceKm(c, a) - distanceKm(c, b)
        );
        for (const p of rest) {
          if (p === best) continue;
          if (diameterKm([...group, p]) <= cap) {
            group.push(p);
            unassigned.delete(String(p._id));
            attached = true;
            break;
          }
        }
        if (!attached) break;
      }
    }
    groups.push(group);
  }
  return groups;
};

const getZoneDiameterCapKm = async (cityId) => {
  try {
    const city = await City.findById(cityId, { maxZoneDiameterKm: 1 }).lean();
    const v = city && Number(city.maxZoneDiameterKm);
    if (Number.isFinite(v) && v > 0) return Math.min(100, Math.max(1, v));
  } catch {
    /* fall through to default */
  }
  return DEFAULT_MAX_ZONE_DIAMETER_KM;
};

const assertCityId = (cityId) => {
  if (!cityId || !mongoose.Types.ObjectId.isValid(cityId)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'City is not valid');
  }
};

/**
 * Peak freeze (Batch E-4). Zone publishes and moves rewrite the map every
 * dashboard reads from — during a known rush that is how a well-meaning edit
 * becomes an incident. When frozen, writes need `force: true` (the
 * incident-commander sign-off, recorded in history via `reason`).
 *
 * @throws {ApiError} 422 while frozen without force
 */
const assertEditionOpen = (options = {}) => {
  if (config.zone && config.zone.editionFrozen === true && options.force !== true) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      'Zone editing is frozen during peak — retry with force after sign-off'
    );
  }
};

/**
 * City-master scoping (Batch D-1). Zone stewardship is per city: a master
 * publishes, moves and reviews only their own city's zones. See
 * `assertMasterOwnsRestaurant` for why this lives at the service, not auth.
 *
 * @throws {ApiError} 404 on missing master, 403 on cross-city access
 */
const assertMasterOwnsCity = async (masterId, cityId) => {
  assertCityId(cityId);
  const master = await User.findById(masterId, { city: 1 }).lean();
  if (!master) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  if (String(master.city) !== String(cityId)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'City is outside your scope');
  }
  return master;
};

const cityLocalities = (cityId) =>
  Locality.find({ city: new mongoose.Types.ObjectId(cityId), status: true }).lean();

const writeHistory = ({ zone, city, version, name, localities, change, updatedBy, reason }) =>
  DeliveryZoneHistory.create({
    zone,
    city,
    version,
    name: name || '',
    localities: localities || [],
    change: change || 'republished',
    updatedBy: updatedBy || null,
    reason: reason || null,
  });

/**
 * Active zones of a city, with locality names + pins for review screens.
 */
const listZonesByCity = async (cityId, options = {}) => {
  assertCityId(cityId);
  if (options.masterId) await assertMasterOwnsCity(options.masterId, cityId);
  return DeliveryZone.find({ city: new mongoose.Types.ObjectId(cityId), status: true })
    .populate('localities', 'name location')
    .sort({ name: 1 })
    .lean();
};

/**
 * Propose compact groups. Pure read — writes nothing. The city-master reviews
 * (rename, drag across the river, split) and publishes.
 *
 * @returns {Promise<{groups: Array<{localities, diameterKm, centroid}>, capKm}>}
 */
const proposeZones = async (cityId, options = {}) => {
  assertCityId(cityId);
  if (options.masterId) await assertMasterOwnsCity(options.masterId, cityId);
  const capKm = Number(options.maxDiameterKm) > 0 ? Number(options.maxDiameterKm) : await getZoneDiameterCapKm(cityId);
  const rows = await cityLocalities(cityId);
  const points = rows.map((r) => ({ _id: r._id, name: r.name, ...pinOf(r) })).filter((p) => p.lng !== undefined);
  const groups = clusterLocalities(
    points.filter((p) => Number.isFinite(p.lng) && Number.isFinite(p.lat)),
    capKm
  );
  return {
    capKm,
    groups: groups.map((g, i) => ({
      suggestedName: `Zone ${i + 1}`,
      diameterKm: Number(diameterKm(g).toFixed(2)),
      centroid: centroidOf(g),
      localities: g.map((p) => ({ id: p._id, name: p.name, lng: p.lng, lat: p.lat })),
    })),
  };
};

const loadCityLocalityMap = async (cityId) => {
  const rows = await cityLocalities(cityId);
  return new Map(rows.map((r) => [String(r._id), r]));
};

/**
 * Publish a full zone set for a city. Full replace with overlap matching, so
 * zone ids survive small geography changes and metrics stay continuous:
 * an incoming group that best-overlaps an existing zone updates it in place
 * (version++); orphans are retired, strangers are created.
 */
const publishZones = async (cityId, groups, options = {}) => {
  assertCityId(cityId);
  assertEditionOpen(options);
  const { updatedBy = null, reason = null, masterId = null } = options;
  if (masterId) await assertMasterOwnsCity(masterId, cityId);
  if (!Array.isArray(groups) || !groups.length) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'At least one zone group is required');
  }
  if (groups.length > MAX_GROUPS_PER_PUBLISH) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `At most ${MAX_GROUPS_PER_PUBLISH} zones per publish`);
  }
  const capKm = Number(options.maxDiameterKm) > 0 ? Number(options.maxDiameterKm) : await getZoneDiameterCapKm(cityId);
  const cityMap = await loadCityLocalityMap(cityId);

  const normalised = groups.map((g, i) => {
    const ids = [...new Set((g.localities || []).map(String))];
    if (!ids.length) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Group ${i + 1} has no localities`);
    }
    for (const id of ids) {
      if (!mongoose.Types.ObjectId.isValid(id) || !cityMap.has(id)) {
        throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Locality ${id} is not in this city`);
      }
    }
    const members = ids.map((id) => {
      const pin = pinOf(cityMap.get(id));
      return { _id: id, lng: pin ? pin.lng : NaN, lat: pin ? pin.lat : NaN };
    });
    if (members.some((m) => !Number.isFinite(m.lng) || !Number.isFinite(m.lat))) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Group ${i + 1} has a locality without a usable pin`);
    }
    const width = diameterKm(members);
    if (width > capKm) {
      const outliers = outliersOf(members, capKm).map((m) => String(m._id));
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Group ${i + 1} spans ${width.toFixed(1)}km (cap ${capKm}km). Outliers: ${outliers.join(', ')}. Split it.`
      );
    }
    return { name: typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 120) : `Zone ${i + 1}`, ids };
  });

  const seen = new Set();
  for (const g of normalised) {
    for (const id of g.ids) {
      if (seen.has(id)) {
        throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `Locality ${id} is in more than one zone`);
      }
      seen.add(id);
    }
  }

  const existing = await DeliveryZone.find({
    city: new mongoose.Types.ObjectId(cityId),
    status: true,
  });
  const matchedExisting = new Set();
  const summary = { created: 0, updated: 0, retired: 0, unchanged: 0 };

  for (const g of normalised) {
    const gSet = new Set(g.ids);
    let best = null;
    let bestOverlap = 0;
    for (const z of existing) {
      if (matchedExisting.has(String(z._id))) continue;
      const zSet = new Set((z.localities || []).map(String));
      let overlap = 0;
      for (const id of gSet) if (zSet.has(id)) overlap += 1;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = z;
      }
    }
    if (best && bestOverlap > 0) {
      matchedExisting.add(String(best._id));
      const sameSet =
        bestOverlap === gSet.size && (best.localities || []).length === gSet.size;
      const sameName = (best.name || '') === g.name;
      if (sameSet && sameName) {
        summary.unchanged += 1;
        continue;
      }
      best.localities = g.ids.map((id) => new mongoose.Types.ObjectId(id));
      best.name = g.name;
      best.version = (best.version || 1) + 1;
      best.effectiveFrom = new Date();
      best.updatedBy = updatedBy ? new mongoose.Types.ObjectId(updatedBy) : null;
      await best.save();
      await writeHistory({
        zone: best._id,
        city: cityId,
        version: best.version,
        name: best.name,
        localities: best.localities,
        change: sameSet ? 'renamed' : 'republished',
        updatedBy,
        reason,
      });
      summary.updated += 1;
    } else {
      const created = await DeliveryZone.create({
        city: cityId,
        name: g.name,
        localities: g.ids.map((id) => new mongoose.Types.ObjectId(id)),
        version: 1,
        effectiveFrom: new Date(),
        updatedBy: updatedBy ? new mongoose.Types.ObjectId(updatedBy) : null,
        status: true,
      });
      await writeHistory({
        zone: created._id,
        city: cityId,
        version: 1,
        name: created.name,
        localities: created.localities,
        change: 'created',
        updatedBy,
        reason,
      });
      summary.created += 1;
    }
  }

  for (const z of existing) {
    if (matchedExisting.has(String(z._id))) continue;
    z.status = false;
    await z.save();
    await writeHistory({
      zone: z._id,
      city: cityId,
      version: z.version || 1,
      name: z.name,
      localities: z.localities || [],
      change: 'retired',
      updatedBy,
      reason,
    });
    summary.retired += 1;
  }

  logger.info(
    `zones published for city ${cityId}: ${summary.created} created, ${summary.updated} updated, ` +
      `${summary.retired} retired, ${summary.unchanged} unchanged`
  );
  return summary;
};

/**
 * Move one locality between zones (surgical edit). The diameter cap is
 * checked before any write; a violating move writes nothing.
 */
const moveLocality = async (localityId, toZoneId, options = {}) => {
  const { updatedBy = null, reason = null, masterId = null } = options;
  assertEditionOpen(options);
  if (!localityId || !mongoose.Types.ObjectId.isValid(localityId)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Locality is not valid');
  }
  if (!toZoneId || !mongoose.Types.ObjectId.isValid(toZoneId)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Zone is not valid');
  }
  const locality = await Locality.findById(localityId, { city: 1, location: 1, name: 1 }).lean();
  if (!locality) throw new ApiError(httpStatus.NOT_FOUND, 'Locality not found');
  if (masterId) await assertMasterOwnsCity(masterId, locality.city);
  const toZone = await DeliveryZone.findOne({ _id: toZoneId, status: true });
  if (!toZone) throw new ApiError(httpStatus.NOT_FOUND, 'Zone not found');
  if (String(toZone.city) !== String(locality.city)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Locality and zone are in different cities');
  }

  const fromZone = await DeliveryZone.findOne({
    city: locality.city,
    status: true,
    localities: new mongoose.Types.ObjectId(localityId),
  });
  if (fromZone && String(fromZone._id) === String(toZone._id)) {
    return { status: 'unchanged', zone: toZone._id };
  }

  const capKm = await getZoneDiameterCapKm(locality.city);
  const cityMap = await loadCityLocalityMap(locality.city);
  const nextIds = [...new Set([...(toZone.localities || []).map(String), String(localityId)])];
  const members = nextIds.map((id) => {
    const pin = pinOf(cityMap.get(id));
    return { _id: id, lng: pin ? pin.lng : NaN, lat: pin ? pin.lat : NaN };
  });
  if (members.some((m) => !Number.isFinite(m.lng) || !Number.isFinite(m.lat))) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Zone has a locality without a usable pin');
  }
  const width = diameterKm(members);
  if (width > capKm) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      `Move would stretch ${toZone.name} to ${width.toFixed(1)}km (cap ${capKm}km)`
    );
  }

  if (fromZone) {
    fromZone.localities = (fromZone.localities || []).filter((id) => String(id) !== String(localityId));
    fromZone.version = (fromZone.version || 1) + 1;
    fromZone.effectiveFrom = new Date();
    fromZone.updatedBy = updatedBy ? new mongoose.Types.ObjectId(updatedBy) : null;
    await fromZone.save();
    await writeHistory({
      zone: fromZone._id,
      city: fromZone.city,
      version: fromZone.version,
      name: fromZone.name,
      localities: fromZone.localities,
      change: 'moved_out',
      updatedBy,
      reason,
    });
  }
  toZone.localities = nextIds.map((id) => new mongoose.Types.ObjectId(id));
  toZone.version = (toZone.version || 1) + 1;
  toZone.effectiveFrom = new Date();
  toZone.updatedBy = updatedBy ? new mongoose.Types.ObjectId(updatedBy) : null;
  await toZone.save();
  await writeHistory({
    zone: toZone._id,
    city: toZone.city,
    version: toZone.version,
    name: toZone.name,
    localities: toZone.localities,
    change: 'moved_in',
    updatedBy,
    reason,
  });
  return { status: 'moved', from: fromZone ? fromZone._id : null, to: toZone._id };
};

/**
 * The active zone containing a locality, or null (ungrouped).
 */
const resolveZoneForLocality = async (cityId, localityId) => {
  if (!localityId || !mongoose.Types.ObjectId.isValid(localityId)) return null;
  return DeliveryZone.findOne({
    city: new mongoose.Types.ObjectId(cityId),
    status: true,
    localities: new mongoose.Types.ObjectId(localityId),
  }).lean();
};

/**
 * Zone for an arbitrary pin: nearest locality in the city, then its zone.
 * Beyond `maxDistanceKm` the pin is plausibly outside the city — null rather
 * than a confidently wrong zone.
 */
const resolveZoneForPin = async (cityId, lng, lat, options = {}) => {
  const x = Number(lng);
  const y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { zone: null, locality: null, distanceKm: null };
  const maxDistanceKm = Number(options.maxDistanceKm) > 0 ? Number(options.maxDistanceKm) : NEAREST_ZONE_SEARCH_KM;
  const nearest = await Locality.find({
    city: new mongoose.Types.ObjectId(cityId),
    status: true,
    location: {
      $near: { $geometry: { type: 'Point', coordinates: [x, y] }, $maxDistance: maxDistanceKm * 1000 },
    },
  })
    .limit(1)
    .lean();
  if (!nearest.length) return { zone: null, locality: null, distanceKm: null };
  const pin = pinOf(nearest[0]);
  const zone = await resolveZoneForLocality(cityId, nearest[0]._id);
  return {
    zone,
    locality: nearest[0],
    distanceKm: pin ? Number((distanceKm({ lng: x, lat: y }, pin)).toFixed(2)) : null,
  };
};

/**
 * The city a city-master administers (Batch G-1). Lets the zone dialog open
 * with only `:master` — the screen resolves the city itself instead of
 * trusting client input for it.
 */
const getMasterCity = async (masterId) => {
  if (!masterId || !mongoose.Types.ObjectId.isValid(masterId)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Master is not valid');
  }
  const master = await User.findById(masterId, { city: 1 }).lean();
  if (!master || !master.city) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  const city = await City.findById(master.city, { name: 1 }).lean();
  return { id: master.city, name: city ? city.name : '' };
};

/**
 * Customer-side zone for an order (Batch A-4). Best-effort: address
 * `localityRef` first, else the nearest locality to the address pin parsed
 * from `deliveryAddressRaw`, else null. Never throws — callers spread the
 * result onto audit rows, and a missing tag must not fail the write.
 *
 * @param {string|object} orderIdOrDoc
 * @returns {Promise<{zone: ObjectId|null, zoneVersion: number|null}>}
 */
const resolveOrderZone = async (orderIdOrDoc) => {
  const empty = { zone: null, zoneVersion: null };
  try {
    const order =
      orderIdOrDoc && orderIdOrDoc.deliveryAddressRaw !== undefined
        ? orderIdOrDoc
        : await Orders.findById(orderIdOrDoc, {
            deliveryAddress: 1,
            deliveryAddressRaw: 1,
            restaurant: 1,
          }).lean();
    if (!order) return empty;
    const restaurant = order.restaurant
      ? await Restaurant.findById(order.restaurant, { city: 1 }).lean()
      : null;
    const cityId = restaurant && restaurant.city;
    if (!cityId) return empty;

    if (order.deliveryAddress && mongoose.Types.ObjectId.isValid(order.deliveryAddress)) {
      const address = await UserAddress.findById(order.deliveryAddress, { localityRef: 1 }).lean();
      if (address && address.localityRef) {
        const zone = await resolveZoneForLocality(cityId, address.localityRef);
        if (zone) return { zone: zone._id, zoneVersion: zone.version || 1 };
      }
    }

    if (order.deliveryAddressRaw) {
      try {
        const parsed = JSON.parse(order.deliveryAddressRaw);
        const coords = parsed && parsed.location && parsed.location.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          const found = await resolveZoneForPin(cityId, coords[0], coords[1]);
          if (found.zone) {
            return { zone: found.zone._id, zoneVersion: found.zone.version || 1 };
          }
        }
      } catch {
        /* raw address is free-form; unparseable means untaggable, not an error */
      }
    }
    return empty;
  } catch {
    return empty;
  }
};

/**
 * Ungrouped-volume alert (Batch A-4). Orders whose customer side resolves to
 * no zone, over a recent window, as a ratio of all orders in the city. Above
 * threshold means the zone map is rotting (new localities, bad pins) and the
 * city-master should review — this pages; everything else is a dashboard.
 *
 * @param {string} cityId
 * @param {object} [options] { sinceHours, threshold }
 * @returns {Promise<{cityId, window, total, ungrouped, ratio, threshold, alert}>}
 */
const checkUngroupedVolume = async (cityId, options = {}) => {
  assertCityId(cityId);
  const sinceHours = Number(options.sinceHours) > 0 ? Number(options.sinceHours) : 24;
  const threshold =
    Number(options.threshold) > 0 && Number(options.threshold) < 1 ? Number(options.threshold) : 0.02;
  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const restaurants = await Restaurant.find(
    { city: new mongoose.Types.ObjectId(cityId) },
    { _id: 1 }
  ).lean();
  const ids = restaurants.map((r) => r._id);
  if (!ids.length) {
    return { cityId: String(cityId), window: { since }, total: 0, ungrouped: 0, ratio: 0, threshold, alert: false };
  }
  const [total, ungrouped] = await Promise.all([
    Orders.countDocuments({ restaurant: { $in: ids }, createdAt: { $gte: since } }),
    Orders.countDocuments({ restaurant: { $in: ids }, createdAt: { $gte: since }, zone: null }),
  ]);
  const ratio = total > 0 ? ungrouped / total : 0;
  return {
    cityId: String(cityId),
    window: { since },
    total,
    ungrouped,
    ratio: Number(ratio.toFixed(4)),
    threshold,
    alert: ratio > threshold && total > 0,
  };
};

module.exports = {
  DEFAULT_MAX_ZONE_DIAMETER_KM,
  pinOf,
  diameterKm,
  centroidOf,
  outliersOf,
  clusterLocalities,
  getZoneDiameterCapKm,
  listZonesByCity,
  proposeZones,
  publishZones,
  moveLocality,
  assertMasterOwnsCity,
  assertEditionOpen,
  getMasterCity,
  resolveZoneForLocality,
  resolveZoneForPin,
  resolveOrderZone,
  checkUngroupedVolume,
};
