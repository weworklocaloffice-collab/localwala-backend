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
const { Complaints, RestaurantComplaints, SupportChatRoom, User } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveComplaint = async (params) => {
  const complaints = await Complaints.findOne({ user: params.user, orders: params.orders });
  if (complaints) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already Created');
  }
  const complaintData = new Complaints({
    user: params.user,
    orders: params.orders,
    reason:
      params && params.reason && params.reason !== '' && params.reason !== null
        ? params.reason
        : null,
    title: params.title,
    brief: params.brief,
    proof: params.proof,
    issueWith: params.issueWith,
    restaurant:
      params && params.restaurant && params.restaurant !== '' && params.restaurant !== null
        ? params.restaurant
        : null,
    driver:
      params && params.driver && params.driver !== '' && params.driver !== null
        ? params.driver
        : null,
    product:
      params && params.product && params.product !== '' && params.product !== null
        ? params.product
        : null,
  });
  const result = await Complaints.create(complaintData);
  const supportChatParam = {
    userId: new mongoose.Types.ObjectId(params.user),
    supportTeam: [],
    orders: null,
    booking: null,
    purchaseSubscription: null,
    restaurantComplaints: null,
    complaints: new mongoose.Types.ObjectId(result.id),
    reportIssue: null,
    supportType: 'complaints',
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
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [{ status: filterStatus }],
  };
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
        from: 'complaintsreasons',
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
      },
    },
  ];
  const complaints = await Complaints.aggregate(complaintsQuery);
  const countResult = await Complaints.aggregate([
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
        path: '$users',
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
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
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
        from: 'complaintsreasons',
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
      },
    },
  ];
  const complaints = await Complaints.aggregate(complaintsQuery);
  const countResult = await Complaints.aggregate([
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

const customerComplaintList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const complaintsQuery = [
    { $match: { user: new mongoose.Types.ObjectId(options.user) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
      },
    },
  ];
  const complaints = await Complaints.aggregate(complaintsQuery);
  const totalResults = await Complaints.countDocuments({
    user: new mongoose.Types.ObjectId(options.user),
  });
  return Promise.all([complaints, totalResults]).then(() => {
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

const vendorComplaintList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const orderQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'drivers',
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
        from: 'complaintsreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
      },
    },
    {
      $lookup: {
        from: 'foods',
        localField: 'product',
        foreignField: '_id',
        as: 'foods',
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
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$drivers',
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
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          firstName: { $ifNull: ['$drivers.firstName', ''] },
          lastName: { $ifNull: ['$drivers.lastName', ''] },
          countryCode: { $ifNull: ['$drivers.countryCode', ''] },
          contactNumber: { $ifNull: ['$drivers.contactNumber', ''] },
          role: { $ifNull: ['$drivers.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
        foodInfo: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          image: { $ifNull: ['$foods.image', ''] },
          translations: { $ifNull: ['$foods.translations', []] },
        },
      },
    },
  ];
  const restaurantQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'users',
        localField: 'customer',
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
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'drivers',
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
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
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
        path: '$drivers',
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
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          firstName: { $ifNull: ['$drivers.firstName', ''] },
          lastName: { $ifNull: ['$drivers.lastName', ''] },
          countryCode: { $ifNull: ['$drivers.countryCode', ''] },
          contactNumber: { $ifNull: ['$drivers.contactNumber', ''] },
          role: { $ifNull: ['$drivers.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
      },
    },
  ];
  const orderComplaint = await Complaints.aggregate(orderQuery);
  const totalResultsOrder = await Complaints.countDocuments(queryCondition);

  const restaurantComplaint = await RestaurantComplaints.aggregate(restaurantQuery);
  const totalResultsRestaurant = await RestaurantComplaints.countDocuments(queryCondition);
  return Promise.all([
    orderComplaint,
    totalResultsOrder,
    restaurantComplaint,
    totalResultsRestaurant,
  ]).then(() => {
    const order = {
      orderComplaint,
      totalResultsOrder,
    };
    const restaurant = {
      restaurantComplaint,
      totalResultsRestaurant,
    };
    const result = {
      order,
      restaurant,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorUserOrderComplaintList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const orderQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'drivers',
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
        from: 'complaintsreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
      },
    },
    {
      $lookup: {
        from: 'foods',
        localField: 'product',
        foreignField: '_id',
        as: 'foods',
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
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$drivers',
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
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          firstName: { $ifNull: ['$drivers.firstName', ''] },
          lastName: { $ifNull: ['$drivers.lastName', ''] },
          countryCode: { $ifNull: ['$drivers.countryCode', ''] },
          contactNumber: { $ifNull: ['$drivers.contactNumber', ''] },
          role: { $ifNull: ['$drivers.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
        foodInfo: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          image: { $ifNull: ['$foods.image', ''] },
          translations: { $ifNull: ['$foods.translations', []] },
        },
      },
    },
  ];
  const results = await Complaints.aggregate(orderQuery);
  const totalResults = await Complaints.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorOwnOrderComplaintList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const restaurantQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'users',
        localField: 'customer',
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
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'drivers',
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
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
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
        path: '$drivers',
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
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          firstName: { $ifNull: ['$drivers.firstName', ''] },
          lastName: { $ifNull: ['$drivers.lastName', ''] },
          countryCode: { $ifNull: ['$drivers.countryCode', ''] },
          contactNumber: { $ifNull: ['$drivers.contactNumber', ''] },
          role: { $ifNull: ['$drivers.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
      },
    },
  ];
  const results = await RestaurantComplaints.aggregate(restaurantQuery);
  const totalResults = await RestaurantComplaints.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanComplaintList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { driver: new mongoose.Types.ObjectId(options.deliveryman) };
  const orderQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
      },
    },
  ];
  const restaurantQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'users',
        localField: 'customer',
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
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
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
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
      },
    },
  ];
  const orderComplaint = await Complaints.aggregate(orderQuery);
  const totalResultsOrder = await Complaints.countDocuments(queryCondition);

  const restaurantComplaint = await RestaurantComplaints.aggregate(restaurantQuery);
  const totalResultsRestaurant = await RestaurantComplaints.countDocuments(queryCondition);
  return Promise.all([
    orderComplaint,
    totalResultsOrder,
    restaurantComplaint,
    totalResultsRestaurant,
  ]).then(() => {
    const order = {
      orderComplaint,
      totalResultsOrder,
    };
    const restaurant = {
      restaurantComplaint,
      totalResultsRestaurant,
    };
    const result = {
      order,
      restaurant,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanUserOrderComplaintList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { driver: new mongoose.Types.ObjectId(options.deliveryman) };
  const orderQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
      },
    },
  ];
  const results = await Complaints.aggregate(orderQuery);
  const totalResults = await Complaints.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanRestaurantComplaintList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { driver: new mongoose.Types.ObjectId(options.deliveryman) };
  const restaurantQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'users',
        localField: 'customer',
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
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'ordersDetail',
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
        path: '$ordersDetail',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        brief: 1,
        status: 1,
        createdAt: 1,
        issueWith: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$ordersDetail._id', ''] },
          orderNo: { $ifNull: ['$ordersDetail.orderNo', 0] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
      },
    },
  ];
  const results = await RestaurantComplaints.aggregate(restaurantQuery);
  const totalResults = await RestaurantComplaints.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [{ status: statusName }],
  };
  const query = [
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
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'orders',
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
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'drivers',
      },
    },
    {
      $lookup: {
        from: 'foods',
        localField: 'product',
        foreignField: '_id',
        as: 'foods',
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
        path: '$orders',
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
      $unwind: {
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$foods',
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
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
        },
        restaurantsInfo: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          firstName: { $ifNull: ['$drivers.firstName', ''] },
          lastName: { $ifNull: ['$drivers.lastName', ''] },
        },
        foodInfo: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
        },
      },
    },
  ];
  const results = await Complaints.aggregate(query);
  return results;
};

const exportRawCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }].filter(Boolean),
    $and: [{ status: statusName }],
  };
  const results = await Complaints.aggregate([
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    {
      $project: {
        users: 0,
      },
    },
  ]);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const userId =
        param && param.user && param.user !== null && param.user !== '' ? param.user : null;
      const orderId =
        param && param.orders && param.orders !== null && param.orders !== '' ? param.orders : null;
      const restaurantId =
        param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
          ? param.restaurant
          : null;
      const complaints = await Complaints.findOne({ user: userId, orders: orderId });
      const issueList = ['order', 'restaurant', 'product', 'deliveryman', 'customer'];
      if (
        userId !== null &&
        orderId !== null &&
        restaurantId !== null &&
        complaints === null &&
        issueList.includes(param.issueWith)
      ) {
        const complaintData = new Complaints({
          user: userId,
          orders: orderId,
          reason:
            param && param.reason && param.reason !== null && param.reason !== ''
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
              : 'order',
          restaurant: restaurantId,
          driver:
            param &&
            param.driver &&
            param.driver !== '' &&
            param.driver !== null &&
            param.driver !== '-'
              ? param.driver
              : null,
          product:
            param &&
            param.product &&
            param.product !== '' &&
            param.product !== null &&
            param.product !== '-'
              ? param.product
              : null,
          status: param && (param.status === 'active' || param.status === 'Active'),
        });
        await Complaints.create(complaintData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  saveComplaint,
  getComplaints,
  customerComplaintList,
  vendorComplaintList,
  vendorUserOrderComplaintList,
  vendorOwnOrderComplaintList,
  deliverymanComplaintList,
  deliverymanUserOrderComplaintList,
  deliverymanRestaurantComplaintList,
  cityzenComplaints,
  exportCollection,
  exportRawCollection,
  importCollection,
};

