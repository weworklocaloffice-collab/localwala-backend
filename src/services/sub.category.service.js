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
const { SubCategory } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createSubCategory = async (param) => {
  const categoryData = new SubCategory({
    name: param.name,
    category: param.category,
    translations: param.translations,
    status: true,
  });
  await SubCategory.create(categoryData);
  return { success: true };
};

const getAllSubCategory = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const results = await SubCategory.aggregate([
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
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categories',
      },
    },
    {
      $unwind: {
        path: '$categories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        slug: 1,
        translations: 1,
        status: 1,
        category: {
          id: { $ifNull: ['$categories._id', ''] },
          name: { $ifNull: ['$categories.name', ''] },
          translations: { $ifNull: ['$categories.translations', []] },
        },
      },
    },
  ]);
  const countResult = await SubCategory.aggregate([
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getAllActiveSubCategory = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await SubCategory.aggregate([
    {
      $match: {
        status: true,
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categories',
      },
    },
    {
      $unwind: {
        path: '$categories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        slug: 1,
        translations: 1,
        status: 1,
        category: {
          id: { $ifNull: ['$categories._id', ''] },
          name: { $ifNull: ['$categories.name', ''] },
          translations: { $ifNull: ['$categories.translations', []] },
        },
      },
    },
  ]);
  const totalResults = await SubCategory.countDocuments({ status: true });
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getSubCategoryId = async (id) => {
  return SubCategory.findById(id);
};

const updateSubCategoryById = async (subCategoryId, updateBody) => {
  const subCategory = await getSubCategoryId(subCategoryId);
  if (!subCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await SubCategory.isNameTaken(updateBody.name, subCategoryId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(subCategory, updateBody);
  await subCategory.save();
  return { success: true };
};

const deleteSubCategoryById = async (subCategoryId) => {
  const subCategory = await getSubCategoryId(subCategoryId);
  if (!subCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await subCategory.deleteOne();
  return { success: true };
};

const getActiveByCategoryID = async (id) => {
  const subCategory = await SubCategory.find(
    { category: id, status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return subCategory;
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const results = await SubCategory.aggregate([
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
        from: 'categories',
        localField: 'category',
        foreignField: '_id',
        as: 'categories',
      },
    },
    {
      $unwind: {
        path: '$categories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        slug: 1,
        status: 1,
        category: {
          name: { $ifNull: ['$categories.name', ''] },
        },
      },
    },
  ]);
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
  const results = await SubCategory.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const categoryData = new SubCategory({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        category:
          param && param.category && param.category !== null && param.category !== ''
            ? param.category
            : null,
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await SubCategory.create(categoryData);
    });
  }
  return { success: true };
};

module.exports = {
  createSubCategory,
  getAllSubCategory,
  getSubCategoryId,
  updateSubCategoryById,
  deleteSubCategoryById,
  getActiveByCategoryID,
  getAllActiveSubCategory,
  exportCollection,
  exportRawCollection,
  importCollection,
};

