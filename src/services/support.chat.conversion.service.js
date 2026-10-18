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
const { SupportChatConversion, SupportChatRoom } = require('../models');

const getMessages = async (roomID, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
const conversionQuery = [
    // Internal notes are agent-only. This is the CUSTOMER-facing projection, so
    // they are filtered in the $match — a projection filter would still leak
    // them in `totalResults` and let a page boundary reveal that hidden rows
    // exist.
    { $match: { roomId: new mongoose.Types.ObjectId(roomID), visibility: { $ne: 'internal' } } },
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
        senderRole: 1,
        visibility: 1,
        readStatus: 1,
        randomId: 1,
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
const chats = await SupportChatConversion.aggregate(conversionQuery);
  const totalResults = await SupportChatConversion.countDocuments({
    roomId: new mongoose.Types.ObjectId(roomID),
    visibility: { $ne: 'internal' },
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

const saveNewMessage = async (room, sender, msg, msgType, meta = {}) => {
  // Idempotency: REST + socket both persist, so the same client randomId
  // arriving twice (retry, double transport) must not fork two rows.
  if (meta.randomId) {
    const dup = await SupportChatConversion.findOne({ roomId: room, randomId: meta.randomId })
      .select('_id')
      .lean();
    if (dup) return { success: true, messageId: dup._id, duplicate: true };
  }
  const msgData = new SupportChatConversion({
    roomId: room,
    senderId: sender,
    message: msg,
    messageType: msgType,
    senderRole: meta.senderRole || 'user',
    randomId: meta.randomId,
  });
  const created = await SupportChatConversion.create(msgData);
  const chatRoomData = await SupportChatRoom.findById(room);
  if (chatRoomData && chatRoomData !== null) {
    const updateBody = {
      lastMessage: msg,
      lastMessageType: msgType,
    };
    Object.assign(chatRoomData, updateBody);
    await chatRoomData.save();
  }
  return { success: true, messageId: created.id, createdAt: created.createdAt };
};

const saveSupportMessage = async (room, sender, msg, msgType) => {
  const msgData = new SupportChatConversion({
    roomId: room,
    senderId: sender,
    message: msg,
    messageType: msgType,
    senderRole: 'agent',
    visibility: 'public',
    readStatus: 'sent',
  });
  await SupportChatConversion.create(msgData);
  const chatRoomData = await SupportChatRoom.findById(room);
  if (chatRoomData && chatRoomData !== null) {
    const updateBody = {
      lastMessage: msg,
      lastMessageType: msgType,
      status: 'in_progress',
      handoverState: 'human',
    };
    Object.assign(chatRoomData, updateBody);
    if (!chatRoomData.firstResponseAt) chatRoomData.firstResponseAt = new Date();
    await chatRoomData.save();

    // Same push as saveAgentReply — this is the legacy REST route the Admin
    // panel still calls, so without it a reply sent that way is silent.
    const fcmNotificationService = require('./fcm.notification.service');
    fcmNotificationService
      .supportChatMessage(chatRoomData.userId, room, msg, threadOf(chatRoomData))
      .catch(() => {});
  }
  await SupportChatRoom.findByIdAndUpdate(
    room,
    { $addToSet: { supportTeam: sender } },
    { returnDocument: 'after' }
  );
  return { success: true };
};

const adminChatMessages = async (roomId, options) => {
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
        senderRole: 1,
        visibility: 1,
        readStatus: 1,
        randomId: 1,
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
  const chats = await SupportChatConversion.aggregate(conversionQuery);
  const totalResults = await SupportChatConversion.countDocuments({
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

const cityzenChatMessages = async (roomId, options) => {
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
        senderRole: 1,
        visibility: 1,
        readStatus: 1,
        randomId: 1,
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
  const chats = await SupportChatConversion.aggregate(conversionQuery);
  const totalResults = await SupportChatConversion.countDocuments({
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
        senderRole: 1,
        visibility: 1,
        readStatus: 1,
        randomId: 1,
        sender: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const results = await SupportChatConversion.aggregate(query);
  return results;
};

const exportRawCollection = async () => {
  const results = await SupportChatConversion.find();
  return results;
};

const saveInternalNote = async (roomId, sender, note) => {
  await SupportChatConversion.create({
    roomId,
    senderId: sender,
    message: note,
    messageType: 'text',
    senderRole: 'agent',
    visibility: 'internal',
    readStatus: 'sent',
  });
  return { success: true };
};

// Agent public reply. Adds the agent to supportTeam and stamps firstResponseAt
// for the SLA report, instead of the blind `$addToSet` the old flow relied on.
// The app deep-links from the room's entity, not the room id, so resolve it
// here and hand it to the push. A null entity means the guard itself created
// the room type, in which case the tap lands on the generic chat list.
const threadOf = (room) => {
  if (!room) return {};
  const byType = {
    orders: room.orders,
    dining: room.booking,
    tiffin_subscription: room.purchaseSubscription,
    complaints: room.complaints,
    reports: room.reportIssue,
    restaurant_complaints: room.restaurantComplaints,
  };
  return { supportType: room.supportType, entityId: byType[room.supportType] || null };
};

const saveAgentReply = async (room, sender, msg, msgType, meta = {}) => {
  // Retried socket sends must reconcile with the first persisted row, not
  // append a second public reply and audit entry.
  if (meta.randomId) {
    const dup = await SupportChatConversion.findOne({ roomId: room, randomId: meta.randomId })
      .select('_id')
      .lean();
    if (dup) return { success: true, messageId: dup._id, duplicate: true };
  }
  const msgData = new SupportChatConversion({
    roomId: room,
    senderId: sender,
    message: msg,
    messageType: msgType,
    senderRole: 'agent',
    visibility: 'public',
    readStatus: 'sent',
    randomId: meta.randomId,
    replyTo: meta.replyTo,
    attachments: meta.attachments,
  });
  const created = await SupportChatConversion.create(msgData);
  const chatRoomData = await SupportChatRoom.findById(room);
  if (chatRoomData && chatRoomData !== null) {
    chatRoomData.lastMessage = msg;
    chatRoomData.lastMessageType = msgType;
    chatRoomData.status = chatRoomData.status === 'resolved' ? 'in_progress' : 'in_progress';
    chatRoomData.handoverState = 'human';
    if (!chatRoomData.firstResponseAt) chatRoomData.firstResponseAt = new Date();
    chatRoomData.audit = chatRoomData.audit || [];
    chatRoomData.audit.push({ by: sender, action: 'agent-reply', at: new Date() });
    // A human answered: the ticket is being looked after again, so disarm any
    // escalation. Without this a ticket escalated once stays flagged for life.
    if (chatRoomData.escalationLevel > 0) {
      chatRoomData.escalationLevel = 0;
      chatRoomData.escalationReason = undefined;
      chatRoomData.escalatedTo = undefined;
      chatRoomData.audit.push({ action: 'escalation:cleared', at: new Date(), meta: { note: 'agent replied' } });
    }
    await chatRoomData.save();

    // Wake the customer. Fire-and-forget: the socket already delivered this to
    // anyone connected, and a push failure must not roll back a saved message.
    const fcmNotificationService = require('./fcm.notification.service');
    fcmNotificationService
      .supportChatMessage(chatRoomData.userId, room, msg, threadOf(chatRoomData))
      .catch(() => {});
  }
  await SupportChatRoom.findByIdAndUpdate(
    room,
    { $addToSet: { supportTeam: sender } },
    { returnDocument: 'after' }
  );
  return { success: true, messageId: created.id, createdAt: created.createdAt };
};

module.exports = {
  getMessages,
  saveNewMessage,
  saveSupportMessage,
  saveAgentReply,
  saveInternalNote,
  threadOf,
  adminChatMessages,
  cityzenChatMessages,
  exportCollection,
  exportRawCollection,
};

