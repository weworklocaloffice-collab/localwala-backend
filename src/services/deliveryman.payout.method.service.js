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
const { DeliverymanPayoutMethod } = require('../models');
const ApiError = require('../utils/ApiError');

const savePayoutMethod = async (param) => {
  const haveDefault = await DeliverymanPayoutMethod.findOne({
    isDefault: true,
    deliveryman: new mongoose.Types.ObjectId(param.deliveryman),
  });
  const payoutMethodData = new DeliverymanPayoutMethod({
    method: param.method,
    deliveryman: param.deliveryman,
    formElement: param.formElement,
    isDefault: !haveDefault,
  });
  await DeliverymanPayoutMethod.create(payoutMethodData);
  return { success: true };
};

const getMyPayoutMethodList = async (deliveryman, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const methodQuery = [
    {
      $match: {
        deliveryman: new mongoose.Types.ObjectId(deliveryman),
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
        isDefault: 1,
        status: 1,
        method: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
      },
    },
  ];
  const methods = await DeliverymanPayoutMethod.aggregate(methodQuery);
  const totalResults = await DeliverymanPayoutMethod.countDocuments({
    deliveryman: new mongoose.Types.ObjectId(deliveryman),
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

const deletePayoutMethod = async (deliveryman, payoutId) => {
  const method = await DeliverymanPayoutMethod.findOne({
    deliveryman: new mongoose.Types.ObjectId(deliveryman),
    _id: new mongoose.Types.ObjectId(payoutId),
  });
  if (!method) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await method.deleteOne();
  return { success: true };
};

const getPayoutMethodDetail = async (deliveryman, payoutId) => {
  const methodQuery = [
    {
      $match: {
        deliveryman: new mongoose.Types.ObjectId(deliveryman),
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
  const methodDetail = await DeliverymanPayoutMethod.aggregate(methodQuery);
  if (!methodDetail[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const methodData = methodDetail[0];
  return { methodData, success: true };
};

const updatePayoutMethodDetail = async (deliveryman, payoutId, formElementData) => {
  const method = await DeliverymanPayoutMethod.findOne({
    deliveryman: new mongoose.Types.ObjectId(deliveryman),
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

const changeDefaultPayoutMethod = async (payoutId, deliveryman, isDefault) => {
  if (isDefault === true || isDefault === 'true') {
    await DeliverymanPayoutMethod.updateMany(
      { deliveryman: new mongoose.Types.ObjectId(deliveryman) },
      { $set: { isDefault: false } }
    );
    const method = await DeliverymanPayoutMethod.findById(payoutId);
    if (!method) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
    }
    Object.assign(method, { isDefault: true });
    await method.save();
  } else if (isDefault === false || isDefault === 'false') {
    await DeliverymanPayoutMethod.updateMany(
      { deliveryman: new mongoose.Types.ObjectId(deliveryman) },
      { $set: { isDefault: false } }
    );
    await DeliverymanPayoutMethod.findOneAndUpdate(
      { deliveryman: new mongoose.Types.ObjectId(deliveryman) },
      { $set: { isDefault: true } },
      { sort: { _id: -1 } }
    );
  }
  return { success: true };
};

const deliverymanPayoutAccounts = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { deliveryman: new mongoose.Types.ObjectId(options.deliveryman) };
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
  const methods = await DeliverymanPayoutMethod.aggregate(methodQuery);
  const totalResults = await DeliverymanPayoutMethod.countDocuments(queryCondition);
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
  deliverymanPayoutAccounts,
};

