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
const { UserDeleteAccountReason } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createReason = async (param) => {
  if (await UserDeleteAccountReason.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const deleteReasonData = new UserDeleteAccountReason({
    name: param.name,
    kind: param.kind,
    translations: param.translations,
    status: true,
  });
  await UserDeleteAccountReason.create(deleteReasonData);
  return { success: true };
};

const getList = async (options) => {
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
        kind: 1,
        status: 1,
        translations: 1,
      },
    },
  ];
  const results = await UserDeleteAccountReason.aggregate(query);
  const countResult = await UserDeleteAccountReason.aggregate([
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
  return UserDeleteAccountReason.findById(id);
};

const updateReason = async (reasonId, updateBody) => {
  const reason = await getReasonId(reasonId);
  if (!reason) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await UserDeleteAccountReason.isNameTaken(updateBody.name, reasonId))) {
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

const getUserActiveReason = async () => {
  const result = await UserDeleteAccountReason.find(
    { status: true, kind: 'user' },
    { id: 1, name: 1, translations: 1 }
  );
  return { result, success: true };
};

const geRestaurantActiveReason = async () => {
  const result = await UserDeleteAccountReason.find(
    { status: true, kind: 'vendor' },
    { id: 1, name: 1, translations: 1 }
  );
  return { result, success: true };
};

const geDeliverymanActiveReason = async () => {
  const result = await UserDeleteAccountReason.find(
    { status: true, kind: 'driver' },
    { id: 1, name: 1, translations: 1 }
  );
  return { result, success: true };
};

const geWaiterActiveReason = async () => {
  const result = await UserDeleteAccountReason.find(
    { status: true, kind: 'waiter' },
    { id: 1, name: 1, translations: 1 }
  );
  return { result, success: true };
};

const getKitchenActionReason = async () => {
  const result = await UserDeleteAccountReason.find(
    { status: true, kind: 'kitchen' },
    { id: 1, name: 1, translations: 1 }
  );
  return { result, success: true };
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
        kind: 1,
        status: 1,
      },
    },
  ];
  const results = await UserDeleteAccountReason.aggregate(query);
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
  const results = await UserDeleteAccountReason.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const deleteReasonData = new UserDeleteAccountReason({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        kind: param && param.kind && param.kind !== null && param.kind !== '' ? param.kind : 'user',
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await UserDeleteAccountReason.create(deleteReasonData);
    });
  }
  return { success: true };
};

module.exports = {
  createReason,
  getList,
  updateReason,
  deleteReasonById,
  getUserActiveReason,
  geRestaurantActiveReason,
  geDeliverymanActiveReason,
  geWaiterActiveReason,
  getKitchenActionReason,
  exportCollection,
  exportRawCollection,
  importCollection,
};

