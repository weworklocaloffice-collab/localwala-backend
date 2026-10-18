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
 * Support escalation ladder.
 *
 * A breach previously did exactly one thing: bump the ticket's priority label.
 * Nobody was notified and nobody took the ticket, so "urgent" was a colour on a
 * dashboard with no human behind it. This turns a deadline into an action:
 *
 *   level 1  notify    - supervisors are pinged (socket + FCM); the agent keeps
 *                        the ticket and keeps their WIP slot.
 *   level 2  reassign  - the ticket is moved to an on-call supervisor, with the
 *                        same atomic WIP guard as every other move so the
 *                        original agent's slot is released exactly once.
 *
 * Re-firing is the danger with any sweep: a stuck ticket would escalate forever.
 * `escalationLevel` on the room makes each level fire once, and any agent reply
 * or resolve resets it to 0 — recovery is what disarms the ladder.
 */

const mongoose = require('mongoose');
const logger = require('../config/logger');

// Supervisors who can be escalated to. Availability is honoured where we can see
// it (online + not manually offline), because paging an offline supervisor is
// the same as paging nobody.
const findEscalationTargets = async (policy) => {
  const { User, AgentPresence } = require('../models');
  const named = (policy && policy.escalateTo) || [];
  const query = named.length
    ? { _id: { $in: named } }
    : { role: 'supportSupervisor' };
  const users = await User.find(query).select('_id firstName lastName').lean();
  const ids = users.map((u) => u._id);
  if (!ids.length) return [];
  const presence = await AgentPresence.find({
    agentId: { $in: ids },
    online: true,
    lastSeen: { $gte: new Date(Date.now() - 90 * 1000) },
    availability: { $ne: 'offline' },
  })
    .select('agentId')
    .lean();
  return presence.map((p) => p.agentId);
};

// Best recipient when no one was named: least-loaded, so paging always lands on
// the supervisor with the most room rather than the same person every time.
const pickTarget = async (candidates) => {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const { AgentPresence } = require('../models');
  const docs = await AgentPresence.find({ agentId: { $in: candidates } })
    .select('agentId openTickets')
    .lean();
  if (!docs.length) return candidates[0];
  docs.sort((a, b) => (a.openTickets || 0) - (b.openTickets || 0));
  return docs[0].agentId;
};

const notifySupervisors = (targetIds, room, reason, level) => {
  try {
    // eslint-disable-next-line global-require
    const { emitToUsers } = require('../utils/socket.emitter');
    emitToUsers(
      targetIds,
      'supportEscalation',
      () => ({
        chatRoomId: String(room._id),
        reason,
        level,
        priority: room.priority,
        supportType: room.supportType,
        at: new Date(),
      })
    );
  } catch (e) {
    logger.error(`Escalation notify failed for room ${room._id}: ${e.message}`);
  }
  try {
    // eslint-disable-next-line global-require
    const fcm = require('./fcm.notification.service');
    // Reuses the existing web-push sender: same token lookup, same deep link
    // into the ticket. A push failure is swallowed on purpose - an escalation
    // must still be recorded even if the phone never buzzes.
    Promise.all(
      targetIds.map((id) =>
        fcm.supportChatAgentAlert(
          id,
          room._id,
          `${reason} - needs attention`,
          'Support escalation'
        )
      )
    ).catch(() => {});
  } catch {
    // FCM is best-effort; never let a push failure abort the escalation.
  }
};

/**
 * Escalate one ticket, at most one level per call.
 * Returns { escalated: bool, level, mode, reason }.
 */
