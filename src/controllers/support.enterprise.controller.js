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

const catchAsync = require('../utils/catchAsync');
const mongoose = require('mongoose');
const logger = require('../config/logger');
const {
  supportChatRoomService,
  supportBotService,
  supportAssignmentService,
} = require('../services');
const { SupportChatRoom, SupportChatConversion, SupportQueue, CannedResponse, AgentPresence } = require('../models');

// POST /support_chat_room/bot/start — idempotent room + first bot greeting.
// This is the bot-first entry point. Creates the room in `bot` handoverState
// so a human is only assigned after `handoverToHuman`.
// Re-open guard: the greeting fires ONLY for a fresh bot room. Reopening a
// human-owned ticket must not append another "hi I can track..." over the
// agent — the transcript already has the greeting from the first open.
const botStart = catchAsync(async (req, res) => {
  const { user, type, typeId, locale } = req.body;
  const room = await supportChatRoomService.createOrGetBotRoom(user, type, typeId);
  // Ticket language drives language-aware routing later. Stamp once per turn;
  // never blank an existing value.
  if (locale) await SupportChatRoom.updateOne({ _id: room.id }, { $set: { language: locale } });
  if (room.handoverState && room.handoverState !== 'bot') {
    const snapshot = await supportBotService.getLiveSnapshot(type, typeId);
    return res.send({
      success: true,
      roomId: room.id,
      handoverState: room.handoverState,
      intent: 'handover',
      text: '',
      actions: [],
      snapshot: snapshot || room.orderSnapshot || null,
      resolved: false,
    });
  }
  const hadGreeting = await SupportChatConversion.exists({ roomId: room.id, senderRole: 'bot' });
  if (hadGreeting) {
    const snapshot = await supportBotService.getLiveSnapshot(type, typeId);
    return res.send({
      success: true,
      roomId: room.id,
      handoverState: room.handoverState,
      intent: 'greeting_seen',
      text: '',
      actions: [],
      snapshot: snapshot || room.orderSnapshot || null,
      resolved: false,
    });
  }
  const result = await supportBotService.handleBotTurn({
    roomId: room.id,
    userMessage: 'hello',
    type,
    typeId,
    locale,
  });
  res.send({ success: true, roomId: room.id, handoverState: room.handoverState, ...result });
});

// POST /support_chat_room/bot/message — customer turn, bot answers.
// Guard: once a human owns the ticket (queued/assigned/human/resolved),
// the bot stays silent. Without this a raced tap answers over the agent.
const botMessage = catchAsync(async (req, res) => {
  const { roomId, message, locale } = req.body;
  const room = await SupportChatRoom.findById(roomId);
  if (!room) throw new Error('Room not found');
  if (locale && room.language !== locale) {
    room.language = locale;
    await room.save();
  }
  if (room.handoverState && room.handoverState !== 'bot') {
    return res.send({
      success: true,
      intent: 'handover',
      text: '',
      actions: [],
      snapshot: room.orderSnapshot || null,
      handoverState: room.handoverState,
      assigned: room.handoverState === 'assigned',
      queuePosition: await supportChatRoomService.getQueuePosition(roomId),
      silent: true,
    });
  }

  // Persist the user turn first so the transcript is complete for the agent.
  await SupportChatConversion.create({
    roomId,
    senderId: room.userId,
    message,
    messageType: 'text',
    senderRole: 'user',
    visibility: 'public',
    readStatus: 'sent',
  });
  room.lastMessage = message;
  room.lastMessageType = 'text';
  await room.save();

  const typeId =
    room.orders || room.booking || room.purchaseSubscription || room.complaints || null;
  const result = await supportBotService.handleBotTurn({
    roomId,
    userMessage: message,
    type: room.supportType,
    typeId,
    locale,
  });

  // Auto-handover when the user asks for a human, or the bot cannot help.
  let handover = null;
  if (result.intent === 'handover' || (!result.resolved && result.intent === 'unknown')) {
    handover = await supportAssignmentService.handoverToHuman(roomId, {
      reason: result.intent === 'handover' ? 'user-request' : 'bot-unresolved',
    });
  }

  res.send({
    success: true,
    intent: result.intent,
    text: result.text,
    actions: result.actions,
    snapshot: result.snapshot,
    assigned: handover ? handover.assigned : false,
    queuePosition: await supportChatRoomService.getQueuePosition(roomId),
  });
});

// POST /support_chat_room/:id/handover — explicit bot -> human.
const handover = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const result = await supportAssignmentService.handoverToHuman(id, { reason: reason || 'user-request' });
  res.send({
    success: true,
    assigned: result.assigned,
    reason: result.reason || null,
    agentId: result.agentId || null,
  });
});

// POST /support_chat_room/:id/transfer — agent -> agent.
const transfer = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { toAgent, reason } = req.body;
  const fromAgent = (req.user && (req.user._id || req.user.id)) || null;
  try {
    const room = await supportChatRoomService.transferSupportChat(id, toAgent, reason, fromAgent);
    res.send({ success: true, assignedAgent: room.assignedAgent, offered: !!room.pendingTransfer });
  } catch (e) {
    // 409 covers two different refusals - lost the atomic claim, or the target
    // is full/offline. The service already wrote the real reason; forwarding a
    // hardcoded "Already taken" hid the WIP refusal behind a race-condition
    // message.
    if (e.statusCode === 409) {
      res.status(409).send({ success: false, code: 409, message: e.message || 'Transfer refused', extra: null });
      return;
    }
    throw e;
  }
});

// POST /support_team/chat/:id/force-resolve — supervisor close with reason.
const forceResolve = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const byAgent = (req.user && (req.user._id || req.user.id)) || null;
  await supportChatRoomService.forceResolve(id, byAgent, reason);
  res.send({ success: true });
});

// POST /support_team/chat/bulk — supervisor resolve-many / move-many.
const bulkAction = catchAsync(async (req, res) => {
  const { ids, action, toAgent, reason } = req.body;
  const byAgent = (req.user && (req.user._id || req.user.id)) || null;
  const results = await supportChatRoomService.bulkAction(ids, action, { toAgent, reason, byAgent });
  res.send({ success: true, results });
});

