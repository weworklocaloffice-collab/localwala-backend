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
 * Support QA: risk-weighted sampling, reviews, and per-agent quality.
 *
 * Sampling uniformly at random is what makes QA useless. With 200 tickets a day
 * and 20 reviews, a uniform sample mostly catches the easy, one-line tickets and
 * a genuinely broken agent never gets looked at. So tickets are scored for risk
 * first and sampled from that distribution:
 *
 *   low CSAT        - the customer already said it went badly
 *   escalated       - something already went wrong enough to page a supervisor
 *   reopened        - the customer came back, i.e. it was not fixed
 *   long resolution - a ticket that dragged
 *   transferred     - bounced between people, usually a hard one
 *   merged          - duplicates cluster real problems
 *
 * The score is a PURE function and unit-tested: sampling decides what an agent's
 * quality number is made of, so it must not depend on database state to be
 * reproducible.
 */

const { SupportQaReview } = require('../models');
const CRITERIA = ['accuracy', 'empathy', 'resolution', 'compliance'];

// Long enough to be a real outlier without flagging every routine ticket.
const LONG_RESOLUTION_SEC = 3600;

/**
 * 0..100 risk score for one ticket. Higher = more worth a human's time.
 * Exported for tests; no I/O here on purpose.
 */
const riskScore = (t) => {
  let score = 10; // base: every ticket has some review value
  const reasons = [];

  // CSAT is the strongest signal a customer can give us.
  if (t.csat && typeof t.csat.score === 'number') {
    if (t.csat.score <= 2) {
      score += 40;
      reasons.push(`csat:${t.csat.score}`);
    } else if (t.csat.score === 3) {
      score += 15;
      reasons.push(`csat:${t.csat.score}`);
    }
  }

  if (t.escalationLevel > 0) {
    score += 30;
    reasons.push('escalated');
  }

  // A ticket that came back at least once was not solved the first time.
  const reopens = (t.audit || []).filter((a) => a.action === 'reopened').length;
  if (reopens > 0) {
    score += Math.min(25, 15 + (reopens - 1) * 10);
    reasons.push(`reopened:${reopens}`);
  }

  const transfers = (t.audit || []).filter(
    (a) => a.action === 'transfer' || a.action === 'transfer:forced' || a.action === 'transfer:accepted'
  ).length;
  if (transfers > 0) {
    score += Math.min(20, 10 + (transfers - 1) * 5);
    reasons.push(`transfers:${transfers}`);
  }

  if (t.mergedInto) {
    score += 10;
    reasons.push('merged');
  }

  if (t.createdAt && t.resolvedAt) {
    const secs = (new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()) / 1000;
    if (secs > LONG_RESOLUTION_SEC) {
      // Ramp rather than cliff: 1h is notable, 24h is serious.
      score += Math.min(25, Math.round((secs / LONG_RESOLUTION_SEC) * 8));
      reasons.push('long_resolution');
    }
  }

  return { score: Math.min(100, score), reasons };
};

/**
 * Weighted sampling without replacement, using a deterministic-ish but varied
 * selection: score is the weight, and a seeded offset avoids always returning the
 * same tickets when the caller re-samples.
 */
const weightedPick = (rows, n) => {
  const pool = rows.map((r) => ({ row: r, ...riskScore(r) }));
  const picked = [];
  const used = new Set();
  let cursor = Math.abs(Date.now() % Math.max(1, pool.length));
  while (picked.length < n && used.size < pool.length) {
    const total = pool.reduce((s, p, i) => (used.has(i) ? s : s + p.score), 0);
    if (total <= 0) break;
    let r = (cursor % 100) / 100 * total;
    for (let i = 0; i < pool.length; i += 1) {
      if (used.has(i)) continue;
      r -= pool[i].score;
      if (r <= 0) {
        used.add(i);
        picked.push(pool[i]);
        break;
      }
    }
    cursor += 7;
  }
  return picked;
};

/**
 * Sample handled tickets for review. Excludes tickets this reviewer has already
 * reviewed, so the queue is always fresh work.
 */
const sampleForReview = async (reviewerId, { days = 30, limit = 10, agentId = null } = {}) => {
  const { SupportChatRoom } = require('../models');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const query = {
    status: 'resolved',
    resolvedAt: { $gte: since },
    assignedAgent: { $exists: true, $ne: null },
  };
  if (agentId) query.assignedAgent = agentId;

  // Pull a wider pool than we need, then sample by risk from it. Random-sampling
  // the whole table in Mongo would risk the same easy tickets every time.
  const pool = await SupportChatRoom.find(query)
    .sort({ resolvedAt: -1 })
    .limit(Math.max(limit * 5, 50))
    .select('_id assignedAgent supportType priority csat escalationLevel mergedInto createdAt resolvedAt lastMessage audit')
    .lean();

  const already = await SupportQaReview.find({ reviewerId, roomId: { $in: pool.map((p) => p._id) } })
    .select('roomId')
    .lean();
  const seen = new Set(already.map((a) => String(a.roomId)));

  const fresh = pool.filter((p) => !seen.has(String(p._id)));
  const picked = weightedPick(fresh, limit);

  return picked.map((p) => ({
    roomId: String(p.row._id),
    agentId: String(p.row.assignedAgent),
    supportType: p.row.supportType,
    priority: p.row.priority,
    csat: p.row.csat && p.row.csat.score ? p.row.csat.score : null,
    riskScore: p.score,
    sampleReason: p.reasons.join(',') || 'baseline',
    lastMessage: p.row.lastMessage,
    resolvedAt: p.row.resolvedAt,
  }));
};

