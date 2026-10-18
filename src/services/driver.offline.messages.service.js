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
const { DriverOfflineMessages } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createOfflineMessage = async (param) => {
  const offlineMessageData = new DriverOfflineMessages({
    name: param.name,
    translations: param.translations,
    status: true,
  });
  await DriverOfflineMessages.create(offlineMessageData);
  return { success: true };
};

const getOfflineMessageListAdmin = async (options) => {
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
        translations: 1,
        status: 1,
      },
    },
  ];
  const results = await DriverOfflineMessages.aggregate(query);
  const countResult = await DriverOfflineMessages.aggregate([
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

const getOfflineMessagesList = async () => {
  const offlines = await DriverOfflineMessages.find({ status: true });
  const totalResults = await DriverOfflineMessages.countDocuments({ status: true });
  return Promise.all([offlines, totalResults]).then(() => {
    const result = {
      offlines,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getOfflineMessagesById = async (id) => {
  return DriverOfflineMessages.findById(id);
};

const updateOfflineMessageById = async (id, updateBody) => {
  const offlineMessages = await getOfflineMessagesById(id);
  if (!offlineMessages) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  Object.assign(offlineMessages, updateBody);
  await offlineMessages.save();
  return { success: true };
};

const deleteOfflineMessageById = async (id) => {
  const offlineMessages = await getOfflineMessagesById(id);
  if (!offlineMessages) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await offlineMessages.deleteOne();
  return { success: true };
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
      },
    },
  ];
  const results = await DriverOfflineMessages.aggregate(query);
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
  const results = await DriverOfflineMessages.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const offlineMessageData = new DriverOfflineMessages({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await DriverOfflineMessages.create(offlineMessageData);
    });
  }
  return { success: true };
};

module.exports = {
  createOfflineMessage,
  getOfflineMessageListAdmin,
  getOfflineMessagesList,
  getOfflineMessagesById,
  updateOfflineMessageById,
  deleteOfflineMessageById,
  exportCollection,
  exportRawCollection,
  importCollection,
};