// POST /support_team/chat/transfer/:id/cancel-offer — supervisor drops an
// offer addressed to another agent so the ticket is not parked until expiry.
const cancelOffer = catchAsync(async (req, res) => {
  const { id } = req.params;
  const byAgent = (req.user && (req.user._id || req.user.id)) || null;
  await supportChatRoomService.cancelOffer(id, byAgent);
  res.send({ success: true });
});

// POST /support_team/chat/:id/force-assign — supervisor direct move, no
// offer step. Audited as forced with the supervisor named.
const forceAssign = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { toAgent, reason } = req.body;
  const byAgent = (req.user && (req.user._id || req.user.id)) || null;
  const room = await supportChatRoomService.forceAssign(id, toAgent, reason, byAgent);
  res.send({ success: true, assignedAgent: room.assignedAgent });
});

// POST /support_team/chat/:id/accept — receiver takes an offering.
const acceptTransfer = catchAsync(async (req, res) => {
  const { id } = req.params;
  const agent = (req.user && (req.user._id || req.user.id)) || req.body.agent;
  const room = await supportChatRoomService.acceptTransfer(id, agent);
  res.send({ success: true, assignedAgent: room.assignedAgent });
});

// POST /support_team/chat/transfer/:id/decline — receiver passes; owner keeps it.
const declineTransfer = catchAsync(async (req, res) => {
  const { id } = req.params;
  const agent = (req.user && (req.user._id || req.user.id)) || req.body.agent;
  await supportChatRoomService.declineTransfer(id, agent);
  res.send({ success: true });
});

// POST /support_chat_room/:id/internal_note — agent-only note.
const internalNote = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { sender, note } = req.body;
  const room = await SupportChatRoom.findById(id);
  if (!room) throw new Error('Room not found');
  await SupportChatConversion.create({
    roomId: id,
    senderId: sender,
    message: note,
    messageType: 'text',
    senderRole: 'agent',
    visibility: 'internal',
    readStatus: 'sent',
  });
  res.send({ success: true });
});

// POST /support_chat_room/:id/csat — post-resolution rating.
const submitCsat = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { score, comment } = req.body;
  const room = await supportChatRoomService.submitCsat(id, score, comment);
  // A poor score is the strongest escalation signal available - stronger than
  // any timer - so it pages supervisors immediately instead of waiting for the
  // next sweep.
  if (typeof score === 'number' && score <= 2) {
    try {
      // eslint-disable-next-line global-require
      await require('../services/support.escalation.service').escalateForCsat(id, score);
    } catch (e) {
      logger.error(`CSAT escalation failed for room ${id}: ${e.message}`);
    }
  }
  res.send({ success: true, csat: room.csat });
});

// GET /support_chat_room/:id/queue — position + EWT for the customer header.
const queueStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const room = await SupportChatRoom.findById(id)
    .select('handoverState assignedAgent slaDueAt status firstResponseAt firstResponseDueAt')
    .populate('assignedAgent', 'firstName lastName image')
    .lean();
  if (!room) throw new Error('Room not found');
  res.send({
    success: true,
    handoverState: room.handoverState,
    assignedAgent: room.assignedAgent || null,
    slaDueAt: room.slaDueAt,
    firstResponseAt: room.firstResponseAt || null,
    firstResponseDueAt: room.firstResponseDueAt || null,
    status: room.status,
    queuePosition: await supportChatRoomService.getQueuePosition(id),
  });
});

// GET /support_chat_room/queue — agent inbox: mine | unassigned | breached | all
const agentQueue = catchAsync(async (req, res) => {
  const { view = 'all', agent, q } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const filter = { status: { $in: ['open', 'in_progress'] } };

  // Queue is human work only: bot-owned rooms (handoverState 'bot') that
  // never asked for a human must not flood it. Pre-enterprise rooms without
  // the field are classic human tickets, so they stay visible.
  filter.$and = [
    {
      $or: [
        { handoverState: { $in: ['queued', 'assigned', 'human'] } },
        { handoverState: { $exists: false } },
      ],
    },
  ];

  if (view === 'mine' && agent) filter.assignedAgent = agent;
  if (view === 'unassigned') filter.assignedAgent = { $exists: false };
  // Breached = resolution overdue OR first reply overdue (assigned, 30s
  // passed, still no agent message).
  if (view === 'breached') {
    filter.$or = [
      { slaDueAt: { $lt: new Date() } },
      {
        firstResponseDueAt: { $lt: new Date() },
        $or: [{ firstResponseAt: null }, { firstResponseAt: { $exists: false } }],
      },
    ];
  }
  // Offered transfers: waiting on THIS agent's accept. Without this view an
  // offer is invisible to its receiver until they stumble into the thread.
  if (view === 'offered' && agent) filter['pendingTransfer.toAgent'] = agent;
  // Scope isolation: non-supervisors never see the full floor. `all` degrades
  // to own + unassigned + offered-to-me — the panel hides the tab, but the
  // server enforces it (tabs are cosmetic, filters are not).
  const callerRole = req.user && req.user.role;
  if (view === 'all' && callerRole !== 'supportSupervisor' && agent) {
    try {
      const me = new mongoose.Types.ObjectId(agent);
      filter.$or = [
        { assignedAgent: me },
        { assignedAgent: { $exists: false } },
        { 'pendingTransfer.toAgent': me },
      ];
    } catch {
      // Malformed agent id: fall through unscoped rather than 500.
    }
  }
  if (q) filter.lastMessage = { $regex: String(q), $options: 'i' };

  const [chats, totalResults] = await Promise.all([
    SupportChatRoom.find(filter)
      .sort({ slaDueAt: 1, updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'firstName lastName image mobile')
      .populate('assignedAgent', 'firstName lastName image')
      .populate('pendingTransfer.toAgent', 'firstName lastName')
      .lean(),
    SupportChatRoom.countDocuments(filter),
  ]);

  // lean() skips the `id` virtual: without this every row's `item.id` is
  // undefined, so view (message/undefined) and accept (guard return) silently
  // do nothing. Shape rows for the table once, here.
  // `source` badge: latest of engine-`assigned` (auto) vs `transfer`
  // (manual Accept/takeover) wins, so the queue shows HOW the ticket landed.
  const shaped = (chats || []).map((c) => {
    let source = null;
    const audit = Array.isArray(c.audit) ? c.audit : [];
    for (let i = audit.length - 1; i >= 0; i -= 1) {
      const a = audit[i] && audit[i].action;
      if (a === 'transfer') {
        source = 'manual';
        break;
      }
      if (a === 'assigned') {
        source = 'auto';
        break;
      }
    }
    // Offered-transfer flag for the queue badge. Expired offers read as none.
    const pt = c.pendingTransfer;
    const offered =
      pt && pt.toAgent && (!pt.expiresAt || new Date(pt.expiresAt) > new Date())
        ? String(pt.toAgent._id || pt.toAgent)
        : null;
    return { ...c, id: String(c._id), source, offeredTo: offered };
  });

  res.send({
    success: true,
    chats: shaped,
    totalResults,
    totalPages: Math.ceil(totalResults / limit),
    page,
    limit,
  });
});

// GET /support_team/chat/search?q=&roomId=&limit=&page= — server-side message
// search across tickets (or inside one). The old list search was page-local,
// so anything outside the loaded page was unfindable.
const searchMessages = catchAsync(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    res.send({ success: true, matches: [], totalResults: 0 });
    return;
  }
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = { message: { $regex: escaped, $options: 'i' } };
  if (req.query.roomId) match.roomId = new mongoose.Types.ObjectId(req.query.roomId);

  const [matches, totalResults] = await Promise.all([
    SupportChatConversion.find(match)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('roomId senderId senderRole message messageType createdAt')
      .populate({ path: 'roomId', select: 'userId supportType status handoverState', populate: { path: 'userId', select: 'firstName lastName' } })
      .lean(),
    SupportChatConversion.countDocuments(match),
  ]);

  res.send({
    success: true,
    matches: (matches || []).map((m) => ({
      messageId: String(m._id),
      roomId: String(m.roomId && m.roomId._id ? m.roomId._id : m.roomId),
      senderRole: m.senderRole,
      message: String(m.message || '').slice(0, 200),
      messageType: m.messageType,
      createdAt: m.createdAt,
      customer:
        m.roomId && m.roomId.userId
          ? `${m.roomId.userId.firstName || ''} ${m.roomId.userId.lastName || ''}`.trim()
          : '',
      supportType: (m.roomId && m.roomId.supportType) || '',
    })),
    totalResults,
  });
});

