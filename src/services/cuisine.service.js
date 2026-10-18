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
const { Cuisine } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createCuisine = async (param) => {
  if (await Cuisine.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const cuisineData = new Cuisine({
    name: param.name,
    image: param.image,
    translations: param.translations,
    status: true,
  });
  await Cuisine.create(cuisineData);
  return { success: true };
};

const getAllCuisinesAdmin = async (options) => {
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
        foreignField: 'cuisine',
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
  const results = await Cuisine.aggregate(query);
  const countResult = await Cuisine.aggregate([
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

const listAllCusisines = async () => {
  const cuisine = await Cuisine.find({});
  return cuisine;
};

const getCuisineListForNewRestaurant = async () => {
  const cuisine = await Cuisine.find({ status: true }, { id: 1, name: 1, translations: 1 });
  return cuisine;
};

const getActiveCuisine = async () => {
  const cuisine = await Cuisine.find({ status: true }, { id: 1, name: 1, translations: 1 });
  return { cuisine, success: true };
};

const getCuisineId = async (id) => {
  return Cuisine.findById(id);
};

const updateCuisineById = async (cuisineId, param) => {
  const cuisine = await getCuisineId(cuisineId);
  if (!cuisine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (param.name && (await Cuisine.isNameTaken(param.name, cuisineId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(cuisine, param);
  await cuisine.save();
  return { success: true };
};

const updateStatus = async (cuisineId, param) => {
  const cuisine = await getCuisineId(cuisineId);
  if (!cuisine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (param.name && (await Cuisine.isNameTaken(param.name, cuisineId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(cuisine, param);
  await cuisine.save();
  return { success: true };
};

const deleteCuisineById = async (cuisineId) => {
  const cuisine = await getCuisineId(cuisineId);
  if (!cuisine) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await cuisine.deleteOne();
  return { success: true };
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
        foreignField: 'cuisine',
        as: 'restaurants',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        slug: 1,
        name: 1,
        image: 1,
        status: 1,
        restaurants: {
          $size: '$restaurants',
        },
      },
    },
  ];
  const results = await Cuisine.aggregate(query);
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
  const results = await Cuisine.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const cuisineData = new Cuisine({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        image:
          param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await Cuisine.create(cuisineData);
    });
  }
  return { success: true };
};

module.exports = {
  createCuisine,
  getAllCuisinesAdmin,
  getCuisineId,
  updateCuisineById,
  deleteCuisineById,
  updateStatus,
  listAllCusisines,
  getCuisineListForNewRestaurant,
  getActiveCuisine,
  exportCollection,
  exportRawCollection,
  importCollection,
};

