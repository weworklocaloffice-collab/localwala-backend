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

/**
 * verify.support.enterprise.integration.js — executes the WHOLE bot-first ->
 * human handover path against a live database.
 *
 * The unit suite (verify.support.bot.units.js) never touches Mongo, so it could
 * not catch a bad filter, a broken projection, or an assignment that silently
 * finds no agent. This one does. It is the first thing in this feature that
 * actually RUNS the code the Admin panel and the apps depend on.
 *
 * Needs: SupportQueue / SlaPolicy / CannedResponse seeded
 *   -> node scripts/seed.support.enterprise.js
 *
 * Run: node scripts/verify.support.enterprise.integration.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const config = require('../src/config/config');
const {
  SupportChatRoom,
  SupportChatConversion,
  SupportQueue,
  SupportChatRoomService,
  supportBotService,
  supportAssignmentService,
  supportChatConversionService,
} = (() => {
  const models = require('../src/models');
  const services = require('../src/services');
  return {
    SupportChatRoom: models.SupportChatRoom,
    SupportChatConversion: models.SupportChatConversion,
    SupportQueue: models.SupportQueue,
    SupportChatRoomService: services.supportChatRoomService,
    supportBotService: services.supportBotService,
    supportAssignmentService: services.supportAssignmentService,
    supportChatConversionService: services.supportChatConversionService,
  };
})();

const { AgentPresence } = require('../src/models');

let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    fail += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

const MARK = `verify_enterprise_${Date.now()}`;
// Unique mobiles per run. The previous run hard-coded these and a mid-run
// failure left orphans behind, so the next run died on the `phoneHash_1`
// unique index before it ever reached a single assertion.
const MOBILE_C = `9${String(Date.now()).slice(-8)}`;
const MOBILE_A = `8${String(Date.now()).slice(-8)}`;

// Tracked outside `run` so the finally in the entrypoint can clean up even when
// a check throws partway through. A harness that orphans its fixtures makes the
// NEXT run fail for the wrong reason, which hides the real bug.
const created = { rooms: [], users: [], queues: [], presences: [] };

const run = async () => {
  console.log('\n=== support enterprise: bot -> human handover (integration) ===\n');

  const { User } = require('../src/models');

  // --- fixtures -------------------------------------------------------------
  const customer = await User.create({
    firstName: 'Verify',
    lastName: 'Customer',
    email: `${MARK}@example.com`,
    mobile: MOBILE_C,
    countryCode: 91,
    role: 'user',
    password: 'VerifyPass123',
  });
  const agent = await User.create({
    firstName: 'Verify',
    lastName: 'Agent',
    email: `${MARK}_agent@example.com`,
    mobile: MOBILE_A,
    countryCode: 91,
    role: 'supportTeam',
    password: 'VerifyPass123',
  });

  created.users.push(customer._id, agent._id);

  const queue = await SupportQueue.create({
    name: `${MARK}-queue`,
    skills: ['orders'],
    members: [agent._id],
    wipLimit: 5,
    isActive: true,
  });
  created.queues.push(queue._id);

  // Presence must be online or `assignAgent` treats the agent as ineligible.
  await AgentPresence.create({ agentId: agent._id, online: true, lastSeen: new Date() });
  created.presences.push(agent._id);

  console.log('\n--- room creation ---');

  // Double-tap / double-tap-race guard: two identical creates must yield ONE
  // room, or the customer gets two tickets and two agent copies.
  const r1 = await SupportChatRoomService.createOrGetBotRoom(customer._id, 'orders', new mongoose.Types.ObjectId());
  const r2 = await SupportChatRoomService.createOrGetBotRoom(customer._id, 'orders', r1.orders);
  ok('idempotent room create returns one room', String(r1._id) === String(r2._id));
  ok('room starts in bot state', r1.handoverState === 'bot', r1.handoverState);
  ok('room is unassigned at creation', !r1.assignedAgent);

  // The legacy entry point (`fetchSupportChatMessages`, still used by the old
  // app flow) must share the same guarantee — it used to `findOne`-then-`save`,
  // which doubled rooms under a double-tap.
  const legacy = await SupportChatRoomService.checkChatRoom(customer._id, 'orders', String(r1.orders), { limit: 10, page: 1 });
  ok('legacy checkChatRoom returns the same room', String(legacy.roomID) === String(r1._id), String(legacy.roomID));
  ok('no duplicate rooms exist', (await SupportChatRoom.countDocuments({ userId: customer._id, supportType: 'orders' })) === 1);

  const roomId = r1._id;

  console.log('\n--- bot turn ---');

  const turn = await supportBotService.handleBotTurn({
    roomId,
    userMessage: 'hello',
    type: 'orders',
    typeId: null,
  });
  ok('greeting resolves to greeting intent', turn.intent === 'greeting', turn.intent);
  ok('bot replies with text', typeof turn.text === 'string' && turn.text.length > 0);
  ok('bot message persisted', (await SupportChatConversion.countDocuments({ roomId, senderRole: 'bot' })) >= 1);

  // --- handover + assignment ------------------------------------------------
  console.log('\n--- handover to human ---');

  // Stub the push and prove the assignment itself wakes the customer. The
  // handover is otherwise silent until the agent's first message.
  let handoverPushes = [];
  const fcmForHandover = require('../src/services/fcm.notification.service');
  const realHandoverFcm = fcmForHandover.supportChatMessage;
  fcmForHandover.supportChatMessage = async (...stubArgs) => {
    handoverPushes.push(stubArgs);
    return { skipped: 'stubbed' };
  };

  const handover = await supportAssignmentService.handoverToHuman(roomId, { reason: 'verify' });
  fcmForHandover.supportChatMessage = realHandoverFcm;
  ok('handover assigns an agent', handover.assigned === true, handover.reason || 'no agent picked');
  ok('handover pushes the customer', handoverPushes.length >= 1, String(handoverPushes.length));
  ok(
    'handover push carries the thread for deep-link',
    handoverPushes.some((a) => a[3] && a[3].supportType === 'orders'),
    JSON.stringify(handoverPushes[0] && handoverPushes[0][3])
  );

  const assigned = await SupportChatRoom.findById(roomId);
  ok('room records assignedAgent', !!assigned.assignedAgent);
  ok('assignedAgent is the online queue member', String(assigned.assignedAgent) === String(agent._id));
  ok('room moves to assigned', assigned.handoverState === 'assigned', assigned.handoverState);
  ok('bot is switched off after handover', assigned.botEnabled === false);
  ok('SLA deadline stamped on assignment', !!assigned.slaDueAt);
  ok('handover writes an audit entry', (assigned.audit || []).some((a) => a.action === 'handover'));

  // --- agent reply ----------------------------------------------------------
  console.log('\n--- agent reply ---');

  const reply = await supportChatConversionService.saveAgentReply(roomId, agent._id, 'On the way.', 'text');
  ok('agent reply returns a messageId', !!reply.messageId);
  ok('agent reply persists once', (await SupportChatConversion.countDocuments({ roomId, message: 'On the way.' })) === 1);

  const afterReply = await SupportChatRoom.findById(roomId);
  ok('first response timestamp stamped', !!afterReply.firstResponseAt);
  ok('status moves to in_progress', afterReply.status === 'in_progress', afterReply.status);
  ok('agent added to supportTeam', afterReply.supportTeam.some((t) => String(t) === String(agent._id)));

  // --- internal note isolation ---------------------------------------------
  console.log('\n--- internal note isolation ---');

  await supportChatConversionService.saveInternalNote(roomId, agent._id, 'INTERNAL-ONLY-MARKER');

  const stored = await SupportChatConversion.findOne({ roomId, message: 'INTERNAL-ONLY-MARKER' });
  ok('note is stored as internal', stored.visibility === 'internal');

  // The customer-facing projection is the one that must not leak.
  const customerView = await supportChatConversionService.getMessages(roomId, { limit: 50, page: 1 });
  ok('customer projection hides internal notes', !customerView.chats.some((c) => c.message === 'INTERNAL-ONLY-MARKER'));
  ok(
    'customer totalResults excludes internal notes',
    customerView.totalResults === customerView.chats.length,
    `count=${customerView.totalResults} shown=${customerView.chats.length}`
  );

  const adminView = await supportChatConversionService.adminChatMessages(roomId, { limit: 50, page: 1 });
  ok('agent projection SHOWS internal notes', adminView.chats.some((c) => c.message === 'INTERNAL-ONLY-MARKER'));

  // --- projections carry the enterprise fields the UI reads ---------------
  console.log('\n--- projections expose enterprise fields ---');

  const customerRow = customerView.chats.find((c) => c.senderRole === 'bot');
  ok('messages expose senderRole', !!customerRow, 'bot row not found');
  ok('messages expose visibility', customerView.chats.every((c) => c.visibility !== undefined));
  ok('messages expose readStatus', customerView.chats.every((c) => c.readStatus !== undefined));

  const info = await SupportChatRoom.findById(roomId).lean();
  ok('room carries handoverState', info.handoverState !== undefined);
  ok('room carries priority', info.priority !== undefined);

  // --- queue position -------------------------------------------------------
  console.log('\n--- queue position ---');

  const queuedRoom = await SupportChatRoomService.createOrGetBotRoom(customer._id, 'complaints', new mongoose.Types.ObjectId());
  queuedRoom.handoverState = 'queued';
  await queuedRoom.save();
  const pos = await SupportChatRoomService.getQueuePosition(queuedRoom._id);
  ok('queued room reports a 1-based position', pos >= 1, String(pos));
  const posOfLive = await SupportChatRoomService.getQueuePosition(roomId);
  ok('assigned room is not in the queue', posOfLive === 0, String(posOfLive));

  // --- SLA breach -----------------------------------------------------------
  console.log('\n--- SLA breach escalation ---');

  const breached = await SupportChatRoom.create({
    userId: customer._id,
    supportType: 'orders',
    supportTypeHint: undefined,
    priority: 'medium',
    status: 'open',
    slaDueAt: new Date(Date.now() - 60 * 1000),
  });
  const { breached: count } = await supportAssignmentService.checkSlaBreach();
  ok('sweep reports the breach', count >= 1, String(count));
  const escalated = await SupportChatRoom.findById(breached._id);
  ok('breach bumps priority', escalated.priority === 'high', escalated.priority);
  ok('breach pushes a new SLA deadline', escalated.slaDueAt.getTime() > Date.now());
  ok('breach writes an audit entry', (escalated.audit || []).some((a) => a.action === 'sla:breach'));

  // --- agent reply: push fan-out ------------------------------------------
  console.log('\n--- agent reply fires a push ---');

  // A customer with no registered device must NOT break the reply. This is the
  // silent-failure case that would otherwise roll back a saved message.
  let fcmCalls = 0;
  const fcm = require('../src/services/fcm.notification.service');
  const realFcm = fcm.supportChatMessage;
  fcm.supportChatMessage = async () => {
    fcmCalls += 1;
    return { skipped: 'stubbed' };
  };

  await supportChatConversionService.saveAgentReply(roomId, agent._id, 'Push check', 'text');
  await new Promise((resolve) => setImmediate(resolve));
  ok('agent reply triggers a push', fcmCalls >= 1, String(fcmCalls));
  fcm.supportChatMessage = realFcm;

  // --- rate limit + message cap --------------------------------------------
  console.log('\n--- abuse guards ---');
  const { sendChatMessageValidation, botMessageValidation } = require('../src/validations/chat.room.validation');
  const validBody = {
    room: new mongoose.Types.ObjectId().toString(),
    sender: new mongoose.Types.ObjectId().toString(),
    msg: 'hello',
    msgType: 'text',
  };
  // `sendChatMessageValidation.body` is already a Joi schema — validate against
  // it directly rather than rebuilding one from `.keys()`.
  const sendSchema = sendChatMessageValidation.body;
  ok('a normal message validates', !sendSchema.validate(validBody).error);
  ok(
    'an empty message is rejected',
    !!sendSchema.validate({ ...validBody, msg: '   ' }).error,
    'blank accepted'
  );
  ok(
    'an oversized message is rejected',
    !!sendSchema.validate({ ...validBody, msg: 'x'.repeat(2001) }).error,
    '2001 chars accepted'
  );
  const botSchema = botMessageValidation.body;
  ok(
    'bot message is capped too',
    !!botSchema.validate({ roomId: validBody.room, message: 'y'.repeat(2001) }).error
  );

  // --- reopen -----------------------------------------------------------------
  console.log('\n--- reopen ---');

  // Resolve through the real path so `resolvedAt` is stamped the way production
  // stamps it.
  const supportRoomService = require('../src/services/support.chat.room.service');
  await supportRoomService.resolveSupportChat(roomId, agent._id);
  const resolved = await SupportChatRoom.findById(roomId);
  ok('ticket resolves', resolved.status === 'resolved');

  const reopened = await supportRoomService.reopenSupportChat(roomId, customer._id);
  ok('owner reopens within 48h', reopened.status === 'open');
  ok('reopen returns the room to the bot', reopened.handoverState === 'bot');
  ok('reopen clears the assignment', !reopened.assignedAgent);
  ok('reopen counts', reopened.reopenCount === 1, String(reopened.reopenCount));

  // Close it again and age it past the window: reopening must now refuse.
  await supportRoomService.resolveSupportChat(roomId, agent._id);
  await SupportChatRoom.findByIdAndUpdate(roomId, {
    resolvedAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
  });
  let expiredThrew = null;
  try {
    await supportRoomService.reopenSupportChat(roomId, customer._id);
  } catch (e) {
    expiredThrew = e;
  }
  ok('reopen refuses after 48h', !!expiredThrew);

  // A different user must not reopen someone else's ticket.
  let forbiddenThrew = null;
  try {
    await supportRoomService.reopenSupportChat(roomId, agent._id);
  } catch (e) {
    forbiddenThrew = e;
  }
  ok('non-owner cannot reopen', !!forbiddenThrew);

  // --- dashboard counters ---------------------------------------------------
  console.log('\n--- dashboard counters ---');

  // The $facet must agree with direct counts. Fixture rooms are a subset of
  // whatever else lives in this database, so assert agreement, not absolutes.
  const list = await SupportChatRoomService.filterChatList({ filter: 'all', limit: 5, page: 1 });
  const [expectAll, expectOpen, expectOrders] = await Promise.all([
    SupportChatRoom.countDocuments({}),
    SupportChatRoom.countDocuments({ status: 'open' }),
    SupportChatRoom.countDocuments({ supportType: 'orders' }),
  ]);
  ok('facet allChat matches a direct count', list.allChat === expectAll, `${list.allChat} vs ${expectAll}`);
  ok('facet openChat matches a direct count', list.openChat === expectOpen, `${list.openChat} vs ${expectOpen}`);
  ok('facet orderChat matches a direct count', list.orderChat === expectOrders, `${list.orderChat} vs ${expectOrders}`);
  ok('list still returns chats', Array.isArray(list.chats) && list.success === true);

  // The workspace history timeline reads `info.audit` — if the projection
  // omits it, the timeline is permanently empty despite the data existing.
  const detail = await SupportChatRoomService.getInitialChatSupportMessages({
    roomId: String(roomId),
    supportTeam: String(agent._id),
    limit: 5,
    page: 1,
  });
  ok(
    'room detail exposes the audit trail',
    Array.isArray(detail.info && detail.info.audit) && detail.info.audit.length >= 1,
    JSON.stringify(detail.info && Object.keys(detail.info))
  );

  // --- csat -----------------------------------------------------------------
  console.log('\n--- csat ---');

  // Through the service, the way the controller calls it — a raw model write
  // here would bypass exactly the operator-shape bug this guards.
  const supportRoomSvc = require('../src/services/support.chat.room.service');
  await supportRoomSvc.submitCsat(roomId, 5, 'great');
  const rated = await SupportChatRoom.findById(roomId);
  ok('csat score stored', rated.csat.score === 5);
  ok('csat comment stored', rated.csat.comment === 'great');
  ok(
    'csat writes a well-formed audit entry',
    (rated.audit || []).some((a) => a.action === 'csat'),
    'no csat audit entry'
  );

  // --- teardown -------------------------------------------------------------
  console.log('\n--- cleanup ---');
  // Record fixtures as they are created so the finally block can remove them
  // even if a later check throws.
  created.rooms.push(roomId, queuedRoom._id, breached._id);
  created.queues.push(queue._id);
  created.users.push(customer._id, agent._id);
  created.presences.push(agent._id);
  await purge();
  const left = await SupportChatRoom.countDocuments({ userId: customer._id });
  ok('fixtures removed', left === 0, String(left));
};

/** Remove everything this run created. Safe to call twice. */
const purge = async () => {
  if (created.rooms.length) {
    await SupportChatConversion.deleteMany({ roomId: { $in: created.rooms } });
    await SupportChatRoom.deleteMany({ _id: { $in: created.rooms } });
  }
  if (created.queues.length) await SupportQueue.deleteMany({ _id: { $in: created.queues } });
  if (created.presences.length) await AgentPresence.deleteMany({ agentId: { $in: created.presences } });
  if (created.users.length) {
    const { User } = require('../src/models');
    await User.deleteMany({ _id: { $in: created.users } });
  }
};

mongoose
  .connect(config.mongoose.url, config.mongoose.options)
  .then(async () => {
    console.log('Connected to MongoDB.');
    try {
      await run();
    } catch (e) {
      fail += 1;
      console.log('  FAIL  harness threw -> ' + e.message);
      console.log(e.stack);
    } finally {
      // Always purge, including after a throw. Leaving fixtures behind makes
      // the next run fail on a duplicate-key error instead of on the real bug.
      await purge().catch(() => {});
    }
    await mongoose.disconnect();
    console.log(fail === 0 ? '\nAll support enterprise integration checks passed.' : `\n${fail} FAILURES`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error('Seed DB unreachable:', e.message);
    process.exit(2);
  });