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
const { DeliveryShiftSchedule } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createSchedule = async (param) => {
  const deliveryShiftScheduleData = new DeliveryShiftSchedule({
    name: param.name,
    startTime: param.startTime,
    endTime: param.endTime,
    extraEarningPercentage: param.extraEarningPercentage,
    status: true,
  });
  await DeliveryShiftSchedule.create(deliveryShiftScheduleData);
  return { success: true };
};

const getShiftListAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [{ name: searchRegExp }],
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
        startTime: 1,
        startTime12: {
          $let: {
            vars: {
              hour: { $toInt: { $arrayElemAt: [{ $split: ['$startTime', ':'] }, 0] } },
              minute: { $arrayElemAt: [{ $split: ['$startTime', ':'] }, 1] },
            },
            in: {
              $concat: [
                {
                  $toString: {
                    $cond: {
                      if: { $lte: ['$$hour', 12] },
                      then: { $cond: { if: { $eq: ['$$hour', 0] }, then: 12, else: '$$hour' } },
                      else: { $subtract: ['$$hour', 12] },
                    },
                  },
                },
                ':',
                '$$minute',
                ' ',
                {
                  $cond: { if: { $lt: ['$$hour', 12] }, then: 'AM', else: 'PM' },
                },
              ],
            },
          },
        },
        endTime: 1,
        endTime12: {
          $let: {
            vars: {
              hour: { $toInt: { $arrayElemAt: [{ $split: ['$endTime', ':'] }, 0] } },
              minute: { $arrayElemAt: [{ $split: ['$endTime', ':'] }, 1] },
            },
            in: {
              $concat: [
                {
                  $toString: {
                    $cond: {
                      if: { $lte: ['$$hour', 12] },
                      then: { $cond: { if: { $eq: ['$$hour', 0] }, then: 12, else: '$$hour' } },
                      else: { $subtract: ['$$hour', 12] },
                    },
                  },
                },
                ':',
                '$$minute',
                ' ',
                {
                  $cond: { if: { $lt: ['$$hour', 12] }, then: 'AM', else: 'PM' },
                },
              ],
            },
          },
        },
        extraEarningPercentage: {
          $round: [{ $divide: ['$extraEarningPercentage', 100] }, 2],
        },
        status: 1,
      },
    },
  ];
  const results = await DeliveryShiftSchedule.aggregate(query);
  const countResult = await DeliveryShiftSchedule.aggregate([
    {
      $match: {
        $or: [{ name: searchRegExp }],
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

const getShiftById = async (id) => {
  return DeliveryShiftSchedule.findById(id);
};

const update = async (id, param) => {
  const shift = await getShiftById(id);
  if (!shift) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(shift, param);
  await shift.save();
  return { success: true };
};

const deleteShift = async (id) => {
  const shift = await getShiftById(id);
  if (!shift) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await shift.deleteOne();
  return { success: true };
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ name: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        startTime12: {
          $let: {
            vars: {
              hour: { $toInt: { $arrayElemAt: [{ $split: ['$startTime', ':'] }, 0] } },
              minute: { $arrayElemAt: [{ $split: ['$startTime', ':'] }, 1] },
            },
            in: {
              $concat: [
                {
                  $toString: {
                    $cond: {
                      if: { $lte: ['$$hour', 12] },
                      then: { $cond: { if: { $eq: ['$$hour', 0] }, then: 12, else: '$$hour' } },
                      else: { $subtract: ['$$hour', 12] },
                    },
                  },
                },
                ':',
                '$$minute',
                ' ',
                {
                  $cond: { if: { $lt: ['$$hour', 12] }, then: 'AM', else: 'PM' },
                },
              ],
            },
          },
        },
        endTime12: {
          $let: {
            vars: {
              hour: { $toInt: { $arrayElemAt: [{ $split: ['$endTime', ':'] }, 0] } },
              minute: { $arrayElemAt: [{ $split: ['$endTime', ':'] }, 1] },
            },
            in: {
              $concat: [
                {
                  $toString: {
                    $cond: {
                      if: { $lte: ['$$hour', 12] },
                      then: { $cond: { if: { $eq: ['$$hour', 0] }, then: 12, else: '$$hour' } },
                      else: { $subtract: ['$$hour', 12] },
                    },
                  },
                },
                ':',
                '$$minute',
                ' ',
                {
                  $cond: { if: { $lt: ['$$hour', 12] }, then: 'AM', else: 'PM' },
                },
              ],
            },
          },
        },
        extraEarningPercentage: {
          $round: [{ $divide: ['$extraEarningPercentage', 100] }, 2],
        },
        status: 1,
      },
    },
  ];
  const results = await DeliveryShiftSchedule.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ name: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await DeliveryShiftSchedule.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const deliveryShiftScheduleData = new DeliveryShiftSchedule({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        startTime:
          param && param.startTime && param.startTime !== null && param.startTime !== ''
            ? param.startTime
            : '00:00',
        endTime:
          param && param.endTime && param.endTime !== null && param.endTime !== ''
            ? param.endTime
            : '00:00',
        extraEarningPercentage:
          param &&
          param.extraEarningPercentage &&
          param.extraEarningPercentage !== null &&
          param.extraEarningPercentage !== ''
            ? param.extraEarningPercentage
            : 0,
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await DeliveryShiftSchedule.create(deliveryShiftScheduleData);
    });
  }
  return { success: true };
};

module.exports = {
  createSchedule,
  getShiftListAdmin,
  update,
  deleteShift,
  exportCollection,
  exportRawCollection,
  importCollection,
};

