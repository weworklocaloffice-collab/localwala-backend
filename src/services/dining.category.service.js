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
const { DiningCategory } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createCategory = async (param) => {
  if (await DiningCategory.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const diningCategoryData = new DiningCategory({
    name: param.name,
    image: param.image,
    translations: param.translations,
    status: true,
  });
  await DiningCategory.create(diningCategoryData);
  return { success: true };
};

const getAllCategoryAdmin = async (options) => {
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
        foreignField: 'diningCategory',
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
  const results = await DiningCategory.aggregate(query);
  const countResult = await DiningCategory.aggregate([
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

const getCategoryId = async (id) => {
  return DiningCategory.findById(id);
};

const updateCategoryById = async (categoryId, updateBody) => {
  const category = await getCategoryId(categoryId);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await DiningCategory.isNameTaken(updateBody.name, categoryId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(category, updateBody);
  await category.save();
  return { success: true };
};

const deleteCategoryById = async (categoryId) => {
  const category = await getCategoryId(categoryId);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await category.deleteOne();
  return { success: true };
};

const getDiningCategoriesListForVendor = async () => {
  const result = await DiningCategory.find(
    { status: 1 },
    { id: 1, name: 1, image: 1, translations: 1 }
  );
  return result;
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
        foreignField: 'diningCategory',
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
  const results = await DiningCategory.aggregate(query);
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
  const results = await DiningCategory.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const diningCategoryData = new DiningCategory({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        image:
          param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await DiningCategory.create(diningCategoryData);
    });
  }
  return { success: true };
};

module.exports = {
  createCategory,
  getAllCategoryAdmin,
  updateCategoryById,
  deleteCategoryById,
  getDiningCategoriesListForVendor,
  exportCollection,
  exportRawCollection,
  importCollection,
};

