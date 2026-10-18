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
const { OrderCancellationReason } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createReason = async (param) => {
  const reasonData = new OrderCancellationReason({
    name: param.name,
    type: param.type,
    translations: param.translations,
    status: true,
  });
  await OrderCancellationReason.create(reasonData);
  return { success: true };
};

const getOrderCancallationListAdmin = async (options) => {
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        status: 1,
        translations: 1,
        type: 1,
      },
    },
  ];
  const results = await OrderCancellationReason.aggregate(query);
  const countResult = await OrderCancellationReason.aggregate([
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

const getReasonId = async (id) => {
  return OrderCancellationReason.findById(id);
};

const updateReason = async (reasonId, updateBody) => {
  const reason = await getReasonId(reasonId);
  if (!reason) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await OrderCancellationReason.isNameTaken(updateBody.name, reasonId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(reason, updateBody);
  await reason.save();
  return { success: true };
};

const deleteReasonById = async (reasonId) => {
  const reason = await getReasonId(reasonId);
  if (!reason) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await reason.deleteOne();
  return { success: true };
};

const getRestaurantCancellationList = async () => {
  const reasonsList = await OrderCancellationReason.find(
    { type: 'restaurant', status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return { reasons: reasonsList };
};

const getDriverCancellationList = async () => {
  const reasonsList = await OrderCancellationReason.find(
    { type: 'driver', status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return { reasons: reasonsList };
};

const getCustomerCancellationList = async () => {
  const reasonsList = await OrderCancellationReason.find(
    { type: 'customer', status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return { reasons: reasonsList };
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        status: 1,
        type: 1,
      },
    },
  ];
  const results = await OrderCancellationReason.aggregate(query);
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
  const results = await OrderCancellationReason.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const reasonData = new OrderCancellationReason({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        type:
          param && param.type && param.type !== null && param.type !== '' ? param.type : 'customer',
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await OrderCancellationReason.create(reasonData);
    });
  }
  return { success: true };
};

module.exports = {
  createReason,
  updateReason,
  deleteReasonById,
  getRestaurantCancellationList,
  getDriverCancellationList,
  getCustomerCancellationList,
  getOrderCancallationListAdmin,
  exportCollection,
  exportRawCollection,
  importCollection,
};

