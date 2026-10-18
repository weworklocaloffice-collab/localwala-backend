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
const { DiningtNotice } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createNotice = async (param) => {
  if (await DiningtNotice.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const diningNoticeData = new DiningtNotice({
    name: param.name,
    translations: param.translations,
    status: true,
  });
  await DiningtNotice.create(diningNoticeData);
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
        status: 1,
        translations: 1,
      },
    },
  ];
  const results = await DiningtNotice.aggregate(query);
  const countResult = await DiningtNotice.aggregate([
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
  return DiningtNotice.findById(id);
};

const updateNotice = async (reasonId, updateBody) => {
  const notice = await getReasonId(reasonId);
  if (!notice) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await DiningtNotice.isNameTaken(updateBody.name, reasonId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(notice, updateBody);
  await notice.save();
  return { success: true };
};

const deleteNoticeById = async (reasonId) => {
  const notice = await getReasonId(reasonId);
  if (!notice) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await notice.deleteOne();
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
  const results = await DiningtNotice.aggregate(query);
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
  const results = await DiningtNotice.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const diningNoticeData = new DiningtNotice({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await DiningtNotice.create(diningNoticeData);
    });
  }
  return { success: true };
};

module.exports = {
  createNotice,
  getList,
  updateNotice,
  deleteNoticeById,
  exportCollection,
  exportRawCollection,
  importCollection,
};

