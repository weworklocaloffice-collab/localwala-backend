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
const mongoose = require('mongoose');
const { Favourite } = require('../../../models');
const ApiError = require('../../../utils/ApiError');

/**
 * Real Estate saved-properties service.
 *
 * Reuses the SHARED `Favourite` model (plan §0A.2: extend, do not duplicate).
 * The shared model already has a `property` ref and a `(user, property)` sparse
 * index, and the `type` field accepts "property" — both added in an earlier
 * commit. This service is the Real Estate-shaped view of that model: it
 * knows that for `type: 'property'`, the query/save/delete shape is
 * `(user, property)`, and it joins against `RealEstateProperty` for the
 * "saved properties" list.
 *
 * ## Why this lives in the real estate module, not in `services/favourite.service.js`
 *
 * The shared service handles restaurant + food aggregation pipelines
 * (`$geoNear`, `Restaurant`/`Food` joins). For property the join is
 * simpler (no geo — the property card already shows the area), and the
 * response shape is `PropertyModel`, not the food-shaped pipeline. A
 * small dedicated service keeps each module's surface area focused.
 */

const PROPERTY_TYPE = 'property';

const savePropertyFavourite = async (userId, propertyId) => {
  if (!userId || !propertyId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'userId and propertyId are required');
  }
  const existing = await Favourite.findOne({ user: userId, type: PROPERTY_TYPE, property: propertyId });
  if (existing) {
    return { success: true, data: existing, alreadySaved: true };
  }
  const row = await Favourite.create({
    user: userId,
    type: PROPERTY_TYPE,
    property: propertyId,
  });
  return { success: true, data: row, alreadySaved: false };
};

const removePropertyFavourite = async (userId, propertyId) => {
  if (!userId || !propertyId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'userId and propertyId are required');
  }
  const r = await Favourite.deleteOne({ user: userId, type: PROPERTY_TYPE, property: propertyId });
  return { success: true, deletedCount: r.deletedCount || 0 };
};

const isPropertyFavourited = async (userId, propertyId) => {
  if (!userId || !propertyId) return false;
  const found = await Favourite.findOne(
    { user: userId, type: PROPERTY_TYPE, property: propertyId },
    { _id: 1 }
  ).lean();
  return !!found;
};

/**
 * Paginated list of a user's saved properties, newest first.
 *
 * Joins against `realestatepropertydetails` (the catalogue) so the
 * consumer can drop the result straight into the property card.
 * The join also enforces visibility — only PUBLISHED properties are
 * returned (the `BR-03` status filter is a property-service concern,
 * not duplicated here).
 */
const listSavedProperties = async (userId, { page = 1, limit = 20 } = {}) => {
  if (!userId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'userId is required');
  }
  const RealEstateProperty = require('../models/realestate.property.model');
  const skip = (Math.max(1, page) - 1) * Math.max(1, limit);
  const take = Math.max(1, limit);

  const filter = { user: userId, type: PROPERTY_TYPE, property: { $ne: null } };
  const total = await Favourite.countDocuments(filter);
  const rows = await Favourite.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(take)
    .select({ property: 1, createdAt: 1 })
    .lean();

  const propertyIds = rows.map((r) => r.property).filter(Boolean);
  const properties = propertyIds.length
    ? await RealEstateProperty.find({ _id: { $in: propertyIds }, status: 'PUBLISHED' })
        .select({
          _id: 1,
          propertyCode: 1,
          title: 1,
          description: 1,
          transactionType: 1,
          price: 1,
          priceOnRequest: 1,
          city: 1,
          locality: 1,
          state: 1,
          addressLine: 1,
          pincode: 1,
          'specs.area': 1,
          'specs.bedrooms': 1,
          'specs.bathrooms': 1,
          'specs.parking': 1,
          media: 1,
          amenities: 1,
          status: 1,
          availability: 1,
          publishedAt: 1,
          views: 1,
          enquiries: 1,
          visits: 1,
          verifiedAt: 1,
          projectName: 1,
          builderName: 1,
          'location.coordinates': 1,
        })
        .lean()
    : [];

  // Preserve the favourite ordering (newest first) rather than the
  // arbitrary order from the IN query.
  const byId = new Map(properties.map((p) => [String(p._id), p]));
  const savedAt = new Map(rows.map((r) => [String(r.property), r.createdAt]));
  const items = rows
    .map((r) => byId.get(String(r.property)))
    .filter(Boolean)
    .map((p) => ({ ...p, savedAt: savedAt.get(String(p._id)) }));

  return {
    items,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / take),
  };
};

const realEstatePropertyFavouriteService = {
  savePropertyFavourite,
  removePropertyFavourite,
  isPropertyFavourited,
  listSavedProperties,
};

module.exports = realEstatePropertyFavouriteService;