// POST /support_team/canned — agent-authored macro. Intent is derived, never
// free-typed, so the in-thread `/` picker keeps working with zero taxonomy
// discipline from the agent.
const createCanned = catchAsync(async (req, res) => {
  const { title, body, locale = 'en', audience = 'agent' } = req.body;
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const intent = `macro_${slug || 'reply'}`;
  const existing = await CannedResponse.findOne({ intent, locale }).select('_id').lean();
  if (existing) {
    res.status(409).send({ success: false, code: 409, message: 'A reply with this title already exists', extra: null });
    return;
  }
  const created = await CannedResponse.create({
    intent,
    title: String(title).trim(),
    body: String(body).trim(),
    locale,
    audience: audience === 'customer' ? 'customer' : 'agent',
    // Approval workflow: supervisors publish instantly; agents submit for
    // review (inactive until approved). The pickers only read active rows.
    isActive: req.user && req.user.role === 'supportSupervisor',
  });
  res.send({ success: true, id: created._id, intent, needsApproval: !created.isActive });
});

// PATCH /support_team/canned/:id — edit body/title or activate/deactivate.
const updateCanned = catchAsync(async (req, res) => {
  const { id } = req.params;
  const patch = {};
  if (req.body.title !== undefined) patch.title = String(req.body.title).trim();
  if (req.body.body !== undefined) patch.body = String(req.body.body).trim();
  if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;
  if (req.body.audience === 'customer' || req.body.audience === 'agent') patch.audience = req.body.audience;
  const updated = await CannedResponse.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after' }).lean();
  if (!updated) {
    res.status(404).send({ success: false, code: 404, message: 'Not found', extra: null });
    return;
  }
  res.send({ success: true });
});

// GET /support_chat_room/canned — agent macros.
const listCanned = catchAsync(async (req, res) => {
  const { locale, intent, all } = req.query;
  // Management page passes all=1 to see deactivated rows too.
  const base = all ? {} : { isActive: true };
  const filter = { ...base };
  if (locale) filter.locale = locale;
  if (intent) filter.intent = intent;
  let canned = await CannedResponse.find(filter).sort({ updatedAt: -1 }).lean();
  // Locale fallback: a panel set to Hindi with only English rows seeded must
  // still offer the English set, not an empty picker.
  if (!canned.length && locale && locale !== 'en') {
    canned = await CannedResponse.find({ ...base, locale: 'en' }).sort({ updatedAt: -1 }).lean();
  }
  res.send({ success: true, canned });
});

// GET /support_team/chat/:id/export — one-click transcript + audit trail as
// CSV for disputes, QA, and training. Built manually (no new deps): every
// field quoted, quotes doubled, BOM for Excel.
const exportTranscript = catchAsync(async (req, res) => {
  const { id } = req.params;
  const room = await SupportChatRoom.findById(id)
    .populate('userId', 'firstName lastName')
    .populate('assignedAgent', 'firstName lastName')
    .lean();
  if (!room) {
    res.status(404).send({ success: false, code: 404, message: 'Not found', extra: null });
    return;
  }
  const messages = await SupportChatConversion.find({ roomId: id })
    .sort({ createdAt: 1 })
    .select('senderRole message messageType createdAt readStatus visibility')
    .lean();
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    'section,at,role,detail,message,read',
    ...messages.map((m) =>
      [
        'message',
        m.createdAt ? new Date(m.createdAt).toISOString() : '',
        m.senderRole,
        m.messageType,
        m.message,
        m.readStatus,
      ]
        .map(cell)
        .join(',')
    ),
    ...(room.audit || []).map((a) =>
      [
        'audit',
        a.at ? new Date(a.at).toISOString() : '',
        '',
        a.action,
        (a.meta && JSON.stringify(a.meta)) || '',
        '',
      ]
        .map(cell)
        .join(',')
    ),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="support-transcript-${id}.csv"`);
  res.send(`\uFEFF${lines.join('\n')}`);
});

// GET /support_team/user/:userId/recent-orders — agent order picker source.
// Last handful across verticals, newest first. Lets the agent pin a vague
// ticket to the right entity in one tap instead of interrogating.
const recentOrders = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const { Orders, DiningBooking, UserPurchasedTiffinSubscription } = require('../models');
  const [orders, bookings, subs] = await Promise.all([
    Orders.find({ user: userId }).sort({ createdAt: -1 }).limit(5).select('orderNo status grandTotal createdAt').lean(),
    DiningBooking.find({ user: userId }).sort({ createdAt: -1 }).limit(3).select('status grandTotal createdAt').lean(),
    UserPurchasedTiffinSubscription.find({ user: userId }).sort({ createdAt: -1 }).limit(2).select('status grandTotal createdAt').lean(),
  ]);
  const items = [
    ...(orders || []).map((o) => ({ kind: 'orders', id: String(o._id), label: `Order #${o.orderNo || ''}`, status: o.status, total: o.grandTotal, at: o.createdAt })),
    ...(bookings || []).map((b) => ({ kind: 'dining', id: String(b._id), label: 'Dining booking', status: b.status, total: b.grandTotal, at: b.createdAt })),
    ...(subs || []).map((s) => ({ kind: 'tiffin_subscription', id: String(s._id), label: 'Tiffin subscription', status: s.status, total: s.grandTotal, at: s.createdAt })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 6);
  res.send({ success: true, items });
});

