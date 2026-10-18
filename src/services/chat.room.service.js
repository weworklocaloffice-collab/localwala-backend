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
const { ChatRoom, User, ChatConversion } = require('../models');
const chatConversionService = require('./chat.conversion.service');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const checkChatRoom = async (sender, receiver, options) => {
  let chatRoom = await ChatRoom.findOne({
    $or: [
      { senderId: sender, receiverId: receiver },
      { senderId: receiver, receiverId: sender },
    ],
  });
  if (!chatRoom) {
    chatRoom = new ChatRoom({
      senderId: sender,
      receiverId: receiver,
      lastMessage: '',
      lastMessageType: 'text',
    });
    await chatRoom.save();
  }
  if (chatRoom && chatRoom !== null && chatRoom.id) {
    const roomId = chatRoom.id;
    const chats = chatConversionService.getMessages(roomId, options);
    return chats;
  }
  return { success: false };
};

const getMyConversionList = async (userID) => {
  const chatListQuery = [
    {
      $match: {
        $or: [
          { senderId: new mongoose.Types.ObjectId(userID) },
          { receiverId: new mongoose.Types.ObjectId(userID) },
        ],
      },
    },
    { $sort: { updatedAt: -1 } },
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
  const chatList = await ChatRoom.aggregate(chatListQuery);
  return Promise.all([chatList]).then(() => {
    const result = {
      chats: chatList,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const adminChatList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const chatListQuery = [
    { $sort: { updatedAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
  const results = await ChatRoom.aggregate(chatListQuery);
  const totalResults = await ChatRoom.countDocuments();
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

const cityzenChatList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const chatListQuery = [
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
      $match: {
        $or: [
          { 'senderInfo.city': new mongoose.Types.ObjectId(city) },
          { 'receiverInfo.city': new mongoose.Types.ObjectId(city) },
        ],
      },
    },
    { $sort: { updatedAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
  const results = await ChatRoom.aggregate(chatListQuery);
  const totalResults = await ChatRoom.countDocuments();
  return Promise.all([cityzen, results, totalResults]).then(() => {
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

const importChatListCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const sender =
        param && param.senderId && param.senderId !== null && param.senderId !== ''
          ? param.senderId
          : null;
      const receiver =
        param && param.receiverId && param.receiverId !== null && param.receiverId !== ''
          ? param.receiverId
          : null;
      if (sender !== null && receiver !== null) {
        const chatRoom = await ChatRoom.findOne({
          $or: [
            { senderId: sender, receiverId: receiver },
            { senderId: receiver, receiverId: sender },
          ],
        });
        if (!chatRoom) {
          const chatRoomData = new ChatRoom({
            senderId: sender,
            receiverId: receiver,
            lastMessage:
              param && param.lastMessage && param.lastMessage !== null && param.lastMessage !== ''
                ? param.lastMessage
                : '',
            lastMessageType:
              param &&
              param.lastMessageType &&
              param.lastMessageType !== null &&
              param.lastMessageType !== '' &&
              param.lastMessageType === 'text'
                ? 'text'
                : 'image',
          });
          await ChatRoom.create(chatRoomData);
        }
      }
    });
  }
  return { success: true };
};

const importChatMessagesCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    const ops = importArray.map((messsage) => ({
      updateOne: {
        filter: { roomId: messsage.roomId },
        update: { $setOnInsert: messsage },
        upsert: true,
      },
    }));
    await ChatConversion.bulkWrite(ops);
  }
  return { success: true };
};

const exportCollection = async () => {
  const chatListQuery = [
    { $sort: { createdAt: -1 } },
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
        sender: {
          id: { $ifNull: ['$senderInfo._id', ''] },
          firstName: { $ifNull: ['$senderInfo.firstName', ''] },
          lastName: { $ifNull: ['$senderInfo.lastName', ''] },
        },
        receiver: {
          id: { $ifNull: ['$receiverInfo._id', ''] },
          firstName: { $ifNull: ['$receiverInfo.firstName', ''] },
          lastName: { $ifNull: ['$receiverInfo.lastName', ''] },
        },
        updatedAt: 1,
        lastMessage: 1,
        lastMessageType: 1,
      },
    },
  ];
  const results = await ChatRoom.aggregate(chatListQuery);
  return results;
};

const exportRawCollection = async () => {
  const results = await ChatRoom.find();
  return results;
};

module.exports = {
  checkChatRoom,
  getMyConversionList,
  adminChatList,
  cityzenChatList,
  exportCollection,
  exportRawCollection,
  importChatListCollection,
  importChatMessagesCollection,
};

