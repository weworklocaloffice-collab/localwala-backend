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

const cron = require('node-cron');
const supportAssignmentService = require('../services/support.assignment.service');

/**
 * Sweeps that keep the support queue honest. Without these a breached ticket
 * just sits in the queue: `checkSlaBreach` existed but nothing called it, so
 * SLA escalation never fired.
 *
 * Registered from src/index.js inside the successful-mongo branch, so no sweep
 * ever runs against an unreachable database.
 */
const startSupportCronJobs = () => {
  // SLA escalation. Every minute: breaches are frequent (a `medium` ticket is
  // 60 minutes) and the supervisor dashboard sorts by `slaDueAt`, so a
  // 5-minute sweep would leave visibly wrong numbers on screen.
  cron.schedule('* * * * *', async () => {
    try {
      await supportAssignmentService.checkSlaBreach();
    } catch (error) {
      console.error('Support SLA breach sweep failed:', error.message);
    }
  });

  // Escalation ladder. Separate from the breach sweep on purpose: breaches are
  // recorded continuously, but escalation needs its own pass so a stuck ticket
  // can only move one rung per level (the room's `escalationLevel` guard).
  cron.schedule('* * * * *', async () => {
    try {
      // eslint-disable-next-line global-require
      await require('../services/support.escalation.service').runEscalationSweep();
    } catch (error) {
      console.error('Support escalation sweep failed:', error.message);
    }
  });

  // Shift coverage. Every 5 minutes alongside the presence sweep: it only flips
  // availability, so a coarser tick than the SLA job is fine. Deliberately does
  // NOT touch openTickets - going off-shift must not requeue an agent's work.
  cron.schedule('*/5 * * * *', async () => {
    try {
      // eslint-disable-next-line global-require
      const out = await require('../services/support.coverage.service').applyShifts();
      if (out.markedOffline || out.restored) {
        console.log(`Shift coverage: ${out.markedOffline} marked off-shift, ${out.restored} restored`);
      }
    } catch (error) {
      console.error('Shift coverage sweep failed:', error.message);
    }
  });

  // Stale presence. An `AgentPresence.online` flag that is never cleared
  // leaves a closed laptop in the rotation, and `assignAgent` filters candidates
  // by exactly that flag — so dead agents silently absorb tickets.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { AgentPresence, SupportChatRoom } = require('../models');
      // A heartbeat moves `lastSeen`; anything quiet for over a minute has lost
      // the socket even if its `disconnect` handler never fired (hard kill,
      // network drop, app force-stop).
      const cutoff = new Date(Date.now() - 60 * 1000);
      await AgentPresence.updateMany(
        { online: true, lastSeen: { $lt: cutoff } },
        { $set: { online: false, currentRooms: [] } }
      );
      // Reconcile WIP counters against truth: the counter is a guard, the
      // room count is the ledger. Any drift (crash between claim and assign,
      // legacy rows) is corrected here.
      const counts = await SupportChatRoom.aggregate([
        { $match: { status: { $in: ['open', 'in_progress'] }, assignedAgent: { $exists: true, $ne: null } } },
        { $group: { _id: '$assignedAgent', n: { $sum: 1 } } },
      ]);
      const seen = [];
      for (const c of counts) {
        seen.push(c._id);
        await AgentPresence.updateOne({ agentId: c._id }, { $set: { openTickets: c.n } });
      }
      // Type matters: agentId is ObjectId, so $nin gets ObjectIds, not strings.
      await AgentPresence.updateMany({ agentId: { $nin: seen } }, { $set: { openTickets: 0 } });
    } catch (error) {
      console.error('Agent presence sweep failed:', error.message);
    }
  });

  // Idle tickets. Two-sided, 30-minute sweep:
  // - Customer-idle (agent answered, customer silent 24h): one system nudge
  //   (+push). Still silent 24h later: auto-resolve with a 48h-reopen note.
  //   Without this, dead tickets pile up in agents' Mine lists forever.
  // - Agent-idle (customer's message unanswered 15m on a human ticket):
  //   escalate to urgent + audit, so it surfaces in Breached.
  cron.schedule('*/30 * * * *', async () => {
    try {
      const { SupportChatRoom, SupportChatConversion } = require('../models');
      const { threadOf } = require('../services/support.chat.conversion.service');
      const fcmNotificationService = require('../services/fcm.notification.service');
      const now = Date.now();
      const NUDGE_MS = 24 * 60 * 60 * 1000;
      const RESOLVE_MS = 48 * 60 * 60 * 1000;
      const AGENT_IDLE_MS = 15 * 60 * 1000;

      const idleRooms = await SupportChatRoom.find({
        status: { $in: ['open', 'in_progress'] },
        handoverState: { $in: ['assigned', 'human'] },
        updatedAt: { $lt: new Date(now - AGENT_IDLE_MS) },
      })
        .limit(100)
        .select('_id userId supportType orders booking purchaseSubscription complaints reportIssue lastMessage updatedAt');

      for (const room of idleRooms) {
        const lastMsg = await SupportChatConversion.findOne({
          roomId: room._id,
          visibility: { $ne: 'internal' },
        })
          .sort({ createdAt: -1 })
          .select('senderRole createdAt')
          .lean();
        if (!lastMsg) continue;
        const idleMs = now - new Date(lastMsg.createdAt).getTime();
        const fresh = await SupportChatRoom.findById(room._id).select('audit').lean();
        const audit = (fresh && fresh.audit) || [];
        const nudged = audit.some((a) => a.action === 'idle:nudge');

        if (lastMsg.senderRole !== 'user' && idleMs >= NUDGE_MS && !nudged) {
          // Customer-idle: nudge once.
          const text = 'Are you still there? Reply to keep this chat open — it auto-closes after 48 hours of silence.';
          await SupportChatConversion.create({
            roomId: room._id,
            senderId: room.userId,
            message: text,
            messageType: 'text',
            senderRole: 'system',
            visibility: 'public',
            readStatus: 'sent',
          });
          await SupportChatRoom.findByIdAndUpdate(room._id, {
            $set: { lastMessage: text, lastMessageType: 'text' },
            $push: { audit: { action: 'idle:nudge', at: new Date() } },
          });
          fcmNotificationService.supportChatMessage(room.userId, room._id, text, threadOf(room)).catch(() => {});
        } else if (nudged && idleMs >= RESOLVE_MS) {
          // Still silent: auto-resolve. Reopen window logic lives in reopen.
          const text = 'Closed due to inactivity. You can reopen this chat within 48 hours if you still need help.';
          await SupportChatConversion.create({
            roomId: room._id,
            senderId: room.userId,
            message: text,
            messageType: 'text',
            senderRole: 'system',
            visibility: 'public',
            readStatus: 'sent',
          });
          await SupportChatRoom.findByIdAndUpdate(room._id, {
            $set: { status: 'resolved', handoverState: 'resolved', resolvedAt: new Date(), lastMessage: text },
            $push: { audit: { action: 'idle:auto-resolve', at: new Date() } },
          });
          fcmNotificationService.supportChatMessage(room.userId, room._id, text, threadOf(room)).catch(() => {});
        } else if (lastMsg.senderRole === 'user' && idleMs >= AGENT_IDLE_MS) {
          // Agent-idle: customer waiting. Escalate once per idle stretch.
          const escalated = audit.some(
            (a) => a.action === 'escalated:agent-idle' && new Date(a.at).getTime() > new Date(lastMsg.createdAt).getTime()
          );
          if (!escalated) {
            await SupportChatRoom.findByIdAndUpdate(room._id, {
              $set: { priority: 'urgent' },
              $push: { audit: { action: 'escalated:agent-idle', at: new Date() } },
            });
          }
        }
      }
    } catch (error) {
      console.error('Support idle sweep failed:', error.message);
    }
  });
  // Expired transfer offers: ownership never moved, so just clear the stale
  // offer, audit it, and tell the offering agent it lapsed — otherwise the
  // thread shows "awaiting receiver" forever on an offer nobody will take.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { SupportChatRoom } = require('../models');
      const expired = await SupportChatRoom.find({
        'pendingTransfer.expiresAt': { $lt: new Date() },
      })
        .select('_id pendingTransfer')
        .lean();
      for (const room of expired) {
        const byAgent = room.pendingTransfer && room.pendingTransfer.byAgent;
        await SupportChatRoom.updateOne(
          { _id: room._id },
          {
            $unset: { pendingTransfer: 1 },
            $push: { audit: { action: 'transfer:expired', at: new Date() } },
          }
        );
        if (byAgent) {
          try {
            const fcmNotificationService = require('../services/fcm.notification.service');
            fcmNotificationService
              .supportChatAgentAlert(byAgent, room._id, 'Your transfer offer expired with no answer', 'Transfer expired')
              .catch(() => {});
          } catch {
            // Best-effort only.
          }
        }
      }
    } catch (error) {
      console.error('Transfer expiry sweep failed:', error.message);
    }
  });

  // Queue-wait escalation: a ticket parked in `queued` for 10+ minutes is a
  // silent customer. Bump to urgent, audit once per wait stretch, and ping
  // the queue's online members — they are the ones who can take it. Without
  // this the queue has no voice; tickets only surface via the slower SLA.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { SupportChatRoom, SupportQueue, AgentPresence } = require('../models');
      const waiting = await SupportChatRoom.find({
        status: { $in: ['open', 'in_progress'] },
        handoverState: 'queued',
        updatedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) },
      })
        .limit(30)
        .select('_id queueId audit priority');
      for (const room of waiting) {
        const fresh = await SupportChatRoom.findById(room._id).select('audit').lean();
        const audit = (fresh && fresh.audit) || [];
        const escalated = audit.some(
          (a) => a.action === 'escalated:queue-wait' && new Date(a.at).getTime() > Date.now() - 60 * 60 * 1000
        );
        if (escalated) continue;
        await SupportChatRoom.findByIdAndUpdate(room._id, {
          $set: { priority: 'urgent' },
          $push: { audit: { action: 'escalated:queue-wait', at: new Date() } },
        });
        // Page the queue's online members (best-effort, never fatal).
        try {
          let memberIds = [];
          if (room.queueId) {
            const q = await SupportQueue.findById(room.queueId).select('members').lean();
            if (q) memberIds = q.members || [];
          }
          const online = await AgentPresence.find({
            agentId: { $in: memberIds },
            online: true,
            lastSeen: { $gte: new Date(Date.now() - 90 * 1000) },
          })
            .select('agentId')
            .lean();
          const fcmNotificationService = require('../services/fcm.notification.service');
          for (const p of online) {
            fcmNotificationService
              .supportChatAgentAlert(p.agentId, room._id, 'A ticket has waited 10+ minutes in queue', 'Queue escalation')
              .catch(() => {});
          }
        } catch {
          // Paging must never break the escalation itself.
        }
      }
    } catch (error) {
      console.error('Queue-wait escalation sweep failed:', error.message);
    }
  });
  // Re-queue tickets whose agent vanished. A room left `assigned` to a dead
  // agent sits forever: nothing reassigns it, and the customer waits on a
  // human who will never reply.
  cron.schedule('*/2 * * * *', async () => {
    try {
      const { SupportChatRoom, AgentPresence } = require('../models');
      const stale = await SupportChatRoom.find({
        status: { $in: ['open', 'in_progress'] },
        handoverState: { $in: ['assigned', 'human'] },
      })
        .limit(50)
        .select('_id assignedAgent');

      for (const room of stale) {
        if (!room.assignedAgent) continue;
        const presence = await AgentPresence.findOne({ agentId: room.assignedAgent })
          .select('online lastSeen cleanLogout')
          .lean();
        // Clean logout keeps the assignment: the agent is coming back, and
        // Mine must survive logout. Only vanished agents lose rooms.
        if (presence && presence.cleanLogout) continue;
        // 15-minute grace: a fresh logout or brief disconnect must not rip an
        // assigned ticket away instantly. Only genuinely abandoned rooms
        // (agent silent for 15+ minutes) return to the queue.
        const graceCutoff = new Date(Date.now() - 15 * 60 * 1000);
        const fresh =
          presence &&
          presence.online &&
          presence.lastSeen &&
          new Date(presence.lastSeen) >= new Date(Date.now() - 60 * 1000);
        if (fresh) continue;
        if (presence && presence.lastSeen && new Date(presence.lastSeen) >= graceCutoff) continue;

        // Reassign. `assignAgent` picks the least-loaded eligible agent and
        // re-stamps `slaDueAt`, so the ticket keeps its place rather than
        // restarting the clock. The vanished agent's slot frees first.
        await supportAssignmentService.releaseTicket(room.assignedAgent);
        await room.updateOne({ $set: { assignedAgent: null, handoverState: 'queued' } });
        await supportAssignmentService.assignAgent(room._id);
      }
    } catch (error) {
      console.error('Stale agent requeue sweep failed:', error.message);
    }
  });

  console.log('Support cron jobs scheduled');
};

module.exports = { startSupportCronJobs };