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
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const { CollectCash, User } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const getCollectionList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const orderMatch = options.search
    ? {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          { 'restaurants.slug': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ].filter(Boolean),
      }
    : {};
  const query = [
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        from: 1,
        method: 1,
        reference: 1,
        cashCollected: {
          $round: [{ $divide: ['$cashCollected', 100] }, 2],
        },
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await CollectCash.aggregate(query);
  const countResult = await CollectCash.aggregate([
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: orderMatch,
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

const cityzenCollectionList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const orderMatch = options.search
    ? {
        $and: [
          {
            $or: [
              { 'users.firstName': searchRegExp },
              { 'users.lastName': searchRegExp },
              { 'restaurants.name': searchRegExp },
              { 'restaurants.slug': searchRegExp },
              {
                'restaurants.translations': {
                  $elemMatch: {
                    title: { $regex: searchRegExp },
                  },
                },
              },
            ].filter(Boolean),
          },
          {
            $or: [
              { 'restaurants.city': new mongoose.Types.ObjectId(city) },
              { 'users.city': new mongoose.Types.ObjectId(city) },
            ],
          },
        ],
      }
    : {};
  const query = [
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
              contactEmail: {
                $concat: [
                  { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
                  'xxxx@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        from: 1,
        method: 1,
        reference: 1,
        cashCollected: {
          $round: [{ $divide: ['$cashCollected', 100] }, 2],
        },
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await CollectCash.aggregate(query);
  const countResult = await CollectCash.aggregate([
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: orderMatch,
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

const vendorCollectedCashList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = {
    from: 'restaurant',
    restaurant: new mongoose.Types.ObjectId(options.restaurant),
  };
  const query = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        method: 1,
        reference: 1,
        cashCollected: {
          $round: [{ $divide: ['$cashCollected', 100] }, 2],
        },
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        createdAt: 1,
      },
    },
  ];
  const results = await CollectCash.aggregate(query);
  const totalResults = await CollectCash.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const deliverymanCollectedCashList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = {
    from: 'deliveryman',
    deliveryman: new mongoose.Types.ObjectId(options.deliveryman),
  };
  const query = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        method: 1,
        reference: 1,
        cashCollected: {
          $round: [{ $divide: ['$cashCollected', 100] }, 2],
        },
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        createdAt: 1,
      },
    },
  ];
  const results = await CollectCash.aggregate(query);
  const totalResults = await CollectCash.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const orderMatch = search
    ? {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          { 'restaurants.slug': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ].filter(Boolean),
      }
    : {};
  const query = [
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        from: 1,
        method: 1,
        reference: 1,
        cashCollected: {
          $round: [{ $divide: ['$cashCollected', 100] }, 2],
        },
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await CollectCash.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const orderMatch = search
    ? {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          { 'restaurants.slug': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ].filter(Boolean),
      }
    : {};
  const results = await CollectCash.aggregate([
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'deliveryman',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: orderMatch,
    },
  ]);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const complaintData = new CollectCash({
        from:
          param &&
          param.from &&
          param.from !== null &&
          param.from !== '' &&
          param.from === 'deliveryman'
            ? 'deliveryman'
            : 'restaurant',
        deliveryman:
          param &&
          param.deliveryman &&
          param.deliveryman !== null &&
          param.deliveryman !== '' &&
          param.deliveryman !== '-'
            ? param.deliveryman
            : null,
        restaurant:
          param &&
          param.restaurant &&
          param.restaurant !== null &&
          param.restaurant !== '' &&
          param.restaurant !== '-'
            ? param.restaurant
            : null,
        cashCollected:
          param && param.cashCollected && param.cashCollected !== null && param.cashCollected !== ''
            ? param.cashCollected
            : 0,
        walletAmount:
          param && param.walletAmount && param.walletAmount !== null && param.walletAmount !== ''
            ? param.walletAmount
            : 0,
        method:
          param && param.method && param.method !== null && param.method !== ''
            ? param.method
            : 'NA',
        reference:
          param && param.reference && param.reference !== null && param.reference !== ''
            ? param.reference
            : 'NA',
        status: true,
      });
      await CollectCash.create(complaintData);
    });
  }
  return { success: true };
};

module.exports = {
  getCollectionList,
  vendorCollectedCashList,
  deliverymanCollectedCashList,
  cityzenCollectionList,
  exportCollection,
  exportRawCollection,
  importCollection,
};

