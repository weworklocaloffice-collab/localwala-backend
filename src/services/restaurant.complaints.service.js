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
const { RestaurantComplaints, User, SupportChatRoom } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveComplaint = async (params) => {
  const complaints = await RestaurantComplaints.findOne({
    orders: params.orders,
    restaurant: params.restaurant,
  });
  if (complaints) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already Created');
  }
  const complaintData = new RestaurantComplaints({
    restaurant:
      params && params.restaurant && params.restaurant !== '' && params.restaurant !== null
        ? params.restaurant
        : null,
    customer:
      params && params.customer && params.customer !== '' && params.customer !== null
        ? params.customer
        : null,
    orders: params.orders,
    reason:
      params && params.reason && params.reason !== '' && params.reason !== null
        ? params.reason
        : null,
    title: params.title,
    brief: params.brief,
    proof: params.proof,
    issueWith: params.issueWith,
    driver:
      params && params.driver && params.driver !== '' && params.driver !== null
        ? params.driver
        : null,
  });
  const result = await RestaurantComplaints.create(complaintData);
  const supportChatParam = {
    userId: new mongoose.Types.ObjectId(params.user),
    supportTeam: [],
    orders: null,
    booking: null,
    purchaseSubscription: null,
    restaurantComplaints: new mongoose.Types.ObjectId(result.id),
    complaints: null,
    reportIssue: null,
    supportType: 'restaurant_complaints',
    lastMessage: '',
    lastMessageType: 'text',
  };
  await SupportChatRoom.create(supportChatParam);
  return { success: true };
};

const getComplaints = async (options) => {
  const filterStatus = !!(options.status === true || options.status === 'true');
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [
      { 'restaurants.name': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: [{ status: filterStatus }],
  };
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
      $lookup: {
        from: 'complaintsreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
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
        path: '$reasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        restaurantInfo: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
      },
    },
  ];
  const complaints = await RestaurantComplaints.aggregate(complaintsQuery);
  const countResult = await RestaurantComplaints.aggregate([
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
      $match: matchQuery,
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([complaints, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      complaints,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenComplaints = async (masterId, options) => {
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
  const matchQuery = {
    $or: [
      { 'restaurants.name': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: [{ status: filterStatus }, { 'restaurants.city': new mongoose.Types.ObjectId(city) }],
  };
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
      $lookup: {
        from: 'complaintsreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
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
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        restaurantInfo: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
      },
    },
  ];
  const complaints = await RestaurantComplaints.aggregate(complaintsQuery);
  const countResult = await RestaurantComplaints.aggregate([
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
      $match: matchQuery,
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([complaints, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      complaints,
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
  const matchQuery = {
    $or: [
      { 'restaurants.name': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: [{ status: statusName }],
  };
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
        from: 'complaintsreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'customer',
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
        path: '$reasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$driver',
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
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        proof: 1,
        restaurantInfo: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
        },
      },
    },
  ];
  const results = await RestaurantComplaints.aggregate(query);
  return results;
};

const exportRawCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [
      { 'restaurants.name': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: [{ status: statusName }],
  };
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
      $match: matchQuery,
    },
    {
      $project: {
        restaurants: 0,
      },
    },
  ];
  const results = await RestaurantComplaints.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const restaurantId =
        param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
          ? param.restaurant
          : null;
      const orderId =
        param && param.orders && param.orders !== null && param.orders !== '' ? param.orders : null;
      const issueList = ['deliveryman', 'customer'];
      const complaints = await RestaurantComplaints.findOne({
        orders: orderId,
        restaurant: restaurantId,
      });
      if (
        restaurantId !== null &&
        orderId !== null &&
        complaints === null &&
        issueList.includes(param.issueWith)
      ) {
        const complaintData = new RestaurantComplaints({
          restaurant: restaurantId,
          customer:
            param &&
            param.customer &&
            param.customer !== '' &&
            param.customer !== null &&
            param.customer !== '-'
              ? param.customer
              : null,
          orders: orderId,
          reason:
            param && param.reason && param.reason !== '' && param.reason !== null
              ? param.reason
              : null,
          title:
            param && param.title && param.title !== null && param.title !== '' ? param.title : 'NA',
          brief:
            param && param.brief && param.brief !== null && param.brief !== '' ? param.brief : 'NA',
          proof:
            param &&
            param.proof &&
            param.proof !== null &&
            param.proof !== '' &&
            param.proof !== '-'
              ? param.proof.split(',')
              : [],
          issueWith:
            param &&
            param.issueWith &&
            param.issueWith &&
            param.issueWith !== null &&
            param.issueWith !== ''
              ? param.issueWith
              : 'customer',
          driver:
            param &&
            param.driver &&
            param.driver !== '' &&
            param.driver !== null &&
            param.driver !== '-'
              ? param.driver
              : null,
          status: param && (param.status === 'active' || param.status === 'Active'),
        });
        await RestaurantComplaints.create(complaintData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  saveComplaint,
  getComplaints,
  cityzenComplaints,
  exportCollection,
  exportRawCollection,
  importCollection,
};

