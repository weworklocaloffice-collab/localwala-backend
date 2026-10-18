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
const ApiError = require('../utils/ApiError');
const { Transactions, Restaurant } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveTransation = async (transactions) => {
  return Transactions.create(transactions);
};

const getTransactionReport = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? { type: { $in: [options.status] } }
      : { type: { $in: ['deposite', 'withdrawal'] } },
  };
  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

      if (dateRangeArray && checkArrayNotEmpty(dateRangeArray)) {
        const parseDate = (dateStr) => {
          const [day, month, year] = dateStr.trim().split('/');
          return new Date(`${year}-${month}-${day}`);
        };

        const start = parseDate(dateRangeArray[0]);
        const end = parseDate(dateRangeArray[1]);

        const dateRange = {};

        if (start) dateRange.$gte = start;
        if (end) dateRange.$lte = end;

        matchQuery.$match.createdAt = dateRange;
      }
    }
  }
  const name = options.search;
  const query = [
    matchQuery,
    {
      $lookup: {
        from: 'users',
        localField: 'payableId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'users.role': filter ? { $in: [options.role] } : { $nin: ['all'] },
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        uuid: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
          image: { $ifNull: ['$users.image', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const countQuery = [
    matchQuery,
    {
      $lookup: {
        from: 'users',
        localField: 'payableId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'users.role': filter ? { $in: [options.role] } : { $nin: ['all'] },
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
      },
    },
    { $count: 'totalCount' },
  ];
  const results = await Transactions.aggregate(query);
  const resultCount = await Transactions.aggregate(countQuery);
  const totalResults = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;
  return Promise.all([results, totalResults]).then(() => {
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

const customerTransactionList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { payableId: new mongoose.Types.ObjectId(options.user) };
  const query = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        uuid: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
      },
    },
  ];
  const results = await Transactions.aggregate(query);
  const totalResults = await Transactions.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const deliverymanTransactionList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { payableId: new mongoose.Types.ObjectId(options.deliveryman) };
  const query = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        uuid: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
      },
    },
  ];
  const results = await Transactions.aggregate(query);
  const totalResults = await Transactions.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const vendorTransactionList = async (options) => {
  const restaurant = await Restaurant.findById(options.restaurant, { userId: 1 });
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { payableId: new mongoose.Types.ObjectId(restaurant.userId) };
  const query = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        uuid: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        createdAt: 1,
      },
    },
  ];
  const results = await Transactions.aggregate(query);
  const totalResults = await Transactions.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const exportCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? { type: { $in: [options.status] } }
      : { type: { $in: ['deposite', 'withdrawal'] } },
  };
  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

      if (dateRangeArray && checkArrayNotEmpty(dateRangeArray)) {
        const parseDate = (dateStr) => {
          const [day, month, year] = dateStr.trim().split('/');
          return new Date(`${year}-${month}-${day}`);
        };

        const start = parseDate(dateRangeArray[0]);
        const end = parseDate(dateRangeArray[1]);

        const dateRange = {};

        if (start) dateRange.$gte = start;
        if (end) dateRange.$lte = end;

        matchQuery.$match.createdAt = dateRange;
      }
    }
  }
  const name = options.search;
  const query = [
    matchQuery,
    {
      $lookup: {
        from: 'users',
        localField: 'payableId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'wallets',
        localField: 'walletId',
        foreignField: '_id',
        as: 'wallets',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              uuid: 1,
              balance: {
                $round: [{ $divide: ['$balance', 100] }, 2],
              },
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$wallets',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'users.role': filter ? { $in: [options.role] } : { $nin: ['all'] },
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        uuid: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        wallets: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await Transactions.aggregate(query);
  return result;
};

const exportRawCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? { type: { $in: [options.status] } }
      : { type: { $in: ['deposite', 'withdrawal'] } },
  };
  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

      if (dateRangeArray && checkArrayNotEmpty(dateRangeArray)) {
        const parseDate = (dateStr) => {
          const [day, month, year] = dateStr.trim().split('/');
          return new Date(`${year}-${month}-${day}`);
        };

        const start = parseDate(dateRangeArray[0]);
        const end = parseDate(dateRangeArray[1]);

        const dateRange = {};

        if (start) dateRange.$gte = start;
        if (end) dateRange.$lte = end;

        matchQuery.$match.createdAt = dateRange;
      }
    }
  }
  const name = options.search;
  const query = [
    matchQuery,
    {
      $lookup: {
        from: 'users',
        localField: 'payableId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'users.role': filter ? { $in: [options.role] } : { $nin: ['all'] },
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        users: 0,
      },
    },
  ];
  const result = await Transactions.aggregate(query);
  return result;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const transactionData = new Transactions({
        payableId:
          param && param.userId && param.userId !== null && param.userId !== ''
            ? param.userId
            : null,
        walletId:
          param && param.walletId && param.walletId !== null && param.walletId !== ''
            ? param.walletId
            : null,
        type:
          param &&
          param.type &&
          param.type !== null &&
          param.type !== '' &&
          param.type === 'deposite'
            ? 'deposite'
            : 'withdrawal',
        amount:
          param && param.amount && param.amount !== null && param.amount !== '' ? param.amount : 0,
        uuid: param && param.uuid && param.uuid !== null && param.uuid !== '' ? param.uuid : 0,
        meta:
          param && param.notes && param.notes !== null && param.notes !== '' && param.notes !== '-'
            ? [{ reason: param.notes }]
            : [],
        confirmed: param && (param.confirmed === 'Yes' || param.confirmed === 'yes'),
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await Transactions.create(transactionData);
    });
  }
  return { success: true };
};

module.exports = {
  saveTransation,
  getTransactionReport,
  customerTransactionList,
  deliverymanTransactionList,
  vendorTransactionList,
  exportCollection,
  exportRawCollection,
  importCollection,
};