// POST /support_team/chat/:id/pin-subject — pin the ticket to an entity.
// Re-threads supportType + the matching ref, clears the others, and audits.
// The wrong-order refund/cancel is exactly what this prevents.
const pinSubject = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { kind, entityId } = req.body;
  const { Orders, DiningBooking, UserPurchasedTiffinSubscription } = require('../models');
  const byKind = { orders: Orders, dining: DiningBooking, tiffin_subscription: UserPurchasedTiffinSubscription };
  const Model = byKind[kind];
  if (!Model) {
    res.status(400).send({ success: false, code: 400, message: 'Unknown subject kind', extra: null });
    return;
  }
  const entity = await Model.findById(entityId).select('_id').lean();
  if (!entity) {
    res.status(404).send({ success: false, code: 404, message: 'Subject not found', extra: null });
    return;
  }
  const field = kind === 'orders' ? 'orders' : kind === 'dining' ? 'booking' : 'purchaseSubscription';
  const unset = { orders: 1, booking: 1, purchaseSubscription: 1 };
  delete unset[field];
  const room = await SupportChatRoom.findByIdAndUpdate(
    id,
    {
      $set: { supportType: kind, [field]: entity._id },
      $unset: unset,
      $push: { audit: { action: 'subject:pinned', at: new Date(), meta: { kind, entityId } } },
    },
    { returnDocument: 'after' }
  );
  if (!room) {
    res.status(404).send({ success: false, code: 404, message: 'Not found', extra: null });
    return;
  }
  res.send({ success: true });
});

// POST /support_team/presence/status {agent, availability} — the manual
// Available/Busy/Offline toggle. Heartbeats never overwrite it; only logout
// (offline) and this endpoint change it.
const presenceStatus = catchAsync(async (req, res) => {
  const { agent, availability } = req.body;
  if (!['available', 'busy', 'offline'].includes(availability)) {
    res.status(400).send({ success: false, code: 400, message: 'Unknown availability', extra: null });
    return;
  }
  // `online` and `availability` move together. Before, only the string moved:
  // toggling back to Available left the cron-swept `online: false` in place, so
  // the supervisor roster kept rendering grey "offline" for an agent who had
  // just declared themselves free — and whose own header said "Available".
  const presence = await AgentPresence.findOneAndUpdate(
    { agentId: agent },
    {
      $set: {
        availability,
        lastSeen: new Date(),
        online: availability !== 'offline',
        ...(availability === 'offline' ? { currentRooms: [] } : {}),
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
  res.send({ success: true, availability: presence.availability, online: presence.online });
});

// POST /support_team/push/web-token — register an agent browser for web push.
// One row per agent (deviceId `web-<agent>`): re-login refreshes the token,
const registerWebToken = catchAsync(async (req, res) => {
  const { agent, token } = req.body;
  const PushNotificationToken = require('../models/push.notitication.token.model');
  await PushNotificationToken.updateOne(
    { user: agent, deviceType: 'web' },
    { $set: { user: agent, token, deviceType: 'web', deviceId: `web-${agent}` } },
    { upsert: true }
  );
  res.send({ success: true });
});

// GET /users/support_chat_room/chips — customer-facing quick replies for the
// human state. Audience-filtered, locale-aware; the app falls back to its
// built-in set when this is empty or unreachable.
const customerChips = catchAsync(async (req, res) => {
  const { locale = 'en' } = req.query;
  const chips = await CannedResponse.find({ audience: 'customer', isActive: true, locale })
    .sort({ updatedAt: -1 })
    .select('title body')
    .lean();
  res.send({
    success: true,
    chips: (chips || []).map((c) => ({ label: c.title, message: c.body })),
  });
});

// GET /support_team/agents/online — transfer picker source: online agents
// with current live load, so the offering agent picks someone who can
// actually take the ticket.
const onlineAgents = catchAsync(async (req, res) => {
  const { User, AgentPresence, SupportChatRoom } = require('../models');
  const presences = await AgentPresence.find({
    online: true,
    availability: { $in: ['available', null] },
    lastSeen: { $gte: new Date(Date.now() - 90 * 1000) },
  })
    .select('agentId')
    .lean();
  const ids = (presences || []).map((p) => p.agentId);
  if (!ids.length) {
    res.send({ success: true, agents: [] });
    return;
  }
  const [users, load, langs] = await Promise.all([
    User.find({ _id: { $in: ids } }).select('firstName lastName image').lean(),
    SupportChatRoom.aggregate([
      { $match: { status: { $in: ['open', 'in_progress'] }, assignedAgent: { $in: ids } } },
      { $group: { _id: '$assignedAgent', open: { $sum: 1 } } },
    ]),
    User.find({ _id: { $in: ids } }).select('languages').lean(),
  ]);
  const loadMap = {};
  for (const l of load) loadMap[String(l._id)] = l.open;
  const langMap = {};
  for (const u of langs) langMap[String(u._id)] = u.languages || [];
  res.send({
    success: true,
    agents: users.map((u) => ({
      id: String(u._id),
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
      image: u.image || '',
      openNow: loadMap[String(u._id)] || 0,
      languages: langMap[String(u._id)] || [],
    })),
  });
});

// PATCH /support_team/queues/:id — staff members, tune WIP, toggle active.
// Supervisor-only: this is the control plane of auto-assign.
const updateQueue = catchAsync(async (req, res) => {
  const { id } = req.params;
  const patch = {};
  if (Array.isArray(req.body.members)) patch.members = req.body.members;
  if (req.body.wipLimit !== undefined) patch.wipLimit = Math.min(Math.max(parseInt(req.body.wipLimit, 10) || 3, 1), 20);
  if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;
  // Working hours are validated, not trusted: this shape is walked by the SLA
  // clock on every assignment, so a malformed window (minutes > 1440, a string,
  // reversed bounds) would either freeze a deadline or loop the clock.
  if (req.body.workingHours !== undefined) {
    const wh = req.body.workingHours || {};
    const days = {};
    const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const incoming = (wh && wh.days) || {};
    let invalid = false;
    for (const k of keys) {
      const list = incoming[k];
      if (list === undefined || list === null) continue;
      if (!Array.isArray(list)) { invalid = true; break; }
      const cleaned = [];
      for (const w of list) {
        if (!Array.isArray(w) || w.length !== 2) { invalid = true; break; }
        const a = Number(w[0]);
        const b = Number(w[1]);
        if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > 1440 || a >= b) { invalid = true; break; }
        cleaned.push([a, b]);
      }
      if (invalid) break;
      if (cleaned.length) days[k] = cleaned.sort((x, y) => x[0] - y[0]);
    }
    if (invalid) {
      res.status(400).send({
        success: false,
        code: 400,
        message: 'workingHours must be {timezone, days:{mon:[[startMin,endMin]]}} with 0 <= start < end <= 1440',
        extra: null,
      });
      return;
    }
    const tz = String((wh && wh.timezone) || 'Asia/Kolkata');
    try {
      // eslint-disable-next-line no-new
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      res.status(400).send({ success: false, code: 400, message: `Unknown timezone: ${tz}`, extra: null });
      return;
    }
    patch.workingHours = { timezone: tz, days };
  }
  const queue = await SupportQueue.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after' })
    .populate('members', 'firstName lastName image')
    .lean();
  if (!queue) {
    res.status(404).send({ success: false, code: 404, message: 'Not found', extra: null });
    return;
  }
  res.send({ success: true, queue });
});

// --- Ticket merge -----------------------------------------------------------
// GET /support_team/chat/:id/duplicates - ranked suggestions only. Detection
// NEVER merges on its own: a similarity score is a hint for a human, and an
// automatic merge can quietly destroy the separation between two real problems.
const detectDuplicates = catchAsync(async (req, res) => {
  const { id } = req.params;
  const supportMergeService = require('../services/support.merge.service');
  const threshold = Math.min(Math.max(parseFloat(req.query.threshold) || 0.45, 0.05), 1);
  const suggestions = await supportMergeService.detectDuplicates(id, threshold);
  res.send({ success: true, threshold, suggestions });
});

const mergeTickets = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { into } = req.body;
  const byAgent = (req.user && (req.user._id || req.user.id)) || null;
  const supportMergeService = require('../services/support.merge.service');
  const out = await supportMergeService.mergeTickets(id, into, byAgent);
  res.send({ success: true, ...out });
});

const unmergeTicket = catchAsync(async (req, res) => {
  const { id } = req.params;
  const byAgent = (req.user && (req.user._id || req.user.id)) || null;
  const supportMergeService = require('../services/support.merge.service');
  await supportMergeService.unmergeTicket(id, byAgent);
  res.send({ success: true });
});

// --- Support QA -------------------------------------------------------------
// GET /support_team/qa/sample - risk-weighted tickets waiting for review.
const qaSample = catchAsync(async (req, res) => {
  const reviewerId = (req.user && (req.user._id || req.user.id)) || null;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const agentId = req.query.agent && mongoose.Types.ObjectId.isValid(String(req.query.agent))
    ? String(req.query.agent)
    : null;
  const supportQaService = require('../services/support.qa.service');
  const tickets = await supportQaService.sampleForReview(reviewerId, { days, limit, agentId });
  res.send({ success: true, days, tickets });
});

// POST /support_team/qa/review - record a review against a ticket.
const qaReview = catchAsync(async (req, res) => {
  const reviewerId = (req.user && (req.user._id || req.user.id)) || null;
  if (!reviewerId) {
    res.status(401).send({ success: false, code: 401, message: 'Unauthorized', extra: null });
    return;
  }
  const { roomId, scores, comment } = req.body;
  if (!roomId || !mongoose.Types.ObjectId.isValid(String(roomId))) {
    res.status(400).send({ success: false, code: 400, message: 'roomId is required', extra: null });
    return;
  }
  const supportQaService = require('../services/support.qa.service');
  const out = await supportQaService.createReview(roomId, reviewerId, { scores, comment });
  if (out.error) {
    res.status(400).send({ success: false, code: 400, message: out.error, extra: null });
    return;
  }
  res.send({ success: true, review: out.review });
});

// GET /support_team/qa/quality - per-agent rubric averages.
// Agents may only ask for themselves; supervisors may pass ?agent= or see all.
const qaQuality = catchAsync(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const supportQaService = require('../services/support.qa.service');
  const out = await supportQaService.agentQuality(days);
  const role = req.user && req.user.role;
  const callerId = req.user && (req.user._id || req.user.id);
  if (role === 'supportSupervisor') {
    res.send({ success: true, ...out });
    return;
  }
  // An agent gets their own row only. Handing back the whole team would leak
  // every colleague's scores to every agent.
  res.send({
    success: true,
    days,
    agents: out.agents.filter((a) => String(a.agentId) === String(callerId)),
  });
});

// GET /support_team/qa/reviews - existing reviews for a ticket or an agent.
const qaReviews = catchAsync(async (req, res) => {
  const { SupportQaReview } = require('../models');
  const role = req.user && req.user.role;
  const callerId = (req.user && (req.user._id || req.user.id)) || null;
  const query = {};
  if (req.query.roomId && mongoose.Types.ObjectId.isValid(String(req.query.roomId))) {
    query.roomId = new mongoose.Types.ObjectId(String(req.query.roomId));
  }
  if (req.query.agent && mongoose.Types.ObjectId.isValid(String(req.query.agent))) {
    if (role !== 'supportSupervisor' && String(req.query.agent) !== String(callerId)) {
      res.status(403).send({ success: false, code: 403, message: 'Forbidden', extra: null });
      return;
    }
    query.agentId = new mongoose.Types.ObjectId(String(req.query.agent));
  } else if (role !== 'supportSupervisor') {
    query.agentId = new mongoose.Types.ObjectId(String(callerId));
  }
  const reviews = await SupportQaReview.find(query)
    .populate('reviewerId', 'firstName lastName role')
    .populate('agentId', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.send({ success: true, reviews });
});

// --- Shift coverage ---------------------------------------------------------
// Validate a shift payload. The sweep reads `days` every 5 minutes, so the same
// bounds check the queue working-hours use applies here.
const sanitiseShift = (body) => {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const incoming = (body && body.days) || {};
  const days = {};
  for (const k of keys) {
    const list = incoming[k];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) return { error: `days.${k} must be an array` };
    const cleaned = [];
    for (const w of list) {
      if (!Array.isArray(w) || w.length !== 2) return { error: `days.${k} entries must be [startMin, endMin]` };
      const a = Number(w[0]);
      const b = Number(w[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > 1440 || a >= b) {
        return { error: `days.${k} must satisfy 0 <= start < end <= 1440` };
      }
      cleaned.push([a, b]);
    }
    if (cleaned.length) days[k] = cleaned.sort((x, y) => x[0] - y[0]);
  }
  const tz = String((body && body.timezone) || 'Asia/Kolkata');
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    return { error: `Unknown timezone: ${tz}` };
  }
  return { value: { timezone: tz, days } };
};

const listShifts = catchAsync(async (req, res) => {
  const { SupportShift } = require('../models');
  const query = { isActive: true };
  if (req.query.agent && mongoose.Types.ObjectId.isValid(String(req.query.agent))) {
    query.agentId = new mongoose.Types.ObjectId(String(req.query.agent));
  }
  const shifts = await SupportShift.find(query)
    .populate('agentId', 'firstName lastName image role')
    .lean();
  res.send({ success: true, shifts });
});

// Upsert on agentId: one shift per agent, so a supervisor edits in place rather
// than accumulating duplicates that the sweep would race over.
const setShift = catchAsync(async (req, res) => {
  const { SupportShift } = require('../models');
  const { agent } = req.params;
  if (!mongoose.Types.ObjectId.isValid(String(agent))) {
    res.status(400).send({ success: false, code: 400, message: 'Invalid agent', extra: null });
    return;
  }
  const sanitised = sanitiseShift(req.body);
  if (sanitised.error) {
    res.status(400).send({ success: false, code: 400, message: sanitised.error, extra: null });
    return;
  }
  const patch = { ...sanitised.value };
  if (req.body.name !== undefined) patch.name = String(req.body.name).trim() || 'Shift';
  if (req.body.autoOffline !== undefined) patch.autoOffline = !!req.body.autoOffline;
  if (req.body.isActive !== undefined) patch.isActive = !!req.body.isActive;
  const shift = await SupportShift.findOneAndUpdate(
    { agentId: new mongoose.Types.ObjectId(String(agent)) },
    {
      $set: patch,
      $setOnInsert: { agentId: new mongoose.Types.ObjectId(String(agent)) },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  )
    .populate('agentId', 'firstName lastName image role')
    .lean();
  res.send({ success: true, shift });
});

const deleteShift = catchAsync(async (req, res) => {
  const { SupportShift } = require('../models');
  const { agent } = req.params;
  // Soft delete: an audit trail that references a shift must still resolve.
  await SupportShift.updateOne(
    {
      agentId: mongoose.Types.ObjectId.isValid(String(agent)) ? new mongoose.Types.ObjectId(String(agent)) : null,
    },
    { $set: { isActive: false } }
  );
  res.send({ success: true });
});

// GET /support_team/coverage — who is scheduled vs who is actually here.
const coverageBoard = catchAsync(async (req, res) => {
  // eslint-disable-next-line global-require
  const board = await require('../services/support.coverage.service').coverageBoard();
  res.send({ success: true, ...board });
});

// GET /support_team/agents/all — staffing roster: every agent + supervisor.
const allAgents = catchAsync(async (req, res) => {
  const { User, AgentPresence } = require('../models');
  const users = await User.find({ role: { $in: ['supportTeam', 'supportSupervisor'] } })
    .select('firstName lastName image role languages')
    .sort({ firstName: 1 })
    .lean();
  const presences = await AgentPresence.find({
    agentId: { $in: users.map((u) => u._id) },
  })
    .select('agentId online availability lastSeen openTickets offShift preShiftAvailability')
    .lean();
  const presMap = {};
  for (const p of presences) presMap[String(p.agentId)] = p;
  res.send({
    success: true,
    agents: (users || []).map((u) => {
      const p = presMap[String(u._id)];
      const fresh = p && p.lastSeen && Date.now() - new Date(p.lastSeen).getTime() < 90 * 1000;
      const offShift = !!(p && p.offShift);
      // An off-shift agent is NOT online for routing, even with a live socket:
      // they are outside their own rostered hours, which is exactly the window
      // where an unattended Available toggle does damage.
      const online = !!(p && p.online && fresh && !offShift);
      const availability = (p && p.availability) || 'available';
      // One resolved field, so the panel cannot render the raw pair wrong.
      // `online: false` and a hand-picked `offline` both mean offline; a live
      // heartbeat otherwise reports the agent's declared state verbatim.
      const status = online && availability !== 'offline' ? availability : 'offline';
      return {
        id: String(u._id),
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
        image: u.image || '',
        role: u.role,
        languages: u.languages || [],
        online,
        availability,
        status,
        offShift,
        lastSeen: (p && p.lastSeen) || null,
        openNow: (p && p.openTickets) || 0,
      };
    }),
  });
});

// GET /support_team/sla-policies — every type×priority timing.
const listSlaPolicies = catchAsync(async (req, res) => {
  const { SlaPolicy } = require('../models');
  const policies = await SlaPolicy.find({}).sort({ supportType: 1, priority: 1 }).lean();
  res.send({ success: true, policies });
});

// PATCH /support_team/sla-policies/:id — retune first-response/resolution.
const updateSlaPolicy = catchAsync(async (req, res) => {
  const { SlaPolicy } = require('../models');
  const { id } = req.params;
  const patch = {};
  if (req.body.firstResponseSec !== undefined) {
    patch.firstResponseSec = Math.min(Math.max(parseInt(req.body.firstResponseSec, 10) || 30, 5), 86400);
  }
  if (req.body.resolutionSec !== undefined) {
    patch.resolutionSec = Math.min(Math.max(parseInt(req.body.resolutionSec, 10) || 3600, 60), 604800);
  }
  // Escalation ladder config. Validated here rather than trusted from the panel:
  // a bad mode would silently disable paging for a whole policy.
  if (req.body.escalationMode !== undefined) {
    const mode = String(req.body.escalationMode);
    if (!['off', 'notify', 'reassign'].includes(mode)) {
      res.status(400).send({ success: false, code: 400, message: 'escalationMode must be off|notify|reassign', extra: null });
      return;
    }
    patch.escalationMode = mode;
  }
  if (req.body.escalateAfterSec !== undefined) {
    patch.escalateAfterSec = Math.min(Math.max(parseInt(req.body.escalateAfterSec, 10) || 600, 0), 86400);
  }
  if (req.body.escalateTo !== undefined) {
    const list = Array.isArray(req.body.escalateTo) ? req.body.escalateTo : [];
    patch.escalateTo = list
      .filter((x) => mongoose.Types.ObjectId.isValid(String(x)))
      .map((x) => new mongoose.Types.ObjectId(String(x)));
  }
  const policy = await SlaPolicy.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after' }).lean();
  if (!policy) {
    res.status(404).send({ success: false, code: 404, message: 'Not found', extra: null });
    return;
  }
  res.send({ success: true, policy });
});

// POST /support_team/broadcast — supervisor one-to-all: outage notes, policy
// changes, shift ends. Fans out to online agents' browsers (push + in-panel
// toast via the foreground handler). Best-effort per token batch.
const broadcast = catchAsync(async (req, res) => {
  const { message } = req.body;
  const { AgentPresence } = require('../models');
  const PushNotificationToken = require('../models/push.notitication.token.model');
  const online = await AgentPresence.find({
    online: true,
    lastSeen: { $gte: new Date(Date.now() - 90 * 1000) },
  })
    .select('agentId')
    .lean();
  const ids = (online || []).map((p) => p.agentId);
  if (!ids.length) {
    res.send({ success: true, sent: 0, reached: 0 });
    return;
  }
  const tokens = await PushNotificationToken.find({ user: { $in: ids }, deviceType: 'web' }, { token: 1 }).lean();
  const registrationTokens = [...new Set((tokens || []).map((t) => t.token).filter(Boolean))];
  if (!registrationTokens.length) {
    res.send({ success: true, sent: 0, reached: ids.length });
    return;
  }
  const admin = require('firebase-admin');
  const body = String(message).replace(/\s+/g, ' ').slice(0, 200);
  const result = await admin.messaging().sendEachForMulticast({
    notification: { title: 'Team broadcast', body },
    data: { type: 'support_broadcast', url: '/support-team/u/agent-queue' },
    webpush: { headers: { Urgency: 'high' }, notification: { icon: '/favicon.ico', tag: 'support-broadcast' } },
    tokens: registrationTokens,
  });
  res.send({ success: true, sent: result.successCount, reached: ids.length });
});

// PATCH /support_team/agents/:id/languages — spoken-language tags driving
// language-aware routing. Empty = takes any ticket.
const setAgentLanguages = catchAsync(async (req, res) => {
  const { id } = req.params;
  const langs = Array.isArray(req.body.languages)
    ? [...new Set(req.body.languages.map((l) => String(l).toLowerCase()).filter((l) => /^[a-z-]{2,8}$/.test(l)))].slice(0, 8)
    : null;
  if (!langs) {
    res.status(400).send({ success: false, code: 400, message: 'languages array required', extra: null });
    return;
  }
  const { User } = require('../models');
  const user = await User.findByIdAndUpdate(id, { $set: { languages: langs } }, { returnDocument: 'after' })
    .select('languages')
    .lean();
  if (!user) {
    res.status(404).send({ success: false, code: 404, message: 'Not found', extra: null });
    return;
  }
  res.send({ success: true, languages: user.languages });
});

// GET /support_chat_room/queues — list support queues.
const listQueues = catchAsync(async (req, res) => {
  const queues = await SupportQueue.find({ isActive: true })
    .populate('members', 'firstName lastName image')
    .lean();
  res.send({ success: true, queues });
});

// --- Agent presence ---------------------------------------------------------
// `assignAgent` only considers agents with `online: true`, and the presence
// sweep clears anything that has not heartbeated in 60s. Without this endpoint
// nothing ever sets the flag, so every ticket would queue unassigned forever.

const presenceHeartbeat = catchAsync(async (req, res) => {
  const agent = req.body.agent;
  const roomId = req.body.roomId;
  const presence = await AgentPresence.findOneAndUpdate(
    { agentId: agent },
    {
      // The heartbeat owns `lastSeen` — and `online` ONLY while the agent has
      // not walked away by hand. Setting `online: true` here unconditionally
      // resurrected a manual Offline one tick later: the row then read
      // `online: true` + `availability: 'offline'`, which every consumer
      // (roster, transfer roster, auto-assign) reads as "offline", so a
      // supervisor saw a working agent flagged offline.
      $set: { lastSeen: new Date(), cleanLogout: false },
      // First heartbeat of a brand-new row: online, and nothing has overridden
      // the declared availability yet, so start available.
      $setOnInsert: { online: true, availability: 'available' },
      ...(roomId ? { $addToSet: { currentRooms: roomId } } : {}),
    },
    { upsert: true, returnDocument: 'after' }
  );
  // The sweep (or a manual Offline) can clear `online` while the agent is
  // still sitting in the panel. A live heartbeat is proof they are there, so
  // put them back in the rotation — unless they went offline by hand.
  if (presence.availability !== 'offline' && !presence.online) {
    await AgentPresence.updateOne({ agentId: presence.agentId }, { $set: { online: true } });
    presence.online = true;
  }
  res.send({ success: true, online: presence.online, currentRooms: presence.currentRooms, availability: presence.availability || 'available' });
});

const presenceOffline = catchAsync(async (req, res) => {
  const agent = req.body.agent;
  // Clean logout: tickets STAY assigned (Mine survives logout). Only a hard
  // disappearance (no heartbeat, no logout) counts as abandonment for the
  // requeue sweep. Supervisors can still steal via transfer.
  await AgentPresence.updateOne(
    { agentId: agent },
    { $set: { online: false, lastSeen: new Date(), currentRooms: [], cleanLogout: true } }
  );
  res.send({ success: true });
});

// Leaving one ticket: drop it from currentRooms without touching the global
// online flag. Navigating between tickets must not offline the agent.
const presenceLeaveRoom = catchAsync(async (req, res) => {
  const { agent, roomId } = req.body;
  if (agent && roomId) {
    await AgentPresence.updateOne(
      { agentId: agent },
      { $pull: { currentRooms: roomId }, $set: { lastSeen: new Date() } }
    );
  }
  res.send({ success: true });
});

// Supervisor override: force an agent's status from the roster (available /
// busy / offline) without waiting for them to click their own header toggle.
// Needed when an agent is on the phone, in a meeting, or their client is
// lying about being "available" while nobody is actually working.
// Reuses the same availability enum the agent's own toggle writes, so every
// consumer (auto-assign, transfer roster, queue-wait paging) reacts instantly.
const setAgentAvailability = catchAsync(async (req, res) => {
  const { agent, availability } = req.body;
  const allowed = ['available', 'busy', 'offline'];
  if (!agent || !allowed.includes(availability)) {
    return res.status(400).send({
      success: false,
      message: 'agent and availability (available|busy|offline) are required',
    });
  }
  // A human/agent id is enough to find the row; upsert so a supervisor can set
  // status before the agent has ever heartbeated.
  //
  // `lastSeen` is deliberately NOT touched: it belongs to the heartbeat alone.
  // Forcing "available" here says "route to this agent", it does not mean the
  // agent's browser is alive, and stamping lastSeen here made the roster report
  // "seen just now" for a tab nobody is sitting in. The 90s freshness gate then
  // keeps the forced state honest — if the agent really is gone, the row ages
  // out and reads offline again on the next read.
  const presence = await AgentPresence.findOneAndUpdate(
    { agentId: agent },
    {
      $set: {
        availability,
        online: availability !== 'offline',
        cleanLogout: availability === 'offline',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  res.send({
    success: true,
    online: presence.online,
    availability: presence.availability,
    lastSeen: presence.lastSeen,
  });
});

// Collision lock source: other agents with this ticket open and fresh.
// The widget polls this; anyone listed locks the composer read-only.
const roomViewers = catchAsync(async (req, res) => {
  const { id } = req.params;
  const viewers = await AgentPresence.find({
    currentRooms: id,
    online: true,
    lastSeen: { $gte: new Date(Date.now() - 90 * 1000) },
  })
    .populate('agentId', 'firstName lastName image')
    .select('agentId lastSeen')
    .lean();
  res.send({
    success: true,
    viewers: (viewers || [])
      .filter((v) => v.agentId && v.agentId._id)
      .map((v) => ({
        id: String(v.agentId._id),
        firstName: v.agentId.firstName || '',
        lastName: v.agentId.lastName || '',
        image: v.agentId.image || '',
        lastSeen: v.lastSeen,
      })),
  });
});

// POST /support_chat_room/:id/reopen — customer reopens their own resolved
// ticket within 48h. Returns the room back to the bot instead of forking a
// duplicate ticket.
const reopen = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { user } = req.body;
  const room = await supportChatRoomService.reopenSupportChat(id, user);
  res.send({
    success: true,
    status: room.status,
    handoverState: room.handoverState,
    reopenCount: room.reopenCount,
    sticky: !!room._sticky,
  });
});

// GET /support_chat_room/stats/bot-containment?days=30 — enterprise tuning
// loop: intent volume x handover rate. Bot turns carry meta.intent; rooms
// carry audit handover markers. One aggregation each, no new collections.
const botContainment = catchAsync(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [byIntent, handovers, totals] = await Promise.all([
    SupportChatConversion.aggregate([
      { $match: { senderRole: 'bot', createdAt: { $gte: since } } },
      { $group: { _id: '$meta.intent', turns: { $sum: 1 } } },
      { $sort: { turns: -1 } },
    ]),
    SupportChatRoom.countDocuments({
      createdAt: { $gte: since },
      'audit.action': { $in: ['handover', 'bot:handover'] },
    }),
    SupportChatRoom.countDocuments({ createdAt: { $gte: since } }),
  ]);
  const intents = (byIntent || []).map((r) => ({ intent: r._id || 'unknown', turns: r.turns }));
  const totalTurns = intents.reduce((s, r) => s + r.turns, 0);
  res.send({
    success: true,
    days,
    totalTurns,
    totalRooms: totals,
    handedOverRooms: handovers,
    containmentPct: totals ? Number((((totals - handovers) / totals) * 100).toFixed(1)) : null,
    byIntent: intents,
  });
});

module.exports = {
  botStart,
  botMessage,
  handover,
  transfer,
  acceptTransfer,
  declineTransfer,
  cancelOffer,
  forceAssign,
  forceResolve,
  bulkAction,
  broadcast,
  internalNote,
  submitCsat,
  queueStatus,
  agentQueue,
  listCanned,
  listQueues,
  presenceHeartbeat,
  presenceOffline,
  presenceLeaveRoom,
  roomViewers,
  searchMessages,
  createCanned,
  updateCanned,
  exportTranscript,
  recentOrders,
  pinSubject,
  presenceStatus,
  registerWebToken,
  onlineAgents,
  setAgentAvailability,
  setAgentLanguages,
  updateQueue,
  allAgents,
  listShifts,
  setShift,
  deleteShift,
  coverageBoard,
  detectDuplicates,
  mergeTickets,
  unmergeTicket,
  qaSample,
  qaReview,
  qaQuality,
  qaReviews,
  listSlaPolicies,
  updateSlaPolicy,
  customerChips,
  reopen,
  botContainment,
};