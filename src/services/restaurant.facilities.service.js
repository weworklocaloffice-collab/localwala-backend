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
const { RestaurantFacility } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createFacility = async (param) => {
  if (await RestaurantFacility.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const restaurantFacilitiesData = new RestaurantFacility({
    name: param.name,
    translations: param.translations,
    status: true,
  });
  await RestaurantFacility.create(restaurantFacilitiesData);
  return { success: true };
};

const getList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
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
        foreignField: 'restaurantFacility',
        as: 'restaurants',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        status: 1,
        translations: 1,
        restaurants: {
          $size: '$restaurants',
        },
      },
    },
  ];
  const results = await RestaurantFacility.aggregate(query);
  const countResult = await RestaurantFacility.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
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

const getFacilityId = async (id) => {
  return RestaurantFacility.findById(id);
};

const updateFacility = async (id, param) => {
  const facility = await getFacilityId(id);
  if (!facility) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (param.name && (await RestaurantFacility.isNameTaken(param.name, id))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(facility, param);
  await facility.save();
  return { success: true };
};

const deleteFacilityById = async (id) => {
  const facility = await getFacilityId(id);
  if (!facility) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await facility.deleteOne();
  return { success: true };
};

const getFacilitiesListForNewRestaurant = async () => {
  const facility = await RestaurantFacility.find(
    { status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return facility;
};

const getActiveFacilities = async () => {
  const facility = await RestaurantFacility.find(
    { status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return { facility, success: true };
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
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
        foreignField: 'restaurantFacility',
        as: 'restaurants',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        status: 1,
        restaurants: {
          $size: '$restaurants',
        },
      },
    },
  ];
  const results = await RestaurantFacility.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
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
  const results = await RestaurantFacility.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const restaurantFacilitiesData = new RestaurantFacility({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await RestaurantFacility.create(restaurantFacilitiesData);
    });
  }
  return { success: true };
};

module.exports = {
  createFacility,
  getList,
  updateFacility,
  deleteFacilityById,
  getFacilitiesListForNewRestaurant,
  getActiveFacilities,
  exportCollection,
  exportRawCollection,
  importCollection,
};

