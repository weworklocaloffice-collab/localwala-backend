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
const { DiningCancellationReason } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createReason = async (param) => {
  if (await DiningCancellationReason.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const diningCancellationData = new DiningCancellationReason({
    name: param.name,
    type: param.type,
    translations: param.translations,
    status: true,
  });
  await DiningCancellationReason.create(diningCancellationData);
  return { success: true };
};

const getDiningCancallationListAdmin = async (options) => {
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
  const results = await DiningCancellationReason.aggregate(query);
  const countResult = await DiningCancellationReason.aggregate([
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
  return DiningCancellationReason.findById(id);
};

const updateReason = async (reasonId, param) => {
  const reason = await getReasonId(reasonId);
  if (!reason) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (param.name && (await DiningCancellationReason.isNameTaken(param.name, reasonId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(reason, param);
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

const getCustomerCancellationList = async () => {
  const reasonsList = await DiningCancellationReason.find(
    { type: 'customer', status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return { reasons: reasonsList };
};

const getRestaurantCancellationList = async () => {
  const reasonsList = await DiningCancellationReason.find(
    { type: 'restaurant', status: true },
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
  const results = await DiningCancellationReason.aggregate(query);
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
  const results = await DiningCancellationReason.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const diningCancellationData = new DiningCancellationReason({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        type:
          param && param.type && param.type !== null && param.type !== '' ? param.type : 'customer',
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await DiningCancellationReason.create(diningCancellationData);
    });
  }
  return { success: true };
};

module.exports = {
  createReason,
  updateReason,
  deleteReasonById,
  getDiningCancallationListAdmin,
  getCustomerCancellationList,
  getRestaurantCancellationList,
  exportCollection,
  exportRawCollection,
  importCollection,
};

