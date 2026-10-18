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
const { ReportIssueRestaurant, SupportChatRoom, User } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveIssue = async (param) => {
  const issueData = new ReportIssueRestaurant({
    user: param && param.user && param.user != null && param.user !== '' ? param.user : null,
    restaurant:
      param && param.restaurant && param.restaurant != null && param.restaurant !== ''
        ? param.restaurant
        : null,
    reason:
      param && param.reason && param.reason != null && param.reason !== '' ? param.reason : null,
    message:
      param && param.message && param.message != null && param.message !== '' ? param.message : '',
  });
  const result = await ReportIssueRestaurant.create(issueData);
  const supportChatParam = {
    userId: new mongoose.Types.ObjectId(param.user),
    supportTeam: [],
    orders: null,
    booking: null,
    purchaseSubscription: null,
    complaints: null,
    restaurantComplaints: null,
    reportIssue: new mongoose.Types.ObjectId(result.id),
    supportType: 'reports',
    lastMessage: '',
    lastMessageType: 'text',
  };
  await SupportChatRoom.create(supportChatParam);
  return { success: true };
};

const getReportsList = async (options) => {
  const filterStatus = !!(options.status === true || options.status === 'true');
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const complaintsQuery = [
    {
      $lookup: {
        from: 'users',
        localField: 'user',
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
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'reportissuerestaurantreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
      },
    },
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$reasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: filterStatus }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        message: 1,
        createdAt: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const reports = await ReportIssueRestaurant.aggregate(complaintsQuery);
  const countResult = await ReportIssueRestaurant.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
      },
    },
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: filterStatus }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $count: 'totalCount' },
  ]);
  return Promise.all([reports, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      reports,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenReportsList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const filterStatus = !!(options.status === true || options.status === 'true');
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const complaintsQuery = [
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
        localField: 'user',
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
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'reportissuerestaurantreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
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
        path: '$reasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: filterStatus }, { 'restaurants.city': new mongoose.Types.ObjectId(city) }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        message: 1,
        createdAt: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const reports = await ReportIssueRestaurant.aggregate(complaintsQuery);
  const resultcount = await ReportIssueRestaurant.aggregate([
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
        localField: 'user',
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
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: filterStatus }, { 'restaurants.city': new mongoose.Types.ObjectId(city) }],
      },
    },
    { $count: 'totalCount' },
  ]);
  const totalResults = checkArrayNotEmpty(resultcount) ? resultcount[0].totalCount : 0;
  return Promise.all([reports, resultcount]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      reports,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const complaintsQuery = [
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'reportissuerestaurantreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
      },
    },
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$reasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: statusName }],
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        message: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
      },
    },
  ];
  const result = await ReportIssueRestaurant.aggregate(complaintsQuery);
  return result;
};

const exportRawCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const results = await ReportIssueRestaurant.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
      },
    },
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ status: statusName }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        users: 0,
        restaurants: 0,
      },
    },
  ]);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const issueData = new ReportIssueRestaurant({
        user: param && param.user && param.user != null && param.user !== '' ? param.user : null,
        restaurant:
          param && param.restaurant && param.restaurant != null && param.restaurant !== ''
            ? param.restaurant
            : null,
        reason:
          param && param.reason && param.reason != null && param.reason !== ''
            ? param.reason
            : null,
        message:
          param && param.message && param.message != null && param.message !== ''
            ? param.message
            : '',
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      const result = await ReportIssueRestaurant.create(issueData);
      const supportChatParam = {
        userId: new mongoose.Types.ObjectId(param.user),
        supportTeam: [],
        orders: null,
        booking: null,
        purchaseSubscription: null,
        complaints: null,
        restaurantComplaints: null,
        reportIssue: new mongoose.Types.ObjectId(result.id),
        supportType: 'reports',
        lastMessage: '',
        lastMessageType: 'text',
      };
      await SupportChatRoom.create(supportChatParam);
    });
  }
  return { success: true };
};

module.exports = {
  saveIssue,
  getReportsList,
  cityzenReportsList,
  exportCollection,
  exportRawCollection,
  importCollection,
};