/** Mean of the rubric criteria actually assessed - unassessed ones are skipped. */
const overallFrom = (scores) => {
  const vals = CRITERIA.map((c) => Number(scores && scores[c])).filter(
    (v) => Number.isFinite(v) && v >= 1 && v <= 5
  );
  if (!vals.length) return null;
  return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10;
};

/**
 * Record a review. `overall` is always derived, so a reviewer cannot contradict
 * their own rubric; a mismatch in the body is ignored rather than trusted.
 */
const createReview = async (roomId, reviewerId, { scores = {}, comment = '' } = {}) => {
  const { SupportChatRoom } = require('../models');
  const room = await SupportChatRoom.findById(roomId)
    .select('_id assignedAgent csat')
    .lean();
  if (!room) return { error: 'Ticket not found' };
  if (!room.assignedAgent) return { error: 'This ticket has no assigned agent to review' };

  const clean = {};
  for (const c of CRITERIA) {
    const v = Number(scores[c]);
    if (Number.isFinite(v) && v >= 1 && v <= 5) clean[c] = Math.round(v);
  }
  if (!Object.keys(clean).length) return { error: 'At least one criterion score is required' };

  const existing = await SupportQaReview.findOne({ roomId, reviewerId }).select('_id').lean();
  if (existing) return { error: 'You have already reviewed this ticket' };

  const review = await SupportQaReview.create({
    roomId,
    agentId: room.assignedAgent,
    reviewerId,
    scores: clean,
    overall: overallFrom(clean),
    comment: comment ? String(comment).slice(0, 2000) : undefined,
    csatAtReview: room.csat && room.csat.score ? room.csat.score : undefined,
  });

  // Audit on the ticket itself, so the timeline shows QA happened.
  try {
    const { SupportChatRoom: Room } = require('../models');
    await Room.updateOne(
      { _id: roomId },
      { $push: { audit: { by: reviewerId, action: 'qa:reviewed', at: new Date(), meta: { overall: review.overall } } } }
    );
  } catch {
    // A missing audit line must not lose the review.
  }

  return { review: review.toJSON() };
};

/**
 * Per-agent quality over a window: rubric averages, review volume, CSAT, and
 * the gap between them.
 */
const agentQuality = async (days = 30) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await SupportQaReview.find({ createdAt: { $gte: since } })
    .select('agentId scores overall csatAtReview createdAt')
    .lean();

  const { User } = require('../models');
  const ids = [...new Set(rows.map((r) => String(r.agentId)))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('firstName lastName image role').lean() : [];
  const nameOf = {};
  for (const u of users) nameOf[String(u._id)] = `${u.firstName || ''} ${u.lastName || ''}`.trim();

  const byAgent = {};
  for (const r of rows) {
    const id = String(r.agentId);
    byAgent[id] = byAgent[id] || {
      agentId: id,
      name: nameOf[id] || id,
      reviewed: 0,
      totals: { accuracy: [], empathy: [], resolution: [], compliance: [] },
      overall: [],
      csat: [],
    };
    const a = byAgent[id];
    a.reviewed += 1;
    for (const c of CRITERIA) {
      const v = Number(r.scores && r.scores[c]);
      if (Number.isFinite(v)) a.totals[c].push(v);
    }
    if (typeof r.overall === 'number') a.overall.push(r.overall);
    if (typeof r.csatAtReview === 'number') a.csat.push(r.csatAtReview);
  }

  const mean = (arr) => (arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 100) / 100 : null);

  return {
    days,
    agents: Object.values(byAgent).map((a) => ({
      agentId: a.agentId,
      name: a.name,
      reviewed: a.reviewed,
      overall: mean(a.overall),
      csat: mean(a.csat),
      criteria: {
        accuracy: mean(a.totals.accuracy),
        empathy: mean(a.totals.empathy),
        resolution: mean(a.totals.resolution),
        compliance: mean(a.totals.compliance),
      },
    })).sort((x, y) => (y.overall || 0) - (x.overall || 0)),
  };
};

module.exports = {
  riskScore,
  weightedPick,
  sampleForReview,
  createReview,
  agentQuality,
  overallFrom,
  CRITERIA,
};