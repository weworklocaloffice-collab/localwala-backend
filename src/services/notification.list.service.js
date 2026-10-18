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
const {
  NotificationList,
  SupportChatConversion,
  Language,
  ChatRoom,
  SupportChatRoom,
  User,
} = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const getMyNotificationCount = async (id) => {
  const countNumber = await NotificationList.countDocuments({
    user: new mongoose.Types.ObjectId(id),
    status: true,
  });
  return { count: countNumber, success: true };
};

const getMyNotificationList = async (id, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const query = [
    { $sort: { createdAt: -1 } },
    { $match: { user: new mongoose.Types.ObjectId(id) } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        content: 1,
        username: 1,
        restaurantName: 1,
        time: 1,
        driverName: 1,
        reason: 1,
        amount: 1,
        packageName: 1,
        kind: 1,
        order: 1,
        userHelper: 1,
        restaurantHelper: 1,
        timeHelper: 1,
        driverHelper: 1,
        reasonHelper: 1,
        amountHelper: 1,
        packageHelper: 1,
        kindHelper: 1,
        orderHelper: 1,
        translations: 1,
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const results = await NotificationList.aggregate(query);
  const totalResults = await NotificationList.countDocuments({
    user: new mongoose.Types.ObjectId(id),
  });
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

const notificationReadAllStatus = async (id) => {
  await NotificationList.updateMany(
    { user: new mongoose.Types.ObjectId(id) },
    {
      $set: { status: false },
    }
  );
  return { success: true };
};

const adminHeaderContent = async () => {
  const query = [
    { $sort: { createdAt: -1 } },
    { $limit: 5 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        content: 1,
        username: 1,
        restaurantName: 1,
        time: 1,
        driverName: 1,
        reason: 1,
        amount: 1,
        packageName: 1,
        kind: 1,
        order: 1,
        userHelper: 1,
        restaurantHelper: 1,
        timeHelper: 1,
        driverHelper: 1,
        reasonHelper: 1,
        amountHelper: 1,
        packageHelper: 1,
        kindHelper: 1,
        orderHelper: 1,
        translations: 1,
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const supportChatQuery = [
    { $sort: { updatedAt: -1 } },
    { $limit: 5 },
    {
      $lookup: {
        from: 'users',
        localField: 'senderId',
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
      $project: {
        _id: 0,
        id: '$_id',
        message: 1,
        messageType: 1,
        createdAt: 1,
        sender: {
          id: { $ifNull: ['$users._id', ''] },
          image: { $ifNull: ['$users.image', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const notifications = await NotificationList.aggregate(query);
  const unread = await NotificationList.countDocuments({ status: true });
  const supportChat = await SupportChatConversion.aggregate(supportChatQuery);
  const locales = await Language.find();
  return Promise.all([notifications, unread, supportChat, locales]).then(() => {
    const result = {
      notifications,
      unread,
      supportChat,
      locales,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const adminNotificationList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const query = [
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        content: 1,
        username: 1,
        restaurantName: 1,
        time: 1,
        driverName: 1,
        reason: 1,
        amount: 1,
        packageName: 1,
        kind: 1,
        order: 1,
        userHelper: 1,
        restaurantHelper: 1,
        timeHelper: 1,
        driverHelper: 1,
        reasonHelper: 1,
        amountHelper: 1,
        packageHelper: 1,
        kindHelper: 1,
        orderHelper: 1,
        translations: 1,
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const results = await NotificationList.aggregate(query);
  const totalResults = await NotificationList.countDocuments();
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

const accountantHeaderContent = async () => {
  const locales = await Language.find();
  return Promise.all([locales]).then(() => {
    const result = {
      locales,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorHeaderContent = async (id) => {
  const query = [
    { $sort: { createdAt: -1 } },
    { $match: { user: new mongoose.Types.ObjectId(id) } },
    { $limit: 5 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        content: 1,
        username: 1,
        restaurantName: 1,
        time: 1,
        driverName: 1,
        reason: 1,
        amount: 1,
        packageName: 1,
        kind: 1,
        order: 1,
        userHelper: 1,
        restaurantHelper: 1,
        timeHelper: 1,
        driverHelper: 1,
        reasonHelper: 1,
        amountHelper: 1,
        packageHelper: 1,
        kindHelper: 1,
        orderHelper: 1,
        translations: 1,
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const chatListQuery = [
    { $sort: { updatedAt: -1 } },
    {
      $match: {
        $or: [
          { senderId: new mongoose.Types.ObjectId(id) },
          { receiverId: new mongoose.Types.ObjectId(id) },
        ],
      },
    },
    { $limit: 5 },
    {
      $lookup: {
        from: 'users',
        localField: 'senderId',
        foreignField: '_id',
        as: 'senderInfo',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'receiverId',
        foreignField: '_id',
        as: 'receiverInfo',
      },
    },
    {
      $unwind: {
        path: '$senderInfo',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$receiverInfo',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        senderId: 1,
        receiverId: 1,
        senderInfo: {
          id: { $ifNull: ['$senderInfo._id', ''] },
          firstName: { $ifNull: ['$senderInfo.firstName', ''] },
          lastName: { $ifNull: ['$senderInfo.lastName', ''] },
          image: { $ifNull: ['$senderInfo.image', ''] },
        },
        receiverInfo: {
          id: { $ifNull: ['$receiverInfo._id', ''] },
          firstName: { $ifNull: ['$receiverInfo.firstName', ''] },
          lastName: { $ifNull: ['$receiverInfo.lastName', ''] },
          image: { $ifNull: ['$receiverInfo.image', ''] },
        },
        updatedAt: 1,
        lastMessage: 1,
        lastMessageType: 1,
      },
    },
  ];
  const notifications = await NotificationList.aggregate(query);
  const unread = await NotificationList.countDocuments({
    status: true,
    user: new mongoose.Types.ObjectId(id),
  });
  const chatList = await ChatRoom.aggregate(chatListQuery);
  const locales = await Language.find();
  return Promise.all([notifications, unread, chatList, locales]).then(() => {
    const result = {
      notifications,
      unread,
      chatList,
      locales,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const supportTeamHeaderContent = async (id) => {
  const chatQuery = [
    { $sort: { updatedAt: -1 } },
    {
      $match: { supportTeam: { $in: [new mongoose.Types.ObjectId(id)] } },
    },
    { $limit: 5 },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
      $project: {
        _id: 0,
        id: '$_id',
        supportType: 1,
        updatedAt: 1,
        lastMessage: 1,
        lastMessageType: 1,
        orders: 1,
        booking: 1,
        purchaseSubscription: 1,
        restaurantComplaints: 1,
        complaints: 1,
        reportIssue: 1,
        status: 1,
        customer: {
          id: { $ifNull: ['$users._id', ''] },
          image: { $ifNull: ['$users.image', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
      },
    },
  ];
  const chatList = await SupportChatRoom.aggregate(chatQuery);
  const locales = await Language.find();
  return Promise.all([chatList, locales]).then(() => {
    const result = {
      chatList,
      locales,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenHeaderContent = async (masterId) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const supportChatQuery = [
    { $sort: { updatedAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
        'users.city': new mongoose.Types.ObjectId(city),
      },
    },
    { $limit: 5 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        supportType: 1,
        updatedAt: 1,
        lastMessage: 1,
        lastMessageType: 1,
        orders: 1,
        booking: 1,
        purchaseSubscription: 1,
        restaurantComplaints: 1,
        complaints: 1,
        reportIssue: 1,
        status: 1,
        customer: {
          id: { $ifNull: ['$users._id', ''] },
          image: { $ifNull: ['$users.image', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
      },
    },
  ];
  const notificationQuery = [
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
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        'users.city': new mongoose.Types.ObjectId(city),
      },
    },
    { $limit: 5 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        content: 1,
        username: 1,
        restaurantName: 1,
        time: 1,
        driverName: 1,
        reason: 1,
        amount: 1,
        packageName: 1,
        kind: 1,
        order: 1,
        userHelper: 1,
        restaurantHelper: 1,
        timeHelper: 1,
        driverHelper: 1,
        reasonHelper: 1,
        amountHelper: 1,
        packageHelper: 1,
        kindHelper: 1,
        orderHelper: 1,
        translations: 1,
        createdAt: 1,
        status: 1,
      },
    },
  ];
  const notificationCountQuery = [
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
      $match: {
        'users.city': new mongoose.Types.ObjectId(city),
        status: true,
      },
    },
    { $count: 'totalCount' },
  ];
  const locales = await Language.find();
  const supportChat = await SupportChatRoom.aggregate(supportChatQuery);
  const notifications = await NotificationList.aggregate(notificationQuery);
  const resultCount = await NotificationList.aggregate(notificationCountQuery);
  const unread = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;
  return Promise.all([cityzen, locales, supportChat, resultCount]).then(() => {
    const result = {
      supportChat,
      locales,
      notifications,
      unread,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenNotificationList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });

  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const cityId = cityzen.city;

  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;

  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;

  const skip = (page - 1) * limit;

  const cityObjectId = mongoose.Types.ObjectId.isValid(cityId)
    ? new mongoose.Types.ObjectId(cityId)
    : cityId;

  // -----------------------
  // RESULTS PIPELINE
  // -----------------------

  const results = await NotificationList.aggregate([
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
        preserveNullAndEmptyArrays: false,
      },
    },
    {
      $match: {
        'users.city': cityObjectId,
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        id: '$_id',
        title: 1,
        content: 1,
        username: 1,
        restaurantName: 1,
        time: 1,
        driverName: 1,
        reason: 1,
        amount: 1,
        packageName: 1,
        kind: 1,
        order: 1,
        userHelper: 1,
        restaurantHelper: 1,
        timeHelper: 1,
        driverHelper: 1,
        reasonHelper: 1,
        amountHelper: 1,
        packageHelper: 1,
        kindHelper: 1,
        orderHelper: 1,
        translations: 1,
        createdAt: 1,
        status: 1,
      },
    },
  ]);

  // -----------------------
  // COUNT PIPELINE
  // -----------------------

  const countResult = await NotificationList.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
      },
    },
    { $unwind: '$users' },
    {
      $match: {
        'users.city': cityObjectId,
      },
    },
    { $count: 'totalCount' },
  ]);

  const totalResults = countResult.length > 0 ? countResult[0].totalCount : 0;

  const totalPages = Math.ceil(totalResults / limit);

  return {
    results,
    page,
    limit,
    totalPages,
    totalResults,
  };
};

module.exports = {
  getMyNotificationCount,
  getMyNotificationList,
  notificationReadAllStatus,
  adminHeaderContent,
  adminNotificationList,
  accountantHeaderContent,
  vendorHeaderContent,
  supportTeamHeaderContent,
  cityzenHeaderContent,
  cityzenNotificationList,
};

