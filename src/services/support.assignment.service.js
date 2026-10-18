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
const {
  SupportChatRoom,
  SupportChatConversion,
  SupportQueue,
  SlaPolicy,
  AgentPresence,
} = require('../models');

const DEFAULT_SLA_SEC = { firstResponseSec: 30, resolutionSec: 3600 };

const getSlaFor = async (supportType, priority = 'medium') => {
  try {
    const policy = await SlaPolicy.findOne({ supportType, priority, isActive: true }).lean();
    if (policy) return { firstResponseSec: policy.firstResponseSec, resolutionSec: policy.resolutionSec };
    const fallback = await SlaPolicy.findOne({ supportType, isActive: true }).lean();
    if (fallback) return { firstResponseSec: fallback.firstResponseSec, resolutionSec: fallback.resolutionSec };
  } catch {
    // fall through to defaults
  }
  return DEFAULT_SLA_SEC;
};

// Single source for the first-reply deadline: the SLA policy for the
// ticket's type+priority. Every assignment path stamps through here, so the
// thread countdown, Breached tab and Team-page policy edits all agree.
//
// The offset is added on the ticket's BUSINESS clock, not the wall clock: a
// ticket that lands at 11pm must not breach before anyone is on shift.
const firstResponseDue = async (room) => {
  const sla = await getSlaFor(room.supportType, room.priority || 'medium');
  const { addWorkingSeconds } = require('./support.working.hours.service');
  return addWorkingSeconds(new Date(), sla.firstResponseSec || 30, room.workingHours || null);
};

// Atomic WIP claim: `$lt` + `$inc` in ONE update. Concurrent assigns racing
// for the same agent cannot both pass — the loser sees the incremented
// counter and moves on. Returns true when this call took the slot.
const claimTicket = async (agentId, wipLimit) => {
  // `lastSeen` is the HEARTBEAT's field alone. Writing it here made every
  // assignment/accept look like the agent was sitting in the panel, so a
  // supervisor's "seen 2s ago" survived for someone who had closed the tab
  // hours ago. The claim bumps the counter only.
  const doc = await AgentPresence.findOneAndUpdate(
    {
      agentId: new mongoose.Types.ObjectId(agentId),
      online: true,
      availability: { $in: ['available', null] },
      $or: [{ openTickets: { $lt: wipLimit } }, { openTickets: { $exists: false } }],
    },
    { $inc: { openTickets: 1 } },
    { returnDocument: 'after' }
  ).lean();
  return !!doc;
};

// Release a slot (resolve, requeue, transfer-out). Never below zero; the
// sweep reconciles any drift against the true room count.
const releaseTicket = async (agentId) => {
  if (!agentId) return;
  try {
    await AgentPresence.updateOne(
      { agentId: new mongoose.Types.ObjectId(agentId), openTickets: { $gt: 0 } },
      { $inc: { openTickets: -1 } }
    );
  } catch {
    // Best-effort: the sweep corrects drift.
  }
};
const countOpenByAgent = async (agentIds) => {
  const counts = {};
  await Promise.all(
    agentIds.map(async (id) => {
      counts[String(id)] = await SupportChatRoom.countDocuments({
        assignedAgent: id,
        status: { $in: ['open', 'in_progress'] },
      });
    })
  );
  return counts;
};

// Queued auto-reply: a parked ticket must promise a time, not go silent.
// Once per handover: repeated handovers re-promise, repeats within one never do.
const queueAutoReply = async (room, reason) => {
  try {
    const audit = room.audit || [];
    for (let i = audit.length - 1; i >= 0; i -= 1) {
      const a = audit[i] && audit[i].action;
      if (a === 'queued:auto-reply') return;
      if (a === 'handover' || a === 'assigned' || a === 'transfer') break;
    }
    const supportChatRoomService = require('./support.chat.room.service');
    const position = await supportChatRoomService.getQueuePosition(room._id).catch(() => 0);
    const sla = await getSlaFor(room.supportType, room.priority || 'medium');
    const waitMin = Math.max(1, Math.round((sla.firstResponseSec || 60) / 60));
    const head =
      reason === 'all-offline'
        ? 'Our agents are offline right now.'
        : reason === 'language'
          ? 'Looking for an agent who speaks your language.'
          : 'All agents are busy right now.';
    const text =
      `${head} You are #${Math.max(1, position || 1)} in the queue — ` +
      `typical first reply within ${waitMin} min. Your ticket is saved; just stay on this chat.`;
    await SupportChatConversion.create({
      roomId: room._id,
      senderId: room.userId,
      message: text,
      messageType: 'text',
      senderRole: 'system',
      visibility: 'public',
      readStatus: 'sent',
    });
    room.lastMessage = text;
    room.lastMessageType = 'text';
    room.audit.push({ action: 'queued:auto-reply', at: new Date(), meta: { reason, position } });
    await room.save();
    const { threadOf } = require('./support.chat.conversion.service');
    const fcmNotificationService = require('./fcm.notification.service');
    fcmNotificationService.supportChatMessage(room.userId, room._id, text, threadOf(room)).catch(() => {});
  } catch {
    // A promise failure must never break the queueing itself.
  }
};

// Main assignment: skill-match queue -> online members -> min load + wipLimit.
// Sticky: last agent for same userId if still online & under limit.
const assignAgent = async (roomId, opts = {}) => {
  void opts; // reserved: per-room routing overrides (queue override, forced agent)
  const room = await SupportChatRoom.findById(roomId);
  if (!room) throw new Error('Room not found');

  const skills = room.skillTags && room.skillTags.length ? room.skillTags : [room.supportType];

  // A queue with zero members can NEVER produce an assignment, so it must not
  // be allowed to win the lookup. The previous `findOne({skills, isActive})`
  // returned whichever queue Mongo happened to order first — and since the
  // seeded queues (`order-help` etc.) are created empty, before anyone wires
  // members in, they shadowed every real queue. The ticket then sat in
  // `queued` forever with reason `no-eligible-queue` even though a staffed
  // queue existed and matched the skill exactly.
  const hasMembers = { 'members.0': { $exists: true } };

  let queue = null;
  if (room.queueId) {
    const pinned = await SupportQueue.findById(room.queueId);
    // Honour an explicit pin only when it can actually staff the ticket;
    // otherwise fall through and let a staffed queue take it.
    if (pinned && pinned.isActive && pinned.members && pinned.members.length) queue = pinned;
  }
  if (!queue) {
    queue =
      (await SupportQueue.findOne({ ...hasMembers, skills: { $in: skills }, isActive: true })) ||
      (await SupportQueue.findOne({ ...hasMembers, isActive: true }));
  }

  if (!queue) {
    room.handoverState = 'queued';
    room.audit = room.audit || [];
    room.audit.push({ action: 'queued:no-agent', at: new Date(), meta: { skills } });
    await room.save();
    await queueAutoReply(room, 'no-eligible-queue');
    return { assigned: false, reason: 'no-eligible-queue', room };
  }

  // Snapshot the queue's staffed hours onto the ticket once, here - the single
  // point every branch below shares. `firstResponseDue` then reads the room
  // rather than re-querying, so editing a schedule later cannot retroactively
  // move (or un-breach) a deadline on a ticket that already exists.
  room.workingHours = queue.workingHours || null;

  // Online filter. Busy/offline agents keep their tickets but take no new
  // ones. Missing `availability` (pre-toggle rows) counts as available.
  const presences = await AgentPresence.find({
    agentId: { $in: queue.members },
    online: true,
    availability: { $in: ['available', null] },
  })
    .select('agentId')
    .lean();
  const onlineIds = presences.map((p) => String(p.agentId));
  if (!onlineIds.length) {
    room.handoverState = 'queued';
    room.queueId = queue._id;
    room.audit = room.audit || [];
    room.audit.push({ action: 'queued:offline', at: new Date(), meta: { skills } });
    await room.save();
    await queueAutoReply(room, 'all-offline');
    return { assigned: false, reason: 'all-offline', room };
  }

  // Language match: agents with no tags take any ticket (backward compatible
  // until supervisors tag the team); tagged agents only take their locales.
  // A language miss parks queued with its own reason — never misrouted.
  const ticketLang = room.language || 'en';
  const { User } = require('../models');
  const langUsers = await User.find({ _id: { $in: onlineIds } }).select('languages').lean();
  const langMap = {};
  for (const u of langUsers) langMap[String(u._id)] = u.languages || [];
  const langIds = onlineIds.filter((id) => {
    const tags = langMap[id] || [];
    return !tags.length || tags.includes(ticketLang);
  });
  if (!langIds.length) {
    room.handoverState = 'queued';
    room.queueId = queue._id;
    room.audit = room.audit || [];
    room.audit.push({ action: 'queued:language', at: new Date(), meta: { skills, language: ticketLang } });
    await room.save();
    await queueAutoReply(room, 'language');
    return { assigned: false, reason: 'language', room };
  }

  // Sticky: last resolved room for same user assigned to online agent
  const lastRoom = await SupportChatRoom.findOne({
    userId: room.userId,
    assignedAgent: { $in: langIds.map((i) => new mongoose.Types.ObjectId(i)) },
  })
    .sort({ updatedAt: -1 })
    .select('assignedAgent')
    .lean();
  const counts = await countOpenByAgent(langIds);

  // Preference order: sticky agent first, then least-loaded round-robin.
  // Every candidate is CLAIMED atomically — the counter decides, not the
  // stale read above, so concurrent handovers can never overshoot WIP.
  // Spillover guard: sticky wins only while the agent is light (fewer than
  // STICKY_MAX open). A returning customer must not drown their favorite
  // agent while teammates idle — past the threshold, least-loaded wins.
  let picked = null;
  const wip = queue.wipLimit || 3;
  const STICKY_MAX = 2;
  if (lastRoom && lastRoom.assignedAgent) {
    const stickyId = String(lastRoom.assignedAgent);
    if ((counts[stickyId] ?? 0) < Math.min(wip, STICKY_MAX) && (await claimTicket(stickyId, wip))) picked = stickyId;
  }
  if (!picked) {
    const sorted = [...langIds].sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0));
    const start = (queue.roundRobinPointer || 0) % sorted.length;
    for (let k = 0; k < sorted.length; k += 1) {
      const cand = sorted[(start + k) % sorted.length];
      // eslint-disable-next-line no-await-in-loop
      if (await claimTicket(cand, wip)) {
        picked = cand;
        // Atomic rotation: $inc, never read-modify-save (lost updates).
        await SupportQueue.findByIdAndUpdate(queue._id, { $inc: { roundRobinPointer: 1 } });
        break;
      }
    }
  }

  if (!picked) {
    room.handoverState = 'queued';
    room.queueId = queue._id;
    room.audit = room.audit || [];
    room.audit.push({ action: 'queued:wip-limit', at: new Date(), meta: { skills } });
    await room.save();
    await queueAutoReply(room, 'wip-limit');
    return { assigned: false, reason: 'wip-limit', room };
  }

  const sla = await getSlaFor(room.supportType, room.priority || 'medium');
  room.assignedAgent = new mongoose.Types.ObjectId(picked);
  room.queueId = queue._id;
  room.handoverState = 'assigned';
  room.status = room.status === 'resolved' ? 'open' : room.status;
  // First reply due 30s after (re)assignment — flat rule, every priority.
  room.firstResponseDueAt = await firstResponseDue(room);
  if (!room.slaDueAt) room.slaDueAt = new Date(Date.now() + sla.resolutionSec * 1000);
  room.audit = room.audit || [];
  room.audit.push({ action: 'assigned', by: room.assignedAgent, at: new Date(), meta: { queue: queue.name, skills } });
  await room.save();

  await AgentPresence.findOneAndUpdate(
    { agentId: room.assignedAgent },
    { $addToSet: { currentRooms: room._id }, $set: { lastSeen: new Date() } },
    { upsert: true }
  );

  // Tell the customer a human is now with them. Without this the handover is
  // silent: the bot stops answering and nothing arrives until the agent's
  // first message, which reads as the chat dying. Fire-and-forget, same as
  // the reply push — a push failure must not roll back the assignment.
  try {
    const { threadOf } = require('./support.chat.conversion.service');
    const fcmNotificationService = require('./fcm.notification.service');
    const { User } = require('../models');
    const agentUser = await User.findById(picked).select('firstName lastName').lean();
    const agentName = agentUser ? `${agentUser.firstName || ''} ${agentUser.lastName || ''}`.trim() : '';
    // In-chat announcement: the join must be VISIBLE in the transcript, not
    // just a push (which is missed when the chat is open).
    const joinText = agentName
      ? `${agentName} (support agent) is here to resolve your issue.`
      : 'A support agent has joined the chat to resolve your issue.';
    await SupportChatConversion.create({
      roomId: room._id,
      senderId: room.userId,
      message: joinText,
      messageType: 'text',
      senderRole: 'system',
      visibility: 'public',
      readStatus: 'sent',
    });
    room.lastMessage = joinText;
    room.lastMessageType = 'text';
    await room.save();
    fcmNotificationService
      .supportChatMessage(room.userId, room._id, 'A support agent has joined your chat', threadOf(room))
      .catch(() => {});
    // Wake the picked agent's browsers: the ticket landed without them
    // clicking anything, so without this they only find it by polling Mine.
    fcmNotificationService
      .supportChatAgentAlert(room.assignedAgent, room._id, 'A ticket was auto-assigned to you', 'New ticket assigned')
      .catch(() => {});
  } catch {
    // Push plumbing must never break assignment.
  }

  return { assigned: true, agentId: picked, queue: queue.name, room };
};

// Bot -> human handover with full transcript context.
const handoverToHuman = async (roomId, { reason = 'user-request', by = null } = {}) => {
  const room = await SupportChatRoom.findById(roomId);
  if (!room) throw new Error('Room not found');
  if (!room.botEnabled) return assignAgent(roomId);

  room.botEnabled = false;
  room.handoverState = 'queued';
  room.audit = room.audit || [];
  room.audit.push({ by, action: 'handover', at: new Date(), meta: { reason } });
  await room.save();

  // System message so agent sees what bot tried
  const senderId = room.userId;
  await SupportChatConversion.create({
    roomId: room._id,
    senderId,
    message: `Handover to human agent (${reason}). Bot transcript preserved above.`,
    messageType: 'text',
    senderRole: 'system',
    visibility: 'internal',
    readStatus: 'sent',
    meta: { reason },
  });

  return assignAgent(roomId, { reason });
};

const transferRoom = async (roomId, fromAgent, toAgent, reason = '') => {
  const room = await SupportChatRoom.findById(roomId);
  if (!room) throw new Error('Room not found');
  const prev = room.assignedAgent;
  room.assignedAgent = new mongoose.Types.ObjectId(toAgent);
  room.handoverState = 'human';
  room.audit = room.audit || [];
  room.audit.push({
    by: fromAgent ? new mongoose.Types.ObjectId(fromAgent) : undefined,
    action: 'transfer',
    at: new Date(),
    meta: { from: prev, to: toAgent, reason },
  });
  await room.save();
  await SupportChatConversion.create({
    roomId: room._id,
    senderId: room.userId,
    message: `Transferred to another agent. Reason: ${reason || '—'}`,
    messageType: 'text',
    senderRole: 'system',
    visibility: 'internal',
    readStatus: 'sent',
  });

  // The customer only sees agents' public messages, so without this they would
  // never learn the handoff happened — the next reply would arrive from a
  // stranger. Same fire-and-forget contract as the other pushes.
  try {
    const { threadOf } = require('./support.chat.conversion.service');
    const fcmNotificationService = require('./fcm.notification.service');
    fcmNotificationService
      .supportChatMessage(room.userId, room._id, 'Your chat was passed to another agent', threadOf(room))
      .catch(() => {});
  } catch {
    // Push plumbing must never break a transfer.
  }
  return room;
};

// SLA breach scan (called by cron). Bumps priority + requeues.
const checkSlaBreach = async () => {
  const now = new Date();
  const breached = await SupportChatRoom.find({
    status: { $in: ['open', 'in_progress'] },
    slaDueAt: { $lt: now },
  })
    .limit(100)
    .select('_id priority supportType');
  const order = { low: 'medium', medium: 'high', high: 'urgent', urgent: 'urgent' };
  await Promise.all(
    breached.map(async (r) => {
      r.priority = order[r.priority] || 'high';
      r.slaDueAt = new Date(Date.now() + 30 * 60 * 1000);
      r.audit = r.audit || [];
      r.audit.push({ action: 'sla:breach', at: new Date() });
      await r.save();
    })
  );
  return { breached: breached.length };
};

module.exports = {
  assignAgent,
  handoverToHuman,
  transferRoom,
  checkSlaBreach,
  getSlaFor,
  claimTicket,
  releaseTicket,
  firstResponseDue,
};
