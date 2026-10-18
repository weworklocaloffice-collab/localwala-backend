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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const { VendorSubCategory } = require('../models');
const ApiError = require('../utils/ApiError');

const createSubCategory = async (param) => {
  await VendorSubCategory.create(param);
  return { success: true };
};

const getAllSubCategory = async (restaurantId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await VendorSubCategory.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurantId),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'vendorcategories',
        localField: 'category',
        foreignField: '_id',
        as: 'vendorcategories',
      },
    },
    {
      $unwind: {
        path: '$vendorcategories',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        status: 1,
        translations: 1,
        category: {
          id: { $ifNull: ['$vendorcategories._id', ''] },
          name: { $ifNull: ['$vendorcategories.name', ''] },
          translations: { $ifNull: ['$vendorcategories.translations', []] },
        },
      },
    },
  ]);
  const totalResults = await VendorSubCategory.countDocuments({
    restaurant: new mongoose.Types.ObjectId(restaurantId),
  });
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
  return VendorSubCategory.findById(id);
};

const updateSubCategoryById = async (subCategoryId, param) => {
  const subCategory = await getSubCategoryId(subCategoryId);
  if (!subCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  Object.assign(subCategory, param);
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

const getActiveByCategoryID = async (cateId, restId) => {
  const subCategory = await VendorSubCategory.find(
    { category: cateId, restaurant: restId },
    { id: 1, name: 1, translations: 1 }
  );
  return subCategory;
};

module.exports = {
  createSubCategory,
  getAllSubCategory,
  getSubCategoryId,
  updateSubCategoryById,
  deleteSubCategoryById,
  getActiveByCategoryID,
};

