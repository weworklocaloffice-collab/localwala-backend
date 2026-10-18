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
const { RestaurantType } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createRestaurantType = async (param) => {
  if (await RestaurantType.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const restaurantTypeData = new RestaurantType({
    name: param.name,
    image: param.image,
    translations: param.translations,
    status: true,
  });
  await RestaurantType.create(restaurantTypeData);
  return { success: true };
};

const getAllRestaurantTypeAdmin = async (options) => {
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
        foreignField: 'restaurantType',
        as: 'restaurants',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        image: 1,
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
  const results = await RestaurantType.aggregate(query);
  const countResult = await RestaurantType.aggregate([
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

const getRestaurantTypeId = async (id) => {
  return RestaurantType.findById(id);
};

const updateRestaurantTypeById = async (id, param) => {
  const restaurantType = await getRestaurantTypeId(id);
  if (!restaurantType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (param.name && (await RestaurantType.isNameTaken(param.name, id))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(restaurantType, param);
  await restaurantType.save();
  return { success: true };
};

const updateStatus = async (id, param) => {
  const restaurantType = await getRestaurantTypeId(id);
  if (!restaurantType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (param.name && (await RestaurantType.isNameTaken(param.name, id))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(restaurantType, param);
  await restaurantType.save();
  return { success: true };
};

const deleteRestaurantTypeById = async (id) => {
  const restaurantType = await getRestaurantTypeId(id);
  if (!restaurantType) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await restaurantType.deleteOne();
  return { success: true };
};

const getRestaurantTypeListForNewRestaurant = async () => {
  const restaurantType = await RestaurantType.find(
    { status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return restaurantType;
};

const getActiveRestaurantType = async () => {
  const restaurantType = await RestaurantType.find(
    { status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return { restaurantType, success: true };
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
        foreignField: 'restaurantType',
        as: 'restaurants',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        image: 1,
        slug: 1,
        name: 1,
        status: 1,
        restaurants: {
          $size: '$restaurants',
        },
      },
    },
  ];
  const results = await RestaurantType.aggregate(query);
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
  const results = await RestaurantType.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const restaurantTypeData = new RestaurantType({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        image:
          param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await RestaurantType.create(restaurantTypeData);
    });
  }
  return { success: true };
};

module.exports = {
  createRestaurantType,
  getAllRestaurantTypeAdmin,
  getRestaurantTypeId,
  updateRestaurantTypeById,
  updateStatus,
  deleteRestaurantTypeById,
  getRestaurantTypeListForNewRestaurant,
  getActiveRestaurantType,
  exportCollection,
  exportRawCollection,
  importCollection,
};

