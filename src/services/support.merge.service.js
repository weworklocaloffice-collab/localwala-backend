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
 * Ticket merge + duplicate detection.
 *
 * A customer repeating the same problem opened a second ticket, which split the
 * history across two threads, split the CSAT across two rows, and let two agents
 * answer the same thing twice. Merging keeps one canonical ticket.
 *
 * The merge NEVER deletes anything. The newer ticket is marked `mergedInto` and
 * keeps every message; only its ownership and WIP slot move. Deleting rows
 * here would destroy the audit trail and the agent attribution that QA and
 * escalation both depend on.
 */

const mongoose = require('mongoose');
const { SupportChatRoom, SupportChatConversion, AgentPresence } = require('../models');
const ApiError = require('../utils/ApiError');
// Destructure, not the bare module: this version of http-status exports
// `{ default, status }`, so `httpStatus.CONFLICT` would be undefined and every
// ApiError below would carry `statusCode: undefined` - a 500 with no message.
const { status: httpStatus } = require('http-status');
const logger = require('../config/logger');

/**
 * Similarity between two ticket openings. Cheap and explainable on purpose:
 * a QA team needs to be able to say WHY something was flagged, and embeddings
 * would be a black box plus a dependency.
 *
 * Jaccard over word sets, plus a bonus for a shared rare word, minus a penalty
 * for wildly different lengths (two one-line tickets that share "hi" are not
 * duplicates).
 */
const normalise = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

// English filler plus support-chat pleasantries. The second group matters for
// false positives: "thanks for your help, order still not delivered" and "order
// delivered, thanks" share only filler, and without this list those two would
// look like the same ticket.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'are', 'was', 'not', 'have', 'this', 'that', 'with',
  'but', 'can', 'get', 'his', 'her', 'its', 'our', 'has', 'had', 'did', 'does',
  'from', 'they', 'them', 'been', 'will', 'would', 'there', 'when', 'what', 'your',
  'then', 'than', 'some', 'such', 'only', 'other', 'into', 'out', 'very', 'much',
  'also', 'any', 'all', 'who', 'whom', 'how', 'why', 'where', 'once', 'still',
  'hi', 'hello', 'hey', 'thanks', 'thank', 'please', 'pls', 'dear', 'sir', 'madam',
  'help', 'need', 'want', 'know', 'about', 'issue', 'problem', 'query', 'regarding',
  'team', 'support', 'customer', 'care', 'morning', 'evening', 'good', 'day',
  'greetings', 'regards', 'best', 'forward', 'again', 'anytime', 'quickly',
  // Short-phrasing filler: without these, "refund has not come yet" dilutes to
  // 0.33 because {come, yet} count as content the other ticket does not share.
  'yet', 'come', 'came', 'gone', 'got', 'done', 'said', 'tell', 'told', 'seen',
]);

// Negation flips the meaning of the word it sits in front of: "order not
// delivered" and "order delivered" share every content word and are opposite
// problems. Without this they scored high enough to suggest merging a complaint
// into a confirmation - the worst kind of false positive here.
const NEGATIONS = new Set(['not', 'no', 'never', 'none', 'cannot', 'wont', 'without']);

// Synonyms that customers and agents use interchangeably for one thing.
const CANONICAL = {
  delivered: 'delivery',
  delivery: 'delivery',
  arrived: 'delivery',
  arrival: 'delivery',
  received: 'receive',
  refund: 'refund',
  refunded: 'refund',
  payment: 'payment',
  paid: 'payment',
  debited: 'debit',
  deducted: 'debit',
  charged: 'charge',
  order: 'order',
  orders: 'order',
  missing: 'NOT_delivery',
  lost: 'NOT_delivery',
  wrong: 'wrong',
  incorrect: 'wrong',
  cancel: 'cancel',
  cancelled: 'cancel',
  canceled: 'cancel',
  return: 'return',
  returned: 'return',
};

const tokenise = (text) => {
  const out = [];
  let negateNext = false;
  for (const w of normalise(text)) {
    // Negation BEFORE the stopword filter. 'not' appears in both sets, and
    // checking stopwords first silently threw negation away - which made
    // "order not delivered" and "order delivered" a perfect 1.0 match.
    if (NEGATIONS.has(w)) {
      negateNext = true;
      continue;
    }
    if (STOPWORDS.has(w)) continue;
    const base = CANONICAL[w] || w;
    out.push(negateNext ? `NOT_${base}` : base);
    negateNext = false;
  }
  return new Set(out);
};

/**
 * 0..1 confidence that two openings describe the same problem.
 */
const similarity = (a, b) => {
  const A = tokenise(a);
  const B = tokenise(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  let conflicts = 0;
  for (const w of A) {
    if (B.has(w)) shared += 1;
    else if (w.startsWith('NOT_') && B.has(w.slice(4))) conflicts += 1;
    else if (B.has(`NOT_${w}`)) conflicts += 1;
  }
  // A direct contradiction disqualifies the pair outright. This is the guard
  // that stops "not delivered" being merged into "delivered".
  if (conflicts > 0 && shared === 0) return 0;
  if (!shared) return 0;

  const jaccard = shared / (A.size + B.size - shared);
  // Coverage of the SHORTER ticket matters more than Jaccard: if everything a
  // customer wrote the first time reappears the second time, that is a repeat.
  const coverage = shared / Math.min(A.size, B.size);
  let score = 0.5 * jaccard + 0.5 * coverage;
  // Two tickets of wildly different length are rarely the same issue.
  const lenRatio = Math.min(A.size, B.size) / Math.max(A.size, B.size);
  score *= 0.6 + 0.4 * lenRatio;
  // Contradictions reduce confidence but do not zero it: "order not delivered
  // and refund not received" vs "order not delivered, refund pending" is still
  // probably one problem.
  score *= 1 - Math.min(0.6, 0.3 * conflicts);
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
};

/**
 * Open/resolved tickets by this customer inside the lookback window, newest
 * first. Bounded and index-backed on purpose - this runs on ticket creation.
 */
const findCandidates = async (roomId, lookbackDays = 30, limit = 10) => {
  const room = await SupportChatRoom.findById(roomId).select('userId supportType').lean();
  if (!room || !room.userId) return [];
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const rows = await SupportChatRoom.find({
    userId: room.userId,
    _id: { $ne: room._id },
    mergedInto: { $exists: false },
    createdAt: { $gte: since },
    status: { $in: ['open', 'in_progress', 'resolved'] },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('_id supportType priority status lastMessage createdAt assignedAgent mergedInto')
    .lean();
  return rows;
};

/**
 * Rank this ticket against the customer's recent ones.
 * `threshold` is the confidence a human must clear before we suggest a merge -
 * the service only ever SUGGESTS; a merge always needs an explicit action.
 */
const detectDuplicates = async (roomId, threshold = 0.45) => {
  const room = await SupportChatRoom.findById(roomId).select('_id userId supportType lastMessage createdAt').lean();
  if (!room) return [];
  const candidates = await findCandidates(roomId);
  const scored = [];
  for (const c of candidates) {
    const score = similarity(room.lastMessage, c.lastMessage);
    if (score >= threshold) {
      scored.push({
        roomId: String(c._id),
        supportType: c.supportType,
        status: c.status,
        createdAt: c.createdAt,
        lastMessage: c.lastMessage,
        score,
        // Same category is a strong hint, but not required: customers routinely
        // file a complaint under a different type than the original.
        sameType: c.supportType === room.supportType,
      });
    }
  }
  return scored.sort((a, b) => b.score - a.score);
};

/**
 * Merge `sourceId` into `targetId`.
 *
 * Guards, in order:
 *  - both tickets must exist and be different
 *  - neither may already be merged away (no chains: A->B, then B->C is blocked)
 *  - same customer, otherwise this is not a duplicate at all
 */
const mergeTickets = async (sourceId, targetId, byAgent = null) => {
  const [source, target] = await Promise.all([
    SupportChatRoom.findById(sourceId).lean(),
    SupportChatRoom.findById(targetId).lean(),
  ]);
  if (!source || !target) throw new ApiError(httpStatus.NOT_FOUND, 'Ticket not found');
  if (String(source._id) === String(target._id)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot merge a ticket into itself');
  }
  if (source.mergedInto || target.mergedInto) {
    throw new ApiError(httpStatus.CONFLICT, 'One of these tickets is already merged');
  }
  if (String(source.userId) !== String(target.userId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only tickets from the same customer can be merged');
  }

  // The canonical ticket keeps its identity; the duplicate is retired. Swapping
  // the OTHER direction would let an agent bury an older, richer thread.
  const claimed = await SupportChatRoom.findOneAndUpdate(
    { _id: sourceId, mergedInto: { $exists: false } },
    {
      $set: {
        mergedInto: target._id,
        mergedBy: byAgent ? new mongoose.Types.ObjectId(byAgent) : undefined,
        mergedAt: new Date(),
        // Resolve the duplicate so it stops appearing in queue views and so its
        // WIP slot is freed. It remains readable via its own thread link.
        status: 'resolved',
        handoverState: 'resolved',
        resolvedAt: new Date(),
      },
      $push: {
        audit: {
          by: byAgent ? new mongoose.Types.ObjectId(byAgent) : undefined,
          action: 'merged',
          at: new Date(),
          meta: { into: target._id },
        },
      },
    },
    { returnDocument: 'after' }
  );
  if (!claimed) throw new ApiError(httpStatus.CONFLICT, 'Ticket already merged by someone else');

  // Ownership moves only if the duplicate actually held it. Otherwise the
  // canonical ticket stays as it was and no slot needs freeing.
  if (claimed.assignedAgent) {
    const supportAssignmentService = require('./support.assignment.service');
    await supportAssignmentService.releaseTicket(claimed.assignedAgent);
    if (target.assignedAgent) {
      // Both sides were owned: the canonical owner keeps theirs, and the
      // duplicate's agent is only credited as a collaborator.
      await SupportChatRoom.updateOne(
        { _id: target._id },
        { $addToSet: { collaborators: claimed.assignedAgent } }
      );
    } else {
      await SupportChatRoom.updateOne(
        { _id: target._id },
        { $set: { assignedAgent: claimed.assignedAgent, handoverState: 'human' } }
      );
    }
  }

  // Preserve the earlier history: rewrite the duplicate's message rows to point
  // at the canonical ticket so the transcript reads as one thread. `roomId` is
  // NOT changed - SupportChatConversion embeds roomId and a bulk rewrite would
  // invalidate deep links the customer already has. Instead we leave the rows
  // and let the canonical thread show a "merged from" pointer.
  await SupportChatRoom.updateOne(
    { _id: target._id },
    {
      $push: {
        audit: {
          by: byAgent ? new mongoose.Types.ObjectId(byAgent) : undefined,
          action: 'merged-into',
          at: new Date(),
          meta: { from: source._id },
        },
      },
    }
  );

  // Tell the customer, so a disappearing ticket is not a silent one.
  try {
    const { SupportChatConversion } = require('../models');
    await SupportChatConversion.create({
      roomId: target._id,
      senderId: source.userId,
      message: 'This conversation was merged with an earlier ticket about the same issue.',
      messageType: 'system',
      senderRole: 'system',
      visibility: 'public',
      readStatus: 'sent',
    });
  } catch (e) {
    logger.error(`Merge notice failed for room ${target._id}: ${e.message}`);
  }

  return { merged: String(source._id), into: String(target._id) };
};

/** Manual un-merge, for the case where a merge was wrong. */
const unmergeTicket = async (roomId, byAgent = null) => {
  const room = await SupportChatRoom.findOneAndUpdate(
    { _id: roomId, mergedInto: { $exists: true } },
    {
      $set: {
        mergedInto: undefined,
        mergedBy: undefined,
        mergedAt: undefined,
        status: 'open',
        handoverState: 'human',
      },
      $push: {
        audit: {
          by: byAgent ? new mongoose.Types.ObjectId(byAgent) : undefined,
          action: 'unmerged',
          at: new Date(),
        },
      },
    },
    { returnDocument: 'after' }
  );
  if (!room) throw new ApiError(httpStatus.NOT_FOUND, 'Ticket is not merged');
  return room;
};

module.exports = {
  similarity,
  detectDuplicates,
  mergeTickets,
  unmergeTicket,
  findCandidates,
};