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
const { RestaurantPayoutMethod } = require('../models');
const ApiError = require('../utils/ApiError');

const savePayoutMethod = async (param) => {
  const haveDefault = await RestaurantPayoutMethod.findOne({
    isDefault: true,
    restaurant: new mongoose.Types.ObjectId(param.restaurant),
  });
  const payoutMethodData = new RestaurantPayoutMethod({
    method: param.method,
    restaurant: param.restaurant,
    formElement: param.formElement,
    isDefault: !haveDefault,
  });
  await RestaurantPayoutMethod.create(payoutMethodData);
  return { success: true };
};

const getMyPayoutMethodList = async (restaurant, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const methodQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurant),
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'method',
        foreignField: '_id',
        as: 'withdrawalmethods',
      },
    },
    {
      $unwind: {
        path: '$withdrawalmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        formElement: 1,
        status: 1,
        isDefault: 1,
        method: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
      },
    },
  ];
  const methods = await RestaurantPayoutMethod.aggregate(methodQuery);
  const totalResults = await RestaurantPayoutMethod.countDocuments({
    restaurant: new mongoose.Types.ObjectId(restaurant),
  });
  return Promise.all([methods, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      methods,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deletePayoutMethod = async (restaurant, payoutId) => {
  const method = await RestaurantPayoutMethod.findOne({
    restaurant: new mongoose.Types.ObjectId(restaurant),
    _id: new mongoose.Types.ObjectId(payoutId),
  });
  if (!method) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await method.deleteOne();
  return { success: true };
};

const getPayoutMethodDetail = async (restaurant, payoutId) => {
  const methodQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurant),
        _id: new mongoose.Types.ObjectId(payoutId),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'method',
        foreignField: '_id',
        as: 'withdrawalmethods',
      },
    },
    {
      $unwind: {
        path: '$withdrawalmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        method: 1,
        formElement: 1,
        methodDetail: {
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          methodFormElement: { $ifNull: ['$withdrawalmethods.formElement', []] },
        },
      },
    },
  ];
  const methodDetail = await RestaurantPayoutMethod.aggregate(methodQuery);
  if (!methodDetail[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const methodData = methodDetail[0];
  return { methodData, success: true };
};

const updatePayoutMethodDetail = async (restaurant, payoutId, formElementData) => {
  const method = await RestaurantPayoutMethod.findOne({
    restaurant: new mongoose.Types.ObjectId(restaurant),
    _id: new mongoose.Types.ObjectId(payoutId),
  });
  if (!method) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateParam = { formElement: formElementData };
  Object.assign(method, updateParam);
  await method.save();
  return { success: true };
};

const changeDefaultPayoutMethod = async (payoutId, restaurant, isDefault) => {
  if (isDefault === true || isDefault === 'true') {
    await RestaurantPayoutMethod.updateMany(
      { restaurant: new mongoose.Types.ObjectId(restaurant) },
      { $set: { isDefault: false } }
    );
    const method = await RestaurantPayoutMethod.findById(payoutId);
    if (!method) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
    }
    Object.assign(method, { isDefault: true });
    await method.save();
  } else if (isDefault === false || isDefault === 'false') {
    await RestaurantPayoutMethod.updateMany(
      { restaurant: new mongoose.Types.ObjectId(restaurant) },
      { $set: { isDefault: false } }
    );
    await RestaurantPayoutMethod.findOneAndUpdate(
      { restaurant: new mongoose.Types.ObjectId(restaurant) },
      { $set: { isDefault: true } },
      { sort: { _id: -1 } }
    );
  }
  return { success: true };
};

const vendorPayoutAccounts = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const methodQuery = [
    { $match: queryCondition },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'method',
        foreignField: '_id',
        as: 'withdrawalmethods',
      },
    },
    {
      $unwind: {
        path: '$withdrawalmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        formElement: 1,
        status: 1,
        method: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
      },
    },
  ];
  const methods = await RestaurantPayoutMethod.aggregate(methodQuery);
  const totalResults = await RestaurantPayoutMethod.countDocuments(queryCondition);
  return Promise.all([methods, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      methods,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

module.exports = {
  savePayoutMethod,
  getMyPayoutMethodList,
  deletePayoutMethod,
  getPayoutMethodDetail,
  updatePayoutMethodDetail,
  changeDefaultPayoutMethod,
  vendorPayoutAccounts,
};

