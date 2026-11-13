const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const ApiError = require('../../../utils/ApiError');
const { SupportChatRoom, SupportChatConversion } = require('../../../models');
const supportChatRoomService = require('../../../services/support.chat.room.service');
const supportChatConversionService = require('../../../services/support.chat.conversion.service');
const supportBotService = require('../../../services/support.bot.service');
const supportAssignmentService = require('../../../services/support.assignment.service');

const findOutletRoom = async (roomId, userId, businessId) => {
  const room = await SupportChatRoom.findOne({
    _id: roomId,
    userId,
    business: businessId,
    supportType: 'dairy_partner',
    vertical: 'dairy',
  });
  if (!room) throw new ApiError(httpStatus.NOT_FOUND, 'Dairy support conversation not found');
  return room;
};

const list = catchAsync(async (req, res) => {
  const rooms = await SupportChatRoom.find({
    userId: req.user._id,
    business: req.outletId,
    supportType: 'dairy_partner',
    vertical: 'dairy',
  })
    .select('_id business supportType status handoverState lastMessage lastMessageType updatedAt')
    .populate('business', 'name')
    .sort({ updatedAt: -1 })
    .lean();
  res.send({ chats: rooms, success: true });
});

const create = catchAsync(async (req, res) => {
  const room = await supportChatRoomService.createOrGetBotRoom(req.user._id, 'dairy_partner', req.outletId);
  const hasGreeting = await SupportChatConversion.exists({ roomId: room._id, senderRole: 'bot' });
  let greeting = null;
  if (!hasGreeting && room.handoverState === 'bot') {
    greeting = await supportBotService.handleBotTurn({
      roomId: room._id,
      userMessage: 'hello',
      type: 'dairy_partner',
      typeId: req.outletId,
    });
  }
  res.status(201).send({
    roomId: room._id,
    handoverState: room.handoverState,
    status: room.status,
    greeting,
    success: true,
  });
});

const messages = catchAsync(async (req, res) => {
  const room = await findOutletRoom(req.params.room, req.user._id, req.outletId);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const result = await supportChatConversionService.getMessages(room._id, { limit, page, sortBy: 'createdAt:asc' });
  res.send({
    ...result,
    room: {
      id: room._id,
      status: room.status,
      handoverState: room.handoverState,
      assignedAgent: room.assignedAgent || null,
    },
    queuePosition: await supportChatRoomService.getQueuePosition(room._id),
  });
});

const sendMessage = catchAsync(async (req, res) => {
  const room = await findOutletRoom(req.params.room, req.user._id, req.outletId);
  if (room.status === 'resolved') {
    throw new ApiError(httpStatus.CONFLICT, 'This conversation is resolved. Start a new conversation for more help.');
  }
  const { message } = req.body;
  await supportChatConversionService.saveNewMessage(room._id, req.user._id, message, 'text');
  if (room.assignedAgent) {
    const notifications = require('../../../services/fcm.notification.service');
    notifications.supportChatAgentAlert(room.assignedAgent, room._id, message, 'New Dairy partner message').catch(() => {});
  }

  if (room.handoverState && room.handoverState !== 'bot') {
    return res.send({ success: true, handoverState: room.handoverState, text: '', queuePosition: await supportChatRoomService.getQueuePosition(room._id) });
  }

  const reply = await supportBotService.handleBotTurn({
    roomId: room._id,
    userMessage: message,
    type: 'dairy_partner',
    typeId: req.outletId,
  });
  let handover = null;
  if (reply.intent === 'handover' || reply.intent === 'unknown') {
    handover = await supportAssignmentService.handoverToHuman(room._id, {
      reason: reply.intent === 'handover' ? 'partner-request' : 'bot-unresolved',
      by: req.user._id,
    });
  }
  res.send({
    success: true,
    text: reply.text,
    intent: reply.intent,
    handoverState: (handover && handover.room && handover.room.handoverState) || room.handoverState,
    queuePosition: await supportChatRoomService.getQueuePosition(room._id),
  });
});

const handover = catchAsync(async (req, res) => {
  const room = await findOutletRoom(req.params.room, req.user._id, req.outletId);
  const result = await supportAssignmentService.handoverToHuman(room._id, {
    reason: 'partner-request',
    by: req.user._id,
  });
  res.send({ success: true, assigned: result.assigned, reason: result.reason || null, queuePosition: await supportChatRoomService.getQueuePosition(room._id) });
});

module.exports = { list, create, messages, sendMessage, handover };
