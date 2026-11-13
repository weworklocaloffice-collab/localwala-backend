const crypto = require('crypto');
const { status: httpStatus } = require('http-status');
const { DairySupportTicket, DairyOrder } = require('../../../models');
const ApiError = require('../../../utils/ApiError');

const ticketNo = () => `DYS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const saveTicket = async (ticket) => {
  try {
    await ticket.save();
  } catch (error) {
    if (error.name === 'VersionError') {
      throw new ApiError(httpStatus.CONFLICT, 'This support case changed while you were editing it. Refresh and try again.');
    }
    throw error;
  }
  return ticket;
};
const cleanPage = ({ page = 1, limit = 20 } = {}) => ({
  page: Math.max(1, Number(page) || 1),
  limit: Math.min(100, Math.max(1, Number(limit) || 20)),
});

const assertOrderAccess = async ({ orderId, userId, businessId, requesterType }) => {
  if (!orderId) return null;
  const query = { _id: orderId };
  if (requesterType === 'customer') query.user = userId;
  else query.business = businessId;
  const order = await DairyOrder.findOne(query).select('_id business orderNo user');
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Dairy order not found');
  return order;
};

const createTicket = async ({ requester, requesterType, businessId, body }) => {
  const order = await assertOrderAccess({
    orderId: body.order,
    userId: requester,
    businessId,
    requesterType,
  });
  const business = businessId || order?.business || null;
  const ticket = await DairySupportTicket.create({
    ticketNo: ticketNo(),
    requester,
    requesterType,
    business,
    order: order?._id,
    category: body.category,
    subject: body.subject,
    priority: body.priority || 'normal',
    messages: [{ sender: requester, senderType: requesterType, body: body.message, attachments: body.attachments || [] }],
    statusHistory: [{ toStatus: 'open', actor: requester, actorType: requesterType, note: 'Case opened' }],
    lastMessageAt: new Date(),
  });
  return ticket;
};

const listRequesterTickets = async ({ requester, requesterType, businessId, page, limit, status }) => {
  const paging = cleanPage({ page, limit });
  const query = requesterType === 'customer'
    ? { requester, requesterType }
    : { requesterType, business: businessId };
  if (status) query.status = status;
  const [tickets, totalResults] = await Promise.all([
    DairySupportTicket.find(query)
      .sort({ lastMessageAt: -1, _id: -1 })
      .skip((paging.page - 1) * paging.limit)
      .limit(paging.limit)
      .select('-messages.attachments')
      .populate('business', 'name')
      .populate('order', 'orderNo status')
      .lean(),
    DairySupportTicket.countDocuments(query),
  ]);
  return { tickets, totalResults, ...paging };
};

const getRequesterTicket = async ({ ticketId, requester, requesterType, businessId }) => {
  const query = { _id: ticketId, requesterType };
  if (requesterType === 'customer') query.requester = requester;
  else query.business = businessId;
  const ticket = await DairySupportTicket.findOne(query)
    .populate('business', 'name')
    .populate('order', 'orderNo status grandTotal')
    .populate('messages.sender', 'firstName lastName role')
    .populate('statusHistory.actor', 'firstName lastName role')
    .lean();
  if (!ticket) throw new ApiError(httpStatus.NOT_FOUND, 'Support case not found');
  return ticket;
};

const addRequesterReply = async ({ ticketId, requester, requesterType, businessId, body }) => {
  const query = { _id: ticketId, requesterType };
  if (requesterType === 'customer') query.requester = requester;
  else query.business = businessId;
  const ticket = await DairySupportTicket.findOne(query);
  if (!ticket) throw new ApiError(httpStatus.NOT_FOUND, 'Support case not found');
  if (ticket.status === 'closed') throw new ApiError(httpStatus.CONFLICT, 'This support case is closed');
  ticket.messages.push({ sender: requester, senderType: requesterType, body: body.message, attachments: body.attachments || [] });
  ticket.lastMessageAt = new Date();
  const previousStatus = ticket.status;
  if (ticket.status === 'resolved') {
    ticket.status = 'open';
    ticket.resolvedAt = undefined;
  } else if (ticket.status === 'waiting_customer') {
    ticket.status = 'in_progress';
  }
  if (ticket.status !== previousStatus) {
    ticket.statusHistory.push({
      fromStatus: previousStatus,
      toStatus: ticket.status,
      actor: requester,
      actorType: requesterType,
      note: 'Requester replied',
    });
  }
  await saveTicket(ticket);
  return ticket;
};

const listAdminTickets = async ({ page, limit, status, priority, requesterType, category, search } = {}) => {
  const paging = cleanPage({ page, limit });
  const query = {};
  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (requesterType) query.requesterType = requesterType;
  if (category) query.category = category;
  if (search) {
    const literalSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
    { ticketNo: { $regex: literalSearch, $options: 'i' } },
    { subject: { $regex: literalSearch, $options: 'i' } },
  ];
  }
  const [tickets, totalResults] = await Promise.all([
    DairySupportTicket.aggregate([
      { $match: query },
      { $addFields: { priorityRank: { $switch: {
        branches: [
          { case: { $eq: ['$priority', 'urgent'] }, then: 4 },
          { case: { $eq: ['$priority', 'high'] }, then: 3 },
          { case: { $eq: ['$priority', 'normal'] }, then: 2 },
          { case: { $eq: ['$priority', 'low'] }, then: 1 },
        ],
        default: 0,
      } } } },
      { $sort: { priorityRank: -1, lastMessageAt: 1, _id: 1 } },
      { $skip: (paging.page - 1) * paging.limit },
      { $limit: paging.limit },
      { $project: { priorityRank: 0, 'messages.attachments': 0, statusHistory: 0 } },
    ]).then((rows) => DairySupportTicket.populate(rows, [
      { path: 'requester', select: 'firstName lastName email mobile' },
      { path: 'business', select: 'name' },
      { path: 'order', select: 'orderNo status' },
    { path: 'assignedTo', select: 'firstName lastName' },
      { path: 'statusHistory.actor', select: 'firstName lastName role' },
    ])),
    DairySupportTicket.countDocuments(query),
  ]);
  return { tickets, totalResults, ...paging };
};

const getAdminTicket = async (ticketId) => {
  const ticket = await DairySupportTicket.findById(ticketId)
    .populate('requester', 'firstName lastName email mobile')
    .populate('business', 'name')
    .populate('order', 'orderNo status grandTotal')
    .populate('assignedTo', 'firstName lastName')
    .populate('messages.sender', 'firstName lastName role')
    .populate('statusHistory.actor', 'firstName lastName role')
    .lean();
  if (!ticket) throw new ApiError(httpStatus.NOT_FOUND, 'Support case not found');
  return ticket;
};

const addAdminReply = async ({ ticketId, adminId, message }) => {
  const ticket = await DairySupportTicket.findById(ticketId);
  if (!ticket) throw new ApiError(httpStatus.NOT_FOUND, 'Support case not found');
  if (ticket.status === 'closed') throw new ApiError(httpStatus.CONFLICT, 'Reopen the case before replying');
  ticket.messages.push({ sender: adminId, senderType: 'admin', body: message });
  ticket.lastMessageAt = new Date();
  const previousStatus = ticket.status;
  if (previousStatus !== 'waiting_customer') {
    ticket.status = 'waiting_customer';
    ticket.statusHistory.push({
      fromStatus: previousStatus,
      toStatus: 'waiting_customer',
      actor: adminId,
      actorType: 'admin',
      note: 'Admin replied; awaiting requester',
    });
    ticket.resolvedAt = undefined;
    ticket.closedAt = undefined;
  }
  await saveTicket(ticket);
  return ticket;
};

const updateAdminTicket = async ({ ticketId, adminId, body }) => {
  const ticket = await DairySupportTicket.findById(ticketId);
  if (!ticket) throw new ApiError(httpStatus.NOT_FOUND, 'Support case not found');
  if (body.status) {
    const previousStatus = ticket.status;
    ticket.status = body.status;
    ticket.resolvedAt = body.status === 'resolved' ? new Date() : undefined;
    ticket.closedAt = body.status === 'closed' ? new Date() : undefined;
    if (body.status !== previousStatus) {
      ticket.statusHistory.push({
        fromStatus: previousStatus,
        toStatus: body.status,
        actor: adminId,
        actorType: 'admin',
        note: 'Status updated by Dairy support',
      });
    }
  }
  if (body.priority) ticket.priority = body.priority;
  await saveTicket(ticket);
  return ticket;
};

module.exports = {
  createTicket,
  listRequesterTickets,
  getRequesterTicket,
  addRequesterReply,
  listAdminTickets,
  getAdminTicket,
  addAdminReply,
  updateAdminTicket,
};
