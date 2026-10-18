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
const { DriverIncentive } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createIncentive = async (param) => {
  const incentiveData = new DriverIncentive({
    orderTotal:
      param && param.orderTotal && param.orderTotal !== null && param.orderTotal !== ''
        ? param.orderTotal
        : 0,
    incentiveAmount:
      param &&
      param.incentiveAmount &&
      param.incentiveAmount !== null &&
      param.incentiveAmount !== ''
        ? param.incentiveAmount
        : 0,
  });
  await DriverIncentive.create(incentiveData);
  return { success: true };
};

const getIncentiveById = async (id) => {
  const incentive = await DriverIncentive.findById(id);
  return incentive;
};

const getIncentiveListAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const numericSearch = Number(options.search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  let orderTotalQuery = 0;
  if (isNumericSearch && options.search !== null && options.search !== '') {
    const searchCents = Math.round((+numericSearch + Number.EPSILON) * 100);
    orderTotalQuery = searchCents;
  }
  let incentiveAmountQuery = 0;
  if (isNumericSearch && options.search !== null && options.search !== '') {
    const searchCents = Math.round((+numericSearch + Number.EPSILON) * 100);
    incentiveAmountQuery = searchCents;
  }
  const orderMatch = {
    $or: [
      orderTotalQuery !== 0 ? { orderTotal: orderTotalQuery } : null,
      incentiveAmountQuery !== 0 ? { incentiveAmount: incentiveAmountQuery } : null,
    ].filter(Boolean),
  };
  const query = [
    {
      $match: orderTotalQuery !== 0 || incentiveAmountQuery !== 0 ? orderMatch : {},
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderTotal: {
          $round: [{ $divide: ['$orderTotal', 100] }, 2],
        },
        incentiveAmount: {
          $round: [{ $divide: ['$incentiveAmount', 100] }, 2],
        },
        status: 1,
      },
    },
  ];
  const results = await DriverIncentive.aggregate(query);
  const countResult = await DriverIncentive.aggregate([
    { $match: orderTotalQuery !== 0 || incentiveAmountQuery !== 0 ? orderMatch : {} },
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

const updateStatus = async (incentiveId, updateBody) => {
  const incentive = await getIncentiveById(incentiveId);
  if (!incentive) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(incentive, updateBody);
  await incentive.save();
  return { success: true };
};

const updateIncentiveById = async (incentiveId, incentiveBody) => {
  const incentive = await getIncentiveById(incentiveId);
  if (!incentive) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const incentiveData = {
    orderTotal:
      incentiveBody &&
      incentiveBody.orderTotal &&
      incentiveBody.orderTotal !== null &&
      incentiveBody.orderTotal !== ''
        ? incentiveBody.orderTotal
        : 0,
    incentiveAmount:
      incentiveBody &&
      incentiveBody.incentiveAmount &&
      incentiveBody.incentiveAmount !== null &&
      incentiveBody.incentiveAmount !== ''
        ? incentiveBody.incentiveAmount
        : 0,
  };
  Object.assign(incentive, incentiveData);
  await incentive.save();
  return { success: true };
};

const deleteIncentiveById = async (incentiveId) => {
  const incentive = await getIncentiveById(incentiveId);
  if (!incentive) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await incentive.deleteOne();
  return { success: true };
};

const exportCollection = async (search) => {
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  let orderTotalQuery = 0;
  if (isNumericSearch && search !== null && search !== '') {
    const searchCents = Math.round((+numericSearch + Number.EPSILON) * 100);
    orderTotalQuery = searchCents;
  }
  let incentiveAmountQuery = 0;
  if (isNumericSearch && search !== null && search !== '') {
    const searchCents = Math.round((+numericSearch + Number.EPSILON) * 100);
    incentiveAmountQuery = searchCents;
  }
  const orderMatch = {
    $or: [
      orderTotalQuery !== 0 ? { orderTotal: orderTotalQuery } : null,
      incentiveAmountQuery !== 0 ? { incentiveAmount: incentiveAmountQuery } : null,
    ].filter(Boolean),
  };
  const query = [
    {
      $match: orderTotalQuery !== 0 || incentiveAmountQuery !== 0 ? orderMatch : {},
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderTotal: {
          $round: [{ $divide: ['$orderTotal', 100] }, 2],
        },
        incentiveAmount: {
          $round: [{ $divide: ['$incentiveAmount', 100] }, 2],
        },
        status: 1,
      },
    },
  ];
  const results = await DriverIncentive.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  let orderTotalQuery = 0;
  if (isNumericSearch && search !== null && search !== '') {
    const searchCents = Math.round((+numericSearch + Number.EPSILON) * 100);
    orderTotalQuery = searchCents;
  }
  let incentiveAmountQuery = 0;
  if (isNumericSearch && search !== null && search !== '') {
    const searchCents = Math.round((+numericSearch + Number.EPSILON) * 100);
    incentiveAmountQuery = searchCents;
  }
  const orderMatch = {
    $or: [
      orderTotalQuery !== 0 ? { orderTotal: orderTotalQuery } : null,
      incentiveAmountQuery !== 0 ? { incentiveAmount: incentiveAmountQuery } : null,
    ].filter(Boolean),
  };
  const query = [
    {
      $match: orderTotalQuery !== 0 || incentiveAmountQuery !== 0 ? orderMatch : {},
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await DriverIncentive.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const incentiveData = new DriverIncentive({
        orderTotal:
          param && param.orderTotal && param.orderTotal !== null && param.orderTotal !== ''
            ? param.orderTotal
            : 0,
        incentiveAmount:
          param &&
          param.incentiveAmount &&
          param.incentiveAmount !== null &&
          param.incentiveAmount !== ''
            ? param.incentiveAmount
            : 0,
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await DriverIncentive.create(incentiveData);
    });
  }
  return { success: true };
};

module.exports = {
  createIncentive,
  getIncentiveById,
  getIncentiveListAdmin,
  updateStatus,
  updateIncentiveById,
  deleteIncentiveById,
  exportCollection,
  exportRawCollection,
  importCollection,
};