const escalateRoom = async (room, { reason, level = 1, mode = 'notify', targetId = null }) => {
  const now = new Date();
  // One escalation per level. The filter is the concurrency guard: two sweepers
  // racing on the same ticket cannot both move it, because only one matches
  // the current level.
  const claimed = await require('../models')
    .SupportChatRoom.findOneAndUpdate(
      { _id: room._id, escalationLevel: { $lt: level } },
      {
        $set: { escalationLevel: level, escalatedAt: now, escalationReason: reason },
        $push: { audit: { action: `escalated:${reason}`, at: now, meta: { level, mode } } },
      },
      { returnDocument: 'after' }
    )
    .lean();
  if (!claimed) return { escalated: false, level, mode, reason };

  if (mode === 'reassign') {
    const to = targetId || (await pickTarget(await findEscalationTargets(null)));
    if (to && String(to) !== String(claimed.assignedAgent || '')) {
      const supportChatRoomService = require('./support.chat.room.service');
      try {
        await supportChatRoomService.forceAssign(
          String(claimed._id),
          String(to),
          `Auto-escalation: ${reason}`,
          null
        );
      } catch (e) {
        // A full/offline supervisor must not abort the record of the escalation.
        logger.error(`Escalation reassign failed for room ${claimed._id}: ${e.message}`);
      }
    } else {
      notifySupervisors(to ? [to] : [], claimed, reason, level);
    }
  } else {
    notifySupervisors(await findEscalationTargets(null), claimed, reason, level);
  }

  return { escalated: true, level, mode, reason };
};

/**
 * Sweep open tickets past their escalation grace and escalate them.
 * Bounded batch so one bad day cannot hold the event loop.
 */
const runEscalationSweep = async () => {
  const { SupportChatRoom, SlaPolicy } = require('../models');
  const policies = await SlaPolicy.find({ isActive: true, escalationMode: { $ne: 'off' } })
    .select('supportType priority escalationMode escalateAfterSec')
    .lean();
  if (!policies.length) return { escalated: 0, skipped: 'no policies with escalation enabled' };

  const now = Date.now();
  const results = [];
  for (const p of policies) {
    const deadline = new Date(now - (p.escalateAfterSec || 600) * 1000);
    // eslint-disable-next-line no-await-in-loop
    const rooms = await SupportChatRoom.find({
      status: { $in: ['open', 'in_progress'] },
      supportType: p.supportType,
      priority: p.priority,
      // Past the grace window, and never escalated this far already.
      slaDueAt: { $lt: deadline },
      escalationLevel: { $lt: 2 },
    })
      .limit(50)
      .select('_id priority supportType slaDueAt escalationLevel assignedAgent')
      .lean();
    // eslint-disable-next-line no-restricted-syntax
    for (const r of rooms) {
      // A ticket already answered just needs no escalation; only unanswered
      // deadlines are worth a human's attention.
      if (r.firstResponseAt && new Date(r.firstResponseAt) > new Date(r.slaDueAt)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const out = await escalateRoom(r, {
        reason: 'SLA missed',
        level: p.escalationMode === 'reassign' ? 2 : 1,
        mode: p.escalationMode,
      });
      results.push(out);
    }
  }
  return { escalated: results.filter((x) => x.escalated).length };
};

/**
 * Clear escalation after the customer is being looked after again: an agent
 * replied, or the ticket was resolved. Without this a ticket that was escalated
 * once would stay flagged for its whole life.
 */
const clearEscalation = async (roomId, note) => {
  const { SupportChatRoom } = require('../models');
  await SupportChatRoom.updateOne(
    { _id: roomId, escalationLevel: { $gt: 0 } },
    {
      $set: { escalationLevel: 0, escalationReason: undefined, escalatedTo: undefined },
      $push: { audit: { action: 'escalation:cleared', at: new Date(), meta: { note: note || 'agent responded' } } },
    }
  );
};

/**
 * Immediate escalation on a poor CSAT score. A customer telling you it went bad
 * is a stronger signal than any timer, so this skips the sweep entirely.
 */
const escalateForCsat = async (roomId, score) => {
  const { SupportChatRoom } = require('../models');
  const room = await SupportChatRoom.findById(roomId).select('_id priority supportType escalationLevel assignedAgent').lean();
  if (!room) return null;
  return escalateRoom(room, {
    reason: `Low CSAT (${score})`,
    level: 1,
    mode: 'notify',
  });
};

module.exports = {
  runEscalationSweep,
  escalateRoom,
  escalateForCsat,
  clearEscalation,
  findEscalationTargets,
};