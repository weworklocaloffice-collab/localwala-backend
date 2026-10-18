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
const { KitchenOwner, User, KitchenOrder, Restaurant, Wallet } = require('../models');
const fcmNotificationService = require('./fcm.notification.service');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createKitchenOwner = async (param) => {
  const ownerData = new KitchenOwner({
    userId: param.userId,
    restaurant: param && param.restaurant !== '' ? param.restaurant : null,
  });
  return KitchenOwner.create(ownerData);
};

const getAllVendorKitchenOwner = async (restaurantId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await KitchenOwner.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurantId),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        ownerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
      },
    },
  ]);
  const totalResults = await KitchenOwner.countDocuments({
    restaurant: new mongoose.Types.ObjectId(restaurantId),
  });
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getById = async (id) => {
  const owner = await KitchenOwner.findById(id);
  if (!owner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const userInfo = await User.findById(owner.userId, {
    locale: 0,
    location: 0,
    status: 0,
    role: 0,
  });
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return { info: userInfo, success: true };
};

const updateKitchenOwnerInfo = async (userId, param) => {
  const userInfo = await User.findById(userId);
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    firstName: param.firstName,
    lastName: param.lastName,
    image: param.image,
    gender: param.gender,
  };
  Object.assign(userInfo, updateBody);
  await userInfo.save();
  return { success: true };
};

const updateKitchenOwnerStatus = async (waiterId, newStatus) => {
  const owner = await KitchenOwner.findById(waiterId);
  if (!owner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateWaiterBody = {
    status: newStatus,
  };
  Object.assign(owner, updateWaiterBody);
  await owner.save();
  const userInfo = await User.findById(owner.userId);
  if (!userInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateUserBody = {
    status: newStatus,
  };
  Object.assign(userInfo, updateUserBody);
  await userInfo.save();
  return { success: true };
};

const kitchenOwnerListAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const results = await KitchenOwner.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
        ownerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);
  const countResult = await KitchenOwner.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
      },
    },
    { $sort: { createdAt: -1 } },
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenKitchenOwnerList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const results = await KitchenOwner.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
        $and: [{ 'restaurants.city': new mongoose.Types.ObjectId(city) }],
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
        ownerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);
  const countResult = await KitchenOwner.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
        $and: [{ 'restaurants.city': new mongoose.Types.ObjectId(city) }],
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorKitchenOwnerList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const results = await KitchenOwner.aggregate([
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        ownerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
      },
    },
  ]);
  const totalResults = await KitchenOwner.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getKitchenLoginInfo = async (uid) => {
  const ownerInfo = await KitchenOwner.findOne({ userId: uid });
  return ownerInfo;
};

