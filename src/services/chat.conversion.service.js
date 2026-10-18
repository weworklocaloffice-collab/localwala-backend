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
const { ChatConversion, ChatRoom } = require('../models');

const getMessages = async (roomID, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const conversionQuery = [
    { $match: { roomId: new mongoose.Types.ObjectId(roomID) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        roomId: 1,
        senderId: 1,
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
  const chats = await ChatConversion.aggregate(conversionQuery);
  const totalResults = await ChatConversion.countDocuments({
    roomId: new mongoose.Types.ObjectId(roomID),
  });
  return Promise.all([chats, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      roomID,
      chats,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const saveNewMessage = async (room, sender, msg, msgType) => {
  const msgData = new ChatConversion({
    roomId: room,
    senderId: sender,
    message: msg,
    messageType: msgType,
  });
  await ChatConversion.create(msgData);
  const chatRoomData = await ChatRoom.findById(room);
  if (chatRoomData && chatRoomData !== null) {
    const updateBody = {
      lastMessage: msg,
      lastMessageType: msgType,
    };
    Object.assign(chatRoomData, updateBody);
    await chatRoomData.save();
  }
  return { success: true };
};

const adminGetChatMessages = async (roomId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const conversionQuery = [
    { $match: { roomId: new mongoose.Types.ObjectId(roomId) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        roomId: 1,
        senderId: 1,
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
  const chats = await ChatConversion.aggregate(conversionQuery);
  const totalResults = await ChatConversion.countDocuments({
    roomId: new mongoose.Types.ObjectId(roomId),
  });
  return Promise.all([chats, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      roomId,
      chats,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenGetChatMessages = async (roomId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const conversionQuery = [
    { $match: { roomId: new mongoose.Types.ObjectId(roomId) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        roomId: 1,
        senderId: 1,
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
  const chats = await ChatConversion.aggregate(conversionQuery);
  const totalResults = await ChatConversion.countDocuments({
    roomId: new mongoose.Types.ObjectId(roomId),
  });
  return Promise.all([chats, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      roomId,
      chats,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportCollection = async () => {
  const query = [
    { $sort: { createdAt: -1 } },
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
        roomId: 1,
        senderId: 1,
        message: 1,
        messageType: 1,
        createdAt: 1,
        sender: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
      },
    },
  ];
  const results = await ChatConversion.aggregate(query);
  return results;
};

const exportRawCollection = async () => {
  const results = await ChatConversion.find();
  return results;
};

module.exports = {
  getMessages,
  saveNewMessage,
  adminGetChatMessages,
  cityzenGetChatMessages,
  exportCollection,
  exportRawCollection,
};

