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
const { VendorCategory } = require('../models');
const ApiError = require('../utils/ApiError');

const createCategory = async (param) => {
  await VendorCategory.create(param);
  return { success: true };
};

const getAllVendorCategoryByRestaurant = async (restaurant, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await VendorCategory.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurant),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        image: 1,
        name: 1,
        restaurant: 1,
        status: 1,
        translations: 1,
      },
    },
  ]);
  const totalResults = await VendorCategory.countDocuments({
    restaurant: new mongoose.Types.ObjectId(restaurant),
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

const getAllList = async (id) => {
  const category = await VendorCategory.find(
    { restaurant: id, status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return category;
};

const getCategoryId = async (id) => {
  return VendorCategory.findById(id);
};

const updateCategoryById = async (categoryId, param) => {
  const category = await getCategoryId(categoryId);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(category, param);
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

module.exports = {
  createCategory,
  getCategoryId,
  updateCategoryById,
  deleteCategoryById,
  getAllList,
  getAllVendorCategoryByRestaurant,
};

