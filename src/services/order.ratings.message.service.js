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
const { OrderRatingMessages } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createMessage = async (param) => {
  const ratingData = new OrderRatingMessages({
    name: param.name,
    type: param.type,
    rateNumber: param.rateNumber,
    translations: param.translations,
    status: true,
  });
  await OrderRatingMessages.create(ratingData);
  return { success: true };
};

const getOrderRatingListAdmin = async (options) => {
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
        rateNumber: 1,
        status: 1,
        translations: 1,
        type: 1,
      },
    },
  ];
  const results = await OrderRatingMessages.aggregate(query);
  const countResult = await OrderRatingMessages.aggregate([
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

const getMessageId = async (id) => {
  return OrderRatingMessages.findById(id);
};

const updateMessage = async (reasonId, updateBody) => {
  const message = await getMessageId(reasonId);
  if (!message) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(message, updateBody);
  await message.save();
  return { success: true };
};

const deleteMessageById = async (reasonId) => {
  const message = await getMessageId(reasonId);
  if (!message) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await message.deleteOne();
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
        rateNumber: 1,
        status: 1,
        type: 1,
      },
    },
  ];
  const results = await OrderRatingMessages.aggregate(query);
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
  const results = await OrderRatingMessages.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const ratingData = new OrderRatingMessages({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        type:
          param && param.type && param.type !== null && param.type !== '' ? param.type : 'customer',
        rateNumber:
          param && param.rateNumber && param.rateNumber !== null && param.rateNumber !== ''
            ? param.rateNumber
            : 1,
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await OrderRatingMessages.create(ratingData);
    });
  }
  return { success: true };
};

module.exports = {
  createMessage,
  updateMessage,
  deleteMessageById,
  getOrderRatingListAdmin,
  exportCollection,
  exportRawCollection,
  importCollection,
};

