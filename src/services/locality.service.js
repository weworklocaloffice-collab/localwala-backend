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
const ApiError = require('../utils/ApiError');
const { Locality, User } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const { assertUsablePin, assertPinRanges } = require('../utils/pin.guard');
const geographicService = require('../kernel/geographic/services/geographic.service');

const createLocality = async (param) => {
  if (await Locality.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  assertUsablePin(param.longitude, param.latitude, 'Locality');
  const localityData = new Locality({
    name: param.name,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
    city: param.city,
    translations: param.translations,
  });
  await Locality.create(localityData);
  return { success: true };
};

const createLocalityCityzen = async (masterId, param) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;

  if (await Locality.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  assertUsablePin(param.longitude, param.latitude, 'Locality');
  const localityData = new Locality({
    name: param.name,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
    city: `${city}`,
    translations: param.translations,
  });
  await Locality.create(localityData);
  return { success: true };
};

const getAllLocalitiesAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'restaurants',
        localField: '_id',
        foreignField: 'locality',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        image: 1,
        location: 1,
        slug: 1,
        name: 1,
        status: 1,
        translations: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          slug: { $ifNull: ['$cities.slug', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        restaurants: {
          $size: '$restaurants',
        },
      },
    },
  ];
  const results = await Locality.aggregate(query);
  const countResult = await Locality.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([results, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const getAllLocalitiesCityzen = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ city: new mongoose.Types.ObjectId(city) }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'restaurants',
        localField: '_id',
        foreignField: 'locality',
        as: 'restaurants',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        image: 1,
        location: 1,
        slug: 1,
        name: 1,
        status: 1,
        translations: 1,
        restaurants: {
          $size: '$restaurants',
        },
      },
    },
  ];
  const results = await Locality.aggregate(query);
  const countResult = await Locality.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ city: new mongoose.Types.ObjectId(city) }],
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([results, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const getLocalityId = async (id) => {
  return Locality.findById(id);
};

/**
 * Nearest active locality in a city to a pin (Batch B-1). Powers the
 * Restaurant-app auto-detect: pin captured → dropdown pre-selected.
 *
 * A suggestion, never an error: nothing nearby (or an unusable pin) returns
 * `{ locality: null }` with 200, and the caller falls back to manual select.
 * City-scoped always — a locality name can never resolve across a boundary.
 *
 * @param {object} params { city, latitude, longitude, maxDistanceKm }
 * @returns {Promise<{locality: {id, name} | null, distanceKm: number | null}>}
 */
const getNearestLocality = async ({ city, latitude, longitude, maxDistanceKm = 25 }) => {
  if (!city || !mongoose.Types.ObjectId.isValid(city)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'City is not valid');
  }
  const { longitude: lng, latitude: lat } = assertPinRanges(longitude, latitude, 'Location');
  const cap = Number(maxDistanceKm) > 0 ? Number(maxDistanceKm) : 25;
  const nearest = await Locality.find({
    city: new mongoose.Types.ObjectId(city),
    status: true,
    location: {
      $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: cap * 1000 },
    },
  })
    .limit(1)
    .lean();
  if (!nearest.length) return { locality: null, distanceKm: null };
  const coords = nearest[0].location && nearest[0].location.coordinates;
  const distanceKm =
    Array.isArray(coords) && coords.length >= 2
      ? Number((geographicService.haversineMeters(lng, lat, coords[0], coords[1]) / 1000).toFixed(2))
      : null;
  return { locality: { id: nearest[0]._id, name: nearest[0].name }, distanceKm };
};

const updateLocalityById = async (localityId, param) => {
  const locality = await getLocalityId(localityId);
  if (!locality) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  assertUsablePin(param.longitude, param.latitude, 'Locality');
  const updateBody = {
    name: param.name,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
    city: param.city,
    translations: param.translations,
  };
  Object.assign(locality, updateBody);
  await locality.save();
  return { success: true };
};

const updateCityzenLocalityById = async (localityId, param) => {
  const locality = await getLocalityId(localityId);
  if (!locality) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  assertUsablePin(param.longitude, param.latitude, 'Locality');
  const updateBody = {
    name: param.name,
    location: { type: param.type, coordinates: [param.longitude, param.latitude] },
    translations: param.translations,
  };
  Object.assign(locality, updateBody);
  await locality.save();
  return { success: true };
};

const updateStatus = async (localityId, param) => {
  const locality = await getLocalityId(localityId);
  if (!locality) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    status: param.status,
  };
  Object.assign(locality, updateBody);
  await locality.save();
  return { success: true };
};

const deleteLocalityById = async (localityId) => {
  const locality = await getLocalityId(localityId);
  if (!locality) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await locality.deleteOne();
  return { success: true };
};

const getByCityId = async (cityId) => {
  const locality = await Locality.find(
    { city: cityId, status: true },
    { id: 1, name: 1, location: 1, translations: 1 }
  );
  return locality;
};

const getActiveLocalites = async () => {
  const list = await Locality.find(
    { status: true },
    { id: 1, name: 1, city: 1, location: 1, translations: 1 }
  );
  return list;
};

const getRegisterRequestLocalities = async (id) => {
  const locality = await Locality.find(
    { city: id, status: true },
    { id: 1, name: 1, city: 1, location: 1, translations: 1 }
  );
  return locality;
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'restaurants',
        localField: '_id',
        foreignField: 'locality',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        slug: 1,
        name: 1,
        status: 1,
        city: {
          name: { $ifNull: ['$cities.name', ''] },
        },
        restaurants: {
          $size: '$restaurants',
        },
        location: 1,
      },
    },
  ];
  const results = await Locality.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await Locality.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const longitude =
        param && param.longitude && param.longitude !== null && param.longitude !== ''
          ? param.longitude
          : 0;
      const latitude =
        param && param.latitude && param.latitude !== null && param.latitude !== ''
          ? param.latitude
          : 0;
      const localityData = new Locality({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        location: { type: 'Point', coordinates: [longitude, latitude] },
        city: param && param.city && param.city !== null && param.city !== '' ? param.city : null,
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await Locality.create(localityData);
    });
  }
  return { success: true };
};

module.exports = {
  createLocality,
  createLocalityCityzen,
  getAllLocalitiesAdmin,
  getAllLocalitiesCityzen,
  getLocalityId,
  getNearestLocality,
  updateLocalityById,
  updateCityzenLocalityById,
  deleteLocalityById,
  updateStatus,
  getByCityId,
  getActiveLocalites,
  getRegisterRequestLocalities,
  exportCollection,
  exportRawCollection,
  importCollection,
};