const kitchenOrder = async (ownerId, orderStatus, options) => {
  const ownerDetail = await KitchenOwner.findOne({ userId: new mongoose.Types.ObjectId(ownerId) });
  if (!ownerDetail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = {
    $and: [
      { restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant), status: orderStatus },
    ],
  };
  const newOrders = await KitchenOrder.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant), status: 'new' }],
  });
  const preparingOrders = await KitchenOrder.countDocuments({
    $and: [
      { restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant), status: 'preparing' },
    ],
  });
  const completedOrders = await KitchenOrder.countDocuments({
    $and: [
      { restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant), status: 'completed' },
    ],
  });
  const orderQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'orders',
        localField: 'regularOrder',
        foreignField: '_id',
        as: 'regularOrder',
      },
    },
    {
      $lookup: {
        from: 'posortableorders',
        localField: 'posOrder',
        foreignField: '_id',
        as: 'posOrder',
      },
    },
    {
      $lookup: {
        from: 'restauranttables',
        localField: 'tableId',
        foreignField: '_id',
        as: 'restauranttables',
      },
    },
    {
      $unwind: {
        path: '$regularOrder',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$posOrder',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restauranttables',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        orderFrom: 1,
        regularOrderInfo: {
          id: { $ifNull: ['$regularOrder._id', ''] },
          orderNo: { $ifNull: ['$regularOrder.orderNo', 0] },
        },
        posOrderInfo: {
          id: { $ifNull: ['$posOrder._id', ''] },
          orderNo: { $ifNull: ['$posOrder.orderNo', 0] },
        },
        tableOrder: {
          id: { $ifNull: ['$restauranttables._id', ''] },
          tableNumber: { $ifNull: ['$restauranttables.tableNumber', 0] },
        },
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        cookingInstruction: 1,
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const orders = await KitchenOrder.aggregate(orderQuery);
  const totalResults = await KitchenOrder.countDocuments(queryCondition);
  return Promise.all([
    ownerDetail,
    newOrders,
    preparingOrders,
    completedOrders,
    orders,
    totalResults,
  ]).then(() => {
    let totalPages = 0;
    if (orderStatus === 'new') {
      totalPages = Math.ceil(newOrders / limit);
    } else if (orderStatus === 'preparing') {
      totalPages = Math.ceil(preparingOrders / limit);
    } else if (orderStatus === 'completed') {
      totalPages = Math.ceil(completedOrders / limit);
    }
    const result = {
      orders,
      newOrders,
      preparingOrders,
      completedOrders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const preparingKitchenOrder = async (order, owner) => {
  const ownerDetail = await KitchenOwner.findOne({ userId: new mongoose.Types.ObjectId(owner) });
  if (!ownerDetail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const orderInfo = await KitchenOrder.findOne({
    _id: new mongoose.Types.ObjectId(order),
    restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant),
  });
  if (!orderInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateData = {
    status: 'preparing',
  };
  Object.assign(orderInfo, updateData);
  await orderInfo.save();
  return { success: true };
};

const completeKitchenOrder = async (order, owner) => {
  const ownerDetail = await KitchenOwner.findOne({ userId: new mongoose.Types.ObjectId(owner) });
  if (!ownerDetail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const orderInfo = await KitchenOrder.findOne({
    _id: new mongoose.Types.ObjectId(order),
    restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant),
  });
  if (!orderInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(order),
        restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'orders',
        localField: 'regularOrder',
        foreignField: '_id',
        as: 'regularOrder',
      },
    },
    {
      $lookup: {
        from: 'posortableorders',
        localField: 'posOrder',
        foreignField: '_id',
        as: 'posOrder',
      },
    },
    {
      $lookup: {
        from: 'restauranttables',
        localField: 'tableId',
        foreignField: '_id',
        as: 'restauranttables',
      },
    },
    {
      $unwind: {
        path: '$regularOrder',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$posOrder',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restauranttables',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        orderFrom: 1,
        regularOrderInfo: {
          id: { $ifNull: ['$regularOrder._id', ''] },
          orderNo: { $ifNull: ['$regularOrder.orderNo', 0] },
        },
        posOrderInfo: {
          id: { $ifNull: ['$posOrder._id', ''] },
          orderNo: { $ifNull: ['$posOrder.orderNo', 0] },
        },
        tableOrder: {
          id: { $ifNull: ['$restauranttables._id', ''] },
          tableNumber: { $ifNull: ['$restauranttables.tableNumber', 0] },
        },
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        cookingInstruction: 1,
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const orderMeta = await KitchenOrder.aggregate(orderQuery);
  if (!orderMeta[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const detail = orderMeta[0];
  const kind =
    detail && detail !== null && detail.orderFrom !== null && detail.orderFrom !== ''
      ? detail.orderFrom
      : 'regular_order';
  let orderNo = 0;
  let tableNo = 0;
  if (kind === 'regular_order') {
    orderNo =
      detail &&
      detail.regularOrderInfo &&
      detail.regularOrderInfo.id !== null &&
      detail.regularOrderInfo.id !== null
        ? detail.regularOrderInfo.orderNo
        : 0;
  }
  if (kind === 'pos_order') {
    orderNo =
      detail &&
      detail.posOrderInfo &&
      detail.posOrderInfo.id !== null &&
      detail.posOrderInfo.id !== null
        ? detail.posOrderInfo.orderNo
        : 0;
  }
  if (kind === 'table_order') {
    tableNo =
      detail && detail.tableOrder && detail.tableOrder.id !== null && detail.tableOrder.id !== null
        ? detail.tableOrder.tableNumber
        : 0;
  }
  let kindName = 'Regular Order';
  if (kind === 'regular_order') {
    kindName = 'Regular Order';
  }
  if (kind === 'pos_order') {
    kindName = 'POS Order';
  }
  if (kind === 'table_order') {
    kindName = 'Table Order';
  }
  const updateData = {
    status: 'completed',
  };
  Object.assign(orderInfo, updateData);
  await orderInfo.save();
  await fcmNotificationService.kitchenCompleteOrder(
    kind,
    kindName,
    orderNo,
    tableNo,
    ownerDetail.restaurant
  );
  return { detail, success: true };
};

const kitchenOrderDetail = async (order, owner) => {
  const ownerDetail = await KitchenOwner.findOne({ userId: new mongoose.Types.ObjectId(owner) });
  if (!ownerDetail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(order),
        restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'orders',
        localField: 'regularOrder',
        foreignField: '_id',
        as: 'regularOrder',
      },
    },
    {
      $lookup: {
        from: 'posortableorders',
        localField: 'posOrder',
        foreignField: '_id',
        as: 'posOrder',
      },
    },
    {
      $lookup: {
        from: 'restauranttables',
        localField: 'tableId',
        foreignField: '_id',
        as: 'restauranttables',
      },
    },
    {
      $unwind: {
        path: '$regularOrder',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$posOrder',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restauranttables',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        orderFrom: 1,
        regularOrderInfo: {
          id: { $ifNull: ['$regularOrder._id', ''] },
          orderNo: { $ifNull: ['$regularOrder.orderNo', 0] },
        },
        posOrderInfo: {
          id: { $ifNull: ['$posOrder._id', ''] },
          orderNo: { $ifNull: ['$posOrder.orderNo', 0] },
        },
        tableOrder: {
          id: { $ifNull: ['$restauranttables._id', ''] },
          tableNumber: { $ifNull: ['$restauranttables.tableNumber', 0] },
        },
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        cookingInstruction: 1,
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const orders = await KitchenOrder.aggregate(orderQuery);
  if (!orders[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const detail = orders[0];
  return Promise.all([ownerDetail, orders]).then(() => {
    const result = {
      detail,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        ownerInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
          email: { $ifNull: ['$users.email', ''] },
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
      },
    },
  ];
  const results = await KitchenOwner.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        users: 0,
        restaurants: 0,
      },
    },
  ];
  const results = await KitchenOwner.aggregate(query);
  return results;
};

const checkPermissionOfRestaurant = async (vendor) => {
  const restaurantInfo = await Restaurant.findOne({ _id: new mongoose.Types.ObjectId(vendor) });
  let ownKitchen = false;
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId, {
      ownKitchen: 1,
    });
    if (outletManager !== null && outletManager.id !== null) {
      ownKitchen = outletManager.ownKitchen;
    }
  } else {
    ownKitchen = restaurantInfo.ownKitchen;
  }
  return { ownKitchen };
};

function generateSecurePassword(length = 10) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';

  const hasLetterAndNumber = (password) => {
    return /[a-zA-Z]/.test(password) && /\d/.test(password);
  };

  let password = '';
  do {
    password = Array.from(
      { length },
      () => charset[Math.floor(Math.random() * charset.length)]
    ).join('');
  } while (!hasLetterAndNumber(password));

  return password;
}

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const permission = await checkPermissionOfRestaurant(param.restaurant);
      if (permission && permission !== null && permission.ownKitchen) {
        let isValid = true;
        if (await User.isEmailTaken(param.email)) {
          isValid = false;
        }
        if (await User.isPhoneTaken(param.countryCode, param.mobile)) {
          isValid = false;
        }
        if (isValid) {
          const userData = new User({
            email: param.email,
            password: generateSecurePassword(15),
            firstName:
              param && param.firstName && param.firstName !== null && param.firstName !== ''
                ? param.firstName
                : 'NA',
            lastName:
              param && param.lastName && param.lastName !== null && param.lastName !== ''
                ? param.lastName
                : 'NA',
            countryCode: param.countryCode,
            mobile: param.mobile,
            locale:
              param && param.locale && param.locale !== null && param.locale !== ''
                ? param.locale
                : 'en',
            image:
              param && param.image && param.image !== null && param.image !== ''
                ? param.image
                : 'NA',
            gender:
              param && param.gender && param.gender !== null && param.gender !== ''
                ? param.gender
                : 'male',
            role: 'kitchen',
            location: { type: 'Point', coordinates: [0, 0] },
            city:
              param && param.city && param.city !== null && param.city !== '' ? param.city : null,
            status: param && (param.status === 'active' || param.status === 'Active'),
          });
          const user = await User.create(userData);
          const ownerData = new KitchenOwner({
            userId: user.id,
            restaurant:
              param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
                ? param.restaurant
                : null,
          });
          await KitchenOwner.create(ownerData);
          const walletData = new Wallet({
            holderId: user.id,
          });
          if (!(await Wallet.isUserExist(walletData.holderId))) {
            await Wallet.create(walletData);
          }
        }
      }
    });
  }
  return { success: true };
};

module.exports = {
  createKitchenOwner,
  getAllVendorKitchenOwner,
  getById,
  updateKitchenOwnerInfo,
  updateKitchenOwnerStatus,
  kitchenOwnerListAdmin,
  cityzenKitchenOwnerList,
  vendorKitchenOwnerList,
  getKitchenLoginInfo,
  kitchenOrder,
  preparingKitchenOrder,
  completeKitchenOrder,
  kitchenOrderDetail,
  exportCollection,
  exportRawCollection,
  importCollection,
};

