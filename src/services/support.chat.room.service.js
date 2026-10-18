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
const {
  SupportChatRoom,
  User,
  Orders,
  DiningBooking,
  UserPurchasedTiffinSubscription,
  Complaints,
  ReportIssueRestaurant,
  Restaurant,
  RestaurantComplaints,
  SupportChatConversion,
} = require('../models');
const supportChatConversionService = require('./support.chat.conversion.service');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const checkChatRoom = async (user, type, typeId, options) => {
  // Two taps in the same instant used to run `findOne` twice, find nothing
  // twice, and save two rooms — the customer then had two tickets for one
  // order. `createOrGetBotRoom` does the same lookup plus creation as one
  // atomic upsert, so this delegates to it. The return contract is unchanged:
  // the message page for the room.
  const chatRoom = await createOrGetBotRoom(user, type, typeId);
  if (chatRoom && chatRoom !== null && chatRoom.id) {
    const roomId = chatRoom.id;
    const chats = supportChatConversionService.getMessages(roomId, options);
    return chats;
  }
  return { success: false };
};

const mySupportChat = async (userID) => {
  const chatListQuery = [
    {
      $match: { userId: new mongoose.Types.ObjectId(userID) },
    },
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
      $lookup: {
        from: 'users',
        localField: 'supportTeam',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              firstName: 1,
              lastName: 1,
              image: 1,
            },
          },
          { $limit: 3 },
        ],
        as: 'team',
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
        team: 1,
        customer: {
          id: { $ifNull: ['$users._id', ''] },
          image: { $ifNull: ['$users.image', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
      },
    },
  ];
  const chatList = await SupportChatRoom.aggregate(chatListQuery);
  return Promise.all([chatList]).then(() => {
    const result = {
      chats: chatList,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const filterChatList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  let queryCondition = {};
  if (options.filter !== 'all') {
    queryCondition = { status: options.filter };
  } else {
    queryCondition = { status: { $ne: 'all' } };
  }
  const supportQuery = [
    { $match: queryCondition },
    { $sort: { updatedAt: -1 } },
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
                  { $substrCP: ['$email', 0, 2] },
                  'XXXXX@',
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
        from: 'users',
        localField: 'supportTeam',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              firstName: 1,
              lastName: 1,
              image: 1,
            },
          },
          { $limit: 3 },
        ],
        as: 'team',
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
        orders: 1,
        booking: 1,
        purchaseSubscription: 1,
        complaints: 1,
        reportIssue: 1,
        supportType: 1,
        restaurantComplaints: 1,
        status: 1,
        updatedAt: 1,
        customer: {
          id: { $ifNull: ['$users._id', ''] },
          image: { $ifNull: ['$users.image', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        team: 1,
      },
    },
  ];
const chats = await SupportChatRoom.aggregate(supportQuery);

  // All ten counters in ONE round trip. Previously this was ten sequential
  // `countDocuments` calls after the list aggregate — eleven round trips per
  // dashboard load, each scanning the collection independently. `$facet` runs
  // them as parallel sub-pipelines over a single collection scan instead.
  // The response keys are unchanged, so no caller changes.
  const [counters] = await SupportChatRoom.aggregate([
    {
      $facet: {
        totalResults: [{ $match: queryCondition }, { $count: 'n' }],
        allChat: [{ $count: 'n' }],
        orderChat: [{ $match: { supportType: 'orders' } }, { $count: 'n' }],
        diningChat: [{ $match: { supportType: 'dining' } }, { $count: 'n' }],
        tiffinSubscriptionChat: [{ $match: { supportType: 'tiffin_subscription' } }, { $count: 'n' }],
        complaintChat: [{ $match: { supportType: 'complaints' } }, { $count: 'n' }],
        reportChat: [{ $match: { supportType: 'reports' } }, { $count: 'n' }],
        restaurantComplaintChats: [{ $match: { supportType: 'restaurant_complaints' } }, { $count: 'n' }],
        openChat: [{ $match: { status: 'open' } }, { $count: 'n' }],
        inProgressChat: [{ $match: { status: 'in_progress' } }, { $count: 'n' }],
        resolvedChat: [{ $match: { status: 'resolved' } }, { $count: 'n' }],
      },
    },
  ]);
  // An empty bucket yields `[]`, not `[{n: 0}]` — hence the accessor, not `[0].n`.
  const n = (bucket) => (bucket && bucket[0] ? bucket[0].n : 0);

  const result = {
    chats,
    totalResults: n(counters.totalResults),
    allChat: n(counters.allChat),
    diningChat: n(counters.diningChat),
    tiffinSubscriptionChat: n(counters.tiffinSubscriptionChat),
    complaintChat: n(counters.complaintChat),
    reportChat: n(counters.reportChat),
    restaurantComplaintChats: n(counters.restaurantComplaintChats),
    orderChat: n(counters.orderChat),
    openChat: n(counters.openChat),
    inProgressChat: n(counters.inProgressChat),
    resolvedChat: n(counters.resolvedChat),
    success: true,
  };
  return result;
};

const getInitialChatSupportMessages = async (options) => {
const info = await SupportChatRoom.findById(options.roomId, {
    userId: 1,
    supportType: 1,
    orders: 1,
    booking: 1,
    purchaseSubscription: 1,
    complaints: 1,
    reportIssue: 1,
    createdAt: 1,
    restaurantComplaints: 1,
// Enterprise fields. The workspace header renders handover stage, priority,
// the SLA countdown and the bot's order card straight from this — omitting
// them here left every one of those permanently blank. `audit` feeds the
// history timeline; without it no one can see who touched the ticket.
    handoverState: 1,
    priority: 1,
    slaDueAt: 1,
    orderSnapshot: 1,
    assignedAgent: 1,
    status: 1,
    audit: 1,
    pendingTransfer: 1,
  })
    .populate('assignedAgent', 'firstName lastName image')
    .populate('pendingTransfer.toAgent', 'firstName lastName image')
    .populate('pendingTransfer.byAgent', 'firstName lastName image')
    .lean();
  if (!info) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  let orderInfo = null;
  let bookingInfo = null;
  let packageInfo = null;
  let complaintInfo = null;
  let reportInfo = null;
  let restaurantId = null;
  let restaurantComplaintInfo = null;

  if (info && info.supportType !== null && info.supportType === 'orders') {
    orderInfo = await Orders.findById(info.orders, {
      orderNo: 1,
      grandTotal: 1,
      orderTo: 1,
      status: 1,
      restaurant: 1,
    });
    if (orderInfo && orderInfo !== null && orderInfo.id !== null && orderInfo.id !== '') {
      restaurantId = orderInfo.restaurant;
    }
  }

  if (info && info.supportType !== null && info.supportType === 'dining') {
    bookingInfo = await DiningBooking.findById(info.booking, {
      grandTotal: 1,
      paymentMode: 1,
      status: 1,
      restaurant: 1,
    });
    if (bookingInfo && bookingInfo !== null && bookingInfo.id !== null && bookingInfo.id !== '') {
      restaurantId = bookingInfo.restaurant;
    }
  }

  if (info && info.supportType !== null && info.supportType === 'tiffin_subscription') {
    packageInfo = await UserPurchasedTiffinSubscription.findById(info.purchaseSubscription, {
      grandTotal: 1,
      totalOrder: 1,
      status: 1,
      restaurant: 1,
    });
    if (packageInfo && packageInfo !== null && packageInfo.id !== null && packageInfo.id !== '') {
      restaurantId = packageInfo.restaurant;
    }
  }

  if (info && info.supportType !== null && info.supportType === 'complaints') {
    const complaintDetail = await Complaints.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(info.complaints) } },
      { $limit: 1 },
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
          issueWith: 1,
          orders: 1,
          restaurant: 1,
          reasons: {
            id: { $ifNull: ['$reasons._id', ''] },
            name: { $ifNull: ['$reasons.name', ''] },
            translations: { $ifNull: ['$reasons.translations', []] },
          },
        },
      },
    ]);
    if (checkArrayNotEmpty(complaintDetail)) {
      complaintInfo = complaintDetail[0];
      if (
        complaintInfo &&
        complaintInfo !== null &&
        complaintInfo.id !== null &&
        complaintInfo.id !== ''
      ) {
        restaurantId = complaintInfo.restaurant;
      }
    }
  }

  if (info && info.supportType !== null && info.supportType === 'restaurant_complaints') {
    const complaintDetail = await RestaurantComplaints.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(info.restaurantComplaints) } },
      { $limit: 1 },
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
          issueWith: 1,
          orders: 1,
          restaurant: 1,
          reasons: {
            id: { $ifNull: ['$reasons._id', ''] },
            name: { $ifNull: ['$reasons.name', ''] },
            translations: { $ifNull: ['$reasons.translations', []] },
          },
        },
      },
    ]);
    if (checkArrayNotEmpty(complaintDetail)) {
      restaurantComplaintInfo = complaintDetail[0];
      if (
        restaurantComplaintInfo &&
        restaurantComplaintInfo !== null &&
        restaurantComplaintInfo.id !== null &&
        restaurantComplaintInfo.id !== ''
      ) {
        restaurantId = restaurantComplaintInfo.restaurant;
      }
    }
  }

  if (info && info.supportType !== null && info.supportType === 'reports') {
    const reportDetail = await ReportIssueRestaurant.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(info.reportIssue) } },
      { $limit: 1 },
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
          path: '$reasons',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          id: '$_id',
          message: 1,
          restaurant: 1,
          reasons: {
            id: { $ifNull: ['$reasons._id', ''] },
            name: { $ifNull: ['$reasons.name', ''] },
            translations: { $ifNull: ['$reasons.translations', []] },
          },
        },
      },
    ]);
    if (checkArrayNotEmpty(reportDetail)) {
      reportInfo = reportDetail[0];
      if (reportInfo && reportInfo !== null && reportInfo.id !== null && reportInfo.id !== '') {
        restaurantId = reportInfo.restaurant;
      }
    }
  }

  let restaurantInfo = null;

  if (restaurantId !== null && restaurantId !== '') {
    const restaurantDetail = await Restaurant.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(restaurantId) } },
      { $limit: 1 },
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
          name: 1,
          cover: 1,
          address: 1,
          translations: 1,
          userInfo: {
            id: { $ifNull: ['$users._id', ''] },
            firstName: { $ifNull: ['$users.firstName', ''] },
            lastName: { $ifNull: ['$users.lastName', ''] },
            countryCode: { $ifNull: ['$users.countryCode', ''] },
            mobile: { $ifNull: ['$users.mobile', ''] },
            email: { $ifNull: ['$users.email', ''] },
            role: { $ifNull: ['$users.role', ''] },
          },
        },
      },
    ]);
    if (checkArrayNotEmpty(restaurantDetail)) {
      restaurantInfo = restaurantDetail[0];
    }
  }

  const userInfo = await User.findById(info.userId, {
    firstName: 1,
    lastName: 1,
    email: 1,
    role: 1,
    image: 1,
    countryCode: 1,
    mobile: 1,
  });
  const supportTeam = await User.findById(options.supportTeam, {
    firstName: 1,
    lastName: 1,
    image: 1,
  });
  const chats = await supportChatConversionService.getMessages(options.roomId, options);
  return Promise.all([
    info,
    orderInfo,
    bookingInfo,
    packageInfo,
    complaintInfo,
    restaurantComplaintInfo,
    reportInfo,
    restaurantInfo,
    userInfo,
    supportTeam,
    chats,
  ]).then(() => {
    const result = {
      info,
      orderInfo,
      bookingInfo,
      packageInfo,
      complaintInfo,
      restaurantComplaintInfo,
      reportInfo,
      restaurantInfo,
      userInfo,
      supportTeam,
      chats,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const fetchMoreSupportMessages = async (options) => {
  const chats = await supportChatConversionService.getMessages(options.roomId, options);
  return { chats, success: true };
};

// --- Enterprise: bot-first room lifecycle -----------------------------------
// Idempotent room create. `findOneAndUpdate(upsert)` closes the double-tap race
// that `checkChatRoom` above still has, without editing that function.
const createOrGetBotRoom = async (user, type, typeId) => {
  const userId = new mongoose.Types.ObjectId(user);
  const typeOid = typeId ? new mongoose.Types.ObjectId(typeId) : null;
  const ENTITY_FIELD = {
    orders: 'orders',
    dining: 'booking',
    tiffin_subscription: 'purchaseSubscription',
    complaints: 'complaints',
    reports: 'reportIssue',
    restaurant_complaints: 'restaurantComplaints',
  };
  const activeField = ENTITY_FIELD[type] || null;

  // The active entity field pins the room; every other one is nulled on insert
  // so `findOne({orders:null})` can never match an unrelated room.
  const filter = { userId, supportType: type };
  if (activeField) filter[activeField] = typeOid;

  const setFields = {
    userId,
    supportType: type,
    lastMessage: '',
    lastMessageType: 'text',
    skillTags: [type],
    supportTeam: [],
    botEnabled: true,
    handoverState: 'bot',
    ...Object.fromEntries(Object.values(ENTITY_FIELD).map((f) => [f, null])),
  };
  if (activeField) setFields[activeField] = typeOid;

  return SupportChatRoom.findOneAndUpdate(filter, { $setOnInsert: setFields }, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });
};

// Position in the unassigned backlog. 1-based; 0 when not queued.
const getQueuePosition = async (roomId) => {
  const room = await SupportChatRoom.findById(roomId).select('handoverState status').lean();
  if (!room) return 0;
  if (room.handoverState !== 'queued') return 0;
  const ahead = await SupportChatRoom.countDocuments({
    handoverState: 'queued',
    status: { $in: ['open', 'in_progress'] },
    createdAt: { $lt: room.createdAt },
  });
  return ahead + 1;
};

const transferSupportChat = async (roomId, toAgent, reason, fromAgent = null) => {
  const toId = new mongoose.Types.ObjectId(toAgent);
  const fromId = fromAgent ? new mongoose.Types.ObjectId(fromAgent) : null;
  const room = await SupportChatRoom.findById(roomId).select('assignedAgent queueId supportType priority').lean();
  if (!room) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');

  const unassigned = !room.assignedAgent;
  const selfClaim = unassigned || String(room.assignedAgent) === String(toId);

  // Self-claim (Accept from queue): atomic first-click-wins AND atomic WIP.
  // A lost race gets 409; a full agent is refused instead of silently
  // overshooting the cap.
  if (selfClaim) {
    const supportAssignmentService = require('./support.assignment.service');
    const wip = await resolveWipLimit(room);
    const slot = await supportAssignmentService.claimTicket(toId, wip);
    // Capacity refusal is a CONFLICT about state, not a rate limit. 429 made
    // the panel say "Too Many Requests" for what is really "this agent is
    // full", and proxies/clients treat 429 as retryable.
    if (!slot) throw new ApiError(httpStatus.CONFLICT, `Agent is at full capacity (${wip} open tickets)`);
    const claimed = await SupportChatRoom.findOneAndUpdate(
      {
        _id: roomId,
        $or: [{ assignedAgent: null }, { assignedAgent: { $exists: false } }, { assignedAgent: toId }],
      },
      {
        $set: { assignedAgent: toId, handoverState: 'human', firstResponseDueAt: await supportAssignmentService.firstResponseDue(room) },
        $unset: { pendingTransfer: 1 },
        $push: {
          audit: { by: fromId, action: 'transfer', at: new Date(), meta: { to: toId, reason: reason || 'self-accept' } },
        },
      },
      { returnDocument: 'after' }
    );
    if (!claimed) {
      // Lost the race after taking a slot: hand the slot back immediately.
      await supportAssignmentService.releaseTicket(toId);
      throw new ApiError(httpStatus.CONFLICT, 'Already taken by another agent');
    }
    await supportChatConversionService.saveInternalNote(roomId, toId, `Accepted: ${reason || 'self-accept from queue'}`);
    try {
      const { User } = require('../models');
      const { SupportChatConversion } = require('../models');
      const agentUser = await User.findById(toId).select('firstName lastName').lean();
      const agentName = agentUser ? `${agentUser.firstName || ''} ${agentUser.lastName || ''}`.trim() : '';
      const joinText = agentName
        ? `${agentName} (support agent) is here to resolve your issue.`
        : 'A support agent has joined the chat to resolve your issue.';
      const roomDoc = await SupportChatRoom.findById(roomId).select('userId').lean();
      await SupportChatConversion.create({
        roomId,
        senderId: roomDoc ? roomDoc.userId : toId,
        message: joinText,
        messageType: 'text',
        senderRole: 'system',
        visibility: 'public',
        readStatus: 'sent',
      });
      await SupportChatRoom.findByIdAndUpdate(roomId, { $set: { lastMessage: joinText, lastMessageType: 'text' } });
    } catch {
      // Announcement must never break the claim.
    }
    return claimed;
  }

  // Offer: the ticket stays with its owner until the receiver accepts.
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const updated = await SupportChatRoom.findByIdAndUpdate(
    roomId,
    {
      $set: { pendingTransfer: { toAgent: toId, byAgent: fromId, reason: reason || '', at: new Date(), expiresAt } },
      $push: {
        audit: { by: fromId, action: 'transfer:offered', at: new Date(), meta: { to: toId, reason: reason || '' } },
      },
    },
    { returnDocument: 'after' }
  );
  await supportChatConversionService.saveInternalNote(roomId, fromId || toId, `Transfer offered: ${reason || '-'}`);
  // Wake the receiving agent's browsers: the offer only exists in the DB
  // until they open the thread, and the Offered tab polls slowly.
  try {
    const fcmNotificationService = require('./fcm.notification.service');
    fcmNotificationService
      .supportChatAgentAlert(toId, roomId, `Transfer offered: ${reason || 'a ticket'}`, 'Transfer offer')
      .catch(() => {});
  } catch {
    // Push plumbing must never break the offer.
  }
  return updated;
};

// Supervisor-only forced resolve. Same terminal state as a normal resolve,
// but audited as forced with the supervisor named — never confused with the
// agent's own or the idle sweep's resolution.
const forceResolve = async (roomId, byAgent, reason = '') => {
  const room = await SupportChatRoom.findById(roomId);
  if (!room) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  if (room.status === 'resolved') return room;
  const supportAssignmentService = require('./support.assignment.service');
  if (room.assignedAgent) await supportAssignmentService.releaseTicket(room.assignedAgent);
  room.status = 'resolved';
  room.handoverState = 'resolved';
  room.resolvedAt = new Date();
  // A closed ticket is not an escalation candidate any more.
  room.escalationLevel = 0;
  room.escalationReason = undefined;
  room.resolvedBy = byAgent ? new mongoose.Types.ObjectId(byAgent) : undefined;
  room.assignedAgent = null;
  room.audit = room.audit || [];
  room.audit.push({
    by: byAgent ? new mongoose.Types.ObjectId(byAgent) : undefined,
    action: 'resolved:forced',
    at: new Date(),
    meta: { reason },
  });
  await room.save();
  await supportChatConversionService.saveInternalNote(roomId, byAgent, `Supervisor closed: ${reason || '-'}`);
  return room;
};

// Bulk supervisor actions over explicit ids: resolve-many or move-many.
// Per-room results (no silent partial failure); WIP-checked per assignment.
const bulkAction = async (ids, action, { toAgent = null, reason = '', byAgent = null } = {}) => {
  const results = [];
  const supportAssignmentService = require('./support.assignment.service');
  for (const roomId of ids || []) {
    try {
      if (action === 'resolve') {
        await forceResolve(roomId, byAgent, reason);
        results.push({ id: roomId, ok: true });
      } else if (action === 'assign') {
        if (!toAgent) throw new ApiError(httpStatus.BAD_REQUEST, 'toAgent required');
        await forceAssign(roomId, toAgent, reason, byAgent);
        results.push({ id: roomId, ok: true });
      } else {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown bulk action');
      }
    } catch (e) {
      results.push({ id: roomId, ok: false, error: e.message });
      // Keep the slot accounting honest on partial failure.
      if (action === 'assign' && toAgent) await supportAssignmentService.releaseTicket(toAgent);
    }
  }
  return results;
};
// The WIP cap an agent must fit inside for a given ticket. Previously
// accept/force-assign hardcoded `3` while auto-assign and self-claim read the
// queue's real `wipLimit`, so a queue configured to WIP 5 still refused an
// accept at 4 tickets - the cap silently changed meaning depending on which
// code path moved the ticket.
const resolveWipLimit = async (room) => {
  if (room && room.queueId) {
    const { SupportQueue } = require('../models');
    const q = await SupportQueue.findById(room.queueId).select('wipLimit').lean();
    if (q && q.wipLimit) return q.wipLimit;
  }
  return 3;
};

const forceAssign = async (roomId, toAgent, reason, byAgent) => {
  const toId = new mongoose.Types.ObjectId(toAgent);
  const room = await SupportChatRoom.findById(roomId).select('assignedAgent queueId supportType priority workingHours').lean();
  if (!room) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  const prev = room.assignedAgent;
  const supportAssignmentService = require('./support.assignment.service');
  const slot = await supportAssignmentService.claimTicket(toId, await resolveWipLimit(room));
  if (!slot) throw new ApiError(httpStatus.CONFLICT, 'Target agent is at full capacity or offline');
  // This hardcoded 30s ignored the ticket's SLA policy entirely, so a forced
  // move was judged against a different deadline than a normal assignment.
  const firstResponseDueAt = await supportAssignmentService.firstResponseDue(room);
  const updated = await SupportChatRoom.findByIdAndUpdate(
    roomId,
    {
      $set: { assignedAgent: toId, handoverState: 'human', firstResponseDueAt },
      $unset: { pendingTransfer: 1 },
      $push: {
        audit: {
          by: byAgent ? new mongoose.Types.ObjectId(byAgent) : undefined,
          action: 'transfer:forced',
          at: new Date(),
          meta: { from: prev, to: toId, reason: reason || 'supervisor move' },
        },
      },
    },
    { returnDocument: 'after' }
  );
  if (!updated) {
    await supportAssignmentService.releaseTicket(toId);
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (prev && String(prev) !== String(toId)) await supportAssignmentService.releaseTicket(prev);
  await supportChatConversionService.saveInternalNote(roomId, toId, `Supervisor moved ticket: ${reason || '-'}`);
  return updated;
};
const acceptTransfer = async (roomId, agent) => {
  const agentId = new mongoose.Types.ObjectId(agent);
  // Capacity first: an accept must never overshoot the receiver's WIP. The cap
  // comes from the ticket's own queue, not a hardcoded 3.
  const supportAssignmentService = require('./support.assignment.service');
  const wip = await resolveWipLimit(await SupportChatRoom.findById(roomId).select('queueId').lean());
  const slot = await supportAssignmentService.claimTicket(agentId, wip);
  if (!slot) throw new ApiError(httpStatus.CONFLICT, `You are at full capacity (${wip} open tickets) or offline`);
  const before = await SupportChatRoom.findById(roomId).select('assignedAgent supportType priority workingHours').lean();
  const room = await SupportChatRoom.findOneAndUpdate(
    { _id: roomId, 'pendingTransfer.toAgent': agentId, 'pendingTransfer.expiresAt': { $gt: new Date() } },
    {
      $set: { assignedAgent: agentId, handoverState: 'human', firstResponseDueAt: await supportAssignmentService.firstResponseDue(before || {}) },
      $unset: { pendingTransfer: 1 },
      $push: { audit: { by: agentId, action: 'transfer:accepted', at: new Date() } },
    },
    { returnDocument: 'after' }
  );
  if (!room) {
    await supportAssignmentService.releaseTicket(agentId);
    throw new ApiError(httpStatus.GONE, 'Transfer offer expired or already handled');
  }
  // The previous owner's slot frees with the move.
  if (before && before.assignedAgent && String(before.assignedAgent) !== String(agentId)) {
    await supportAssignmentService.releaseTicket(before.assignedAgent);
  }
  await supportChatConversionService.saveInternalNote(roomId, agentId, 'Transfer accepted');
  try {
    const { User, SupportChatConversion, SupportChatRoom } = require('../models');
    const agentUser = await User.findById(agentId).select('firstName lastName').lean();
    const agentName = agentUser ? `${agentUser.firstName || ''} ${agentUser.lastName || ''}`.trim() : '';
    const joinText = agentName
      ? `${agentName} (support agent) is here to resolve your issue.`
      : 'A support agent has joined the chat to resolve your issue.';
    const roomDoc = await SupportChatRoom.findById(roomId).select('userId').lean();
    await SupportChatConversion.create({
      roomId,
      senderId: roomDoc ? roomDoc.userId : agentId,
      message: joinText,
      messageType: 'text',
      senderRole: 'system',
      visibility: 'public',
      readStatus: 'sent',
    });
    await SupportChatRoom.findByIdAndUpdate(roomId, { $set: { lastMessage: joinText, lastMessageType: 'text' } });
  } catch {
    // Announcement must never break the accept.
  }
  return room;
};

const declineTransfer = async (roomId, agent) => {
  const agentId = new mongoose.Types.ObjectId(agent);
  const room = await SupportChatRoom.findOneAndUpdate(
    { _id: roomId, 'pendingTransfer.toAgent': agentId },
    {
      $unset: { pendingTransfer: 1 },
      $push: { audit: { by: agentId, action: 'transfer:declined', at: new Date() } },
    },
    { returnDocument: 'after' }
  );
  if (!room) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  return room;
};

// Records the post-resolution rating.
//
// NOTE: this must use `$set` + `$push` as top-level operators. An earlier
// version passed `{ csat: {...}, audit: { $push: {...} } }` — a `$push` nested
// inside a replacement-style update — which stored the literal operator object
// as an audit entry. `findByIdAndUpdate` does not run validators, so nothing
// threw; the corruption only surfaced later when any `save()` validated the
// whole document and died on the action-less entry.
const submitCsat = async (roomId, score, comment) => {
  const room = await SupportChatRoom.findByIdAndUpdate(
    roomId,
    {
      $set: { csat: { score, comment, ratedAt: new Date() } },
      $push: { audit: { action: 'csat', at: new Date(), meta: { score } } },
    },
    { returnDocument: 'after', runValidators: true }
  );
  if (!room) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  return room;
};
// A resolved ticket stays reopenable for 48h so the customer continues the SAME
// thread instead of opening a duplicate ticket that an agent must then merge.
// After the window, only a human can reopen it — silently accepting a reopen
// months later would resurrect stale SLA timers and assignment state.
const REOPEN_WINDOW_MS = 48 * 60 * 60 * 1000;

const reopenSupportChat = async (roomId, userId) => {
  const room = await SupportChatRoom.findById(roomId);
  if (!room) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  // Only the room's owner reopens their own ticket. An agent calling this gets
  // 403; agents transfer instead.
  if (String(room.userId) !== String(userId)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only the ticket owner can reopen it');
  }
  if (room.status !== 'resolved') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only a resolved ticket can be reopened');
  }
  // Legacy rows resolved before `resolvedAt` existed fall back to `updatedAt`.
  // That is generous to the customer here (a newer timestamp only EXTENDS the
  // window) but any future use in a restrictive direction must not reuse it.
  const closedAt = room.resolvedAt || room.updatedAt;
  if (!closedAt || Date.now() - new Date(closedAt).getTime() > REOPEN_WINDOW_MS) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Reopen window expired. Please open a new ticket.');
  }

  room.status = 'open';
  room.reopenCount = (room.reopenCount || 0) + 1;
  room.audit = room.audit || [];
  room.audit.push({ by: room.userId, action: 'reopened', at: new Date() });

  // Sticky reopen: back to the SAME agent when they are online with headroom.
  // Otherwise the ticket re-triages through the bot instead of stranding on
  // a dead assignment.
  const prevAgent = room.assignedAgent;
  let sticky = false;
  if (prevAgent) {
    const { AgentPresence } = require('../models');
    const presence = await AgentPresence.findOne({ agentId: prevAgent, online: true }).select('_id').lean();
    const openCount = presence
      ? await SupportChatRoom.countDocuments({ assignedAgent: prevAgent, status: { $in: ['open', 'in_progress'] } })
      : 99;
    if (presence && openCount < 3) {
      room.handoverState = 'assigned';
      room.botEnabled = false;
      room.firstResponseDueAt = new Date(Date.now() + 30 * 1000);
      room.audit.push({ by: prevAgent, action: 'reopened:sticky', at: new Date() });
      sticky = true;
    }
  }
  if (!sticky) {
    room.handoverState = 'bot';
    room.botEnabled = true;
    room.assignedAgent = null;
    room.firstResponseAt = null;
    room.slaDueAt = null;
  }
  room.resolvedAt = null;
  room.resolvedBy = null;
  await room.save();

  // Visible label in the transcript: reopening must read as an event, not a
  // silent state flip the agent discovers by accident.
  const { SupportChatConversion } = require('../models');
  const reopenText = sticky
    ? 'Chat reopened — back with your previous agent.'
    : 'Chat reopened. Tell us what still needs help.';
  await SupportChatConversion.create({
    roomId: room._id,
    senderId: room.userId,
    message: reopenText,
    messageType: 'text',
    senderRole: 'system',
    visibility: 'public',
    readStatus: 'sent',
  });
  room.lastMessage = reopenText;
  room.lastMessageType = 'text';
  await room.save();
  room._sticky = sticky;
  return room;
  return room;
};

const resolveSupportChat = async (id, teamId) => {
  const detail = await SupportChatRoom.findById(id);
  if (!detail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
Object.assign(detail, {
    status: 'resolved',
    resolvedBy: teamId,
    handoverState: 'resolved',
    resolvedAt: new Date(),
  });
  detail.audit = detail.audit || [];
  detail.audit.push({ by: teamId, action: 'resolved', at: new Date() });
  await detail.save();
  if (detail.supportType === 'complaints') {
    const complaintDetail = await Complaints.findById(detail.complaints);
    if (complaintDetail && complaintDetail !== null && complaintDetail.id !== null) {
      Object.assign(complaintDetail, { status: false });
      await complaintDetail.save();
    }
  }
  if (detail.supportType === 'reports') {
    const reportDetail = await ReportIssueRestaurant.findById(detail.reportIssue);
    if (reportDetail && reportDetail !== null && reportDetail.id !== null) {
      Object.assign(reportDetail, { status: false });
      await reportDetail.save();
    }
  }

  if (detail.supportType === 'restaurant_complaints') {
    const complaintDetail = await RestaurantComplaints.findById(detail.restaurantComplaints);
    if (complaintDetail && complaintDetail !== null && complaintDetail.id !== null) {
      Object.assign(complaintDetail, { status: false });
      await complaintDetail.save();
    }
  }

  // Freed capacity: resolving drops the agent's live count, so immediately
  // offer the oldest waiting tickets to the engine. The first one with an
  // eligible agent under WIP fills the slot; the rest keep waiting.
  try {
    const supportAssignmentService = require('./support.assignment.service');
    // Release the resolver's WIP slot FIRST so the refill below can reuse it.
    await supportAssignmentService.releaseTicket(detail.assignedAgent);
    const waiting = await SupportChatRoom.find({
      status: { $in: ['open', 'in_progress'] },
      handoverState: 'queued',
    })
      .sort({ createdAt: 1 })
      .limit(3)
      .select('_id')
      .lean();
    for (const w of waiting) {
      const r = await supportAssignmentService.assignAgent(w._id);
      if (r.assigned) break;
    }
  } catch {
    // Backfill must never break the resolve itself.
  }
  return { success: true };
};

const supportTeamChat = async (teamId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = {
    supportTeam: { $in: [new mongoose.Types.ObjectId(teamId)] },
  };
  // History view: the register page now shows resolved tickets only (the
  // queue owns live work). Explicit status overrides.
  if (options.status) {
    queryCondition.status = options.status;
  } else {
    queryCondition.status = 'resolved';
  }
  // Register filters: agent scope + date window. Invalid values are ignored,
  // never fatal — a filter must not break the register.
  if (options.agent) {
    try {
      queryCondition.assignedAgent = new mongoose.Types.ObjectId(options.agent);
    } catch {
      // Ignore a malformed agent id.
    }
  }
  if (options.from || options.to) {
    const range = {};
    if (options.from && !Number.isNaN(new Date(options.from).getTime())) range.$gte = new Date(options.from);
    if (options.to && !Number.isNaN(new Date(options.to).getTime())) range.$lte = new Date(options.to);
    if (Object.keys(range).length) queryCondition.createdAt = range;
  }
  const supportQuery = [
    { $match: queryCondition },
    { $sort: { updatedAt: -1 } },
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
                  { $substrCP: ['$email', 0, 2] },
                  'XXXXX@',
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
        from: 'users',
        localField: 'supportTeam',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              firstName: 1,
              lastName: 1,
              image: 1,
            },
          },
          { $limit: 3 },
        ],
        as: 'team',
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
        orders: 1,
        booking: 1,
        purchaseSubscription: 1,
        complaints: 1,
        reportIssue: 1,
        supportType: 1,
        restaurantComplaints: 1,
        status: 1,
        updatedAt: 1,
        customer: {
          id: { $ifNull: ['$users._id', ''] },
          image: { $ifNull: ['$users.image', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        team: 1,
      },
    },
  ];
  const results = await SupportChatRoom.aggregate(supportQuery);
  const totalResults = await SupportChatRoom.countDocuments(queryCondition);
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

const adminSupportChatList = async (options) => {
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
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'supportTeam',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              firstName: 1,
              lastName: 1,
              image: 1,
            },
          },
          { $limit: 3 },
        ],
        as: 'team',
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
        team: 1,
        customer: {
          id: { $ifNull: ['$users._id', ''] },
          image: { $ifNull: ['$users.image', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
      },
    },
  ];
  const results = await SupportChatRoom.aggregate(chatListQuery);
  const totalResults = await SupportChatRoom.countDocuments();
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

const cityzenSupportChatList = async (masterId, options) => {
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
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'supportTeam',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              firstName: 1,
              lastName: 1,
              image: 1,
            },
          },
          { $limit: 3 },
        ],
        as: 'team',
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
    { $sort: { updatedAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        team: 1,
        customer: {
          id: { $ifNull: ['$users._id', ''] },
          image: { $ifNull: ['$users.image', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
      },
    },
  ];
  const results = await SupportChatRoom.aggregate(chatListQuery);
  const totalResults = await SupportChatRoom.countDocuments();
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

const exportCollection = async () => {
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
        team: 1,
        customer: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
      },
    },
  ];
  const results = await SupportChatRoom.aggregate(query);
  return results;
};

const exportRawCollection = async () => {
  const results = await SupportChatRoom.find();
  return results;
};

const importChatListCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      let type = '';
      let typeId = '';
      const issueType = [
        'orders',
        'dining',
        'tiffin_subscription',
        'complaints',
        'reports',
        'restaurant_complaints',
      ];
      if (
        issueType.includes(param.supportType) &&
        param &&
        param.userId &&
        param.userId !== null &&
        param.userId !== ''
      ) {
        type = param.supportType;
        if (
          param.supportType === 'orders' &&
          param.orders &&
          param.orders !== null &&
          param.orders !== '' &&
          param.orders !== '-'
        ) {
          typeId = param.orders;
        }
        if (
          param.supportType === 'dining' &&
          param.booking &&
          param.booking !== null &&
          param.booking !== '' &&
          param.booking !== '-'
        ) {
          typeId = param.booking;
        }
        if (
          param.supportType === 'tiffin_subscription' &&
          param.purchaseSubscription &&
          param.purchaseSubscription !== null &&
          param.purchaseSubscription !== '' &&
          param.purchaseSubscription !== '-'
        ) {
          typeId = param.purchaseSubscription;
        }
        if (
          param.supportType === 'complaints' &&
          param.complaints &&
          param.complaints !== null &&
          param.complaints !== '' &&
          param.complaints !== '-'
        ) {
          typeId = param.complaints;
        }
        if (
          param.supportType === 'reports' &&
          param.reportIssue &&
          param.reportIssue !== null &&
          param.reportIssue !== '' &&
          param.reportIssue !== '-'
        ) {
          typeId = param.reportIssue;
        }
        if (
          param.supportType === 'restaurant_complaints' &&
          param.restaurantComplaints &&
          param.restaurantComplaints !== null &&
          param.restaurantComplaints !== '' &&
          param.restaurantComplaints !== '-'
        ) {
          typeId = param.restaurantComplaints;
        }
        const user = param.userId;
        const condition = {
          userId: new mongoose.Types.ObjectId(user),
          supportType: type,
          orders: type === 'orders' ? new mongoose.Types.ObjectId(typeId) : null,
          booking: type === 'dining' ? new mongoose.Types.ObjectId(typeId) : null,
          purchaseSubscription:
            type === 'tiffin_subscription' ? new mongoose.Types.ObjectId(typeId) : null,
          complaints: type === 'complaints' ? new mongoose.Types.ObjectId(typeId) : null,
          reportIssue: type === 'reports' ? new mongoose.Types.ObjectId(typeId) : null,
          restaurantComplaints:
            type === 'restaurant_complaints' ? new mongoose.Types.ObjectId(typeId) : null,
        };
        const chatRoom = await SupportChatRoom.findOne(condition);
        const supportTeamList =
          param &&
          param.supportTeam &&
          param.supportTeam !== null &&
          param.supportTeam !== '' &&
          param.supportTeam !== '-'
            ? param.supportTeam.split(',')
            : [];
        if (!chatRoom) {
          const chatRoomData = new SupportChatRoom({
            userId: new mongoose.Types.ObjectId(user),
            supportTeam: supportTeamList,
            orders: type === 'orders' ? new mongoose.Types.ObjectId(typeId) : null,
            booking: type === 'dining' ? new mongoose.Types.ObjectId(typeId) : null,
            purchaseSubscription:
              type === 'tiffin_subscription' ? new mongoose.Types.ObjectId(typeId) : null,
            complaints: type === 'complaints' ? new mongoose.Types.ObjectId(typeId) : null,
            reportIssue: type === 'reports' ? new mongoose.Types.ObjectId(typeId) : null,
            restaurantComplaints:
              type === 'restaurant_complaints' ? new mongoose.Types.ObjectId(typeId) : null,
            supportType: type,
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
          await SupportChatRoom.create(chatRoomData);
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
    await SupportChatConversion.bulkWrite(ops);
  }
  return { success: true };
};

// Supervisor cancel of an offer addressed to someone else. Without this the
// only way out of a stale offer was the 10-minute expiry sweep, so a ticket
// could sit unreachable while a supervisor watched it.
const cancelOffer = async (roomId, byAgent = null) => {
  const byId = byAgent ? new mongoose.Types.ObjectId(byAgent) : null;
  const room = await SupportChatRoom.findOneAndUpdate(
    { _id: roomId, pendingTransfer: { $exists: true } },
    {
      $unset: { pendingTransfer: 1 },
      $push: { audit: { by: byId, action: 'offer-cancelled', at: new Date() } },
    },
    { returnDocument: 'after' }
  );
  if (!room) throw new ApiError(httpStatus.NOT_FOUND, 'No pending offer on this ticket');
  return room;
};

module.exports = {
  checkChatRoom,
  mySupportChat,
  filterChatList,
  getInitialChatSupportMessages,
  resolveSupportChat,
  supportTeamChat,
  adminSupportChatList,
  fetchMoreSupportMessages,
  cityzenSupportChatList,
  exportCollection,
  exportRawCollection,
importChatListCollection,
  importChatMessagesCollection,
  createOrGetBotRoom,
  getQueuePosition,
  transferSupportChat,
  acceptTransfer,
  declineTransfer,
  cancelOffer,
  forceAssign,
  forceResolve,
  bulkAction,
  reopenSupportChat,
  submitCsat,
};

