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
const { SupportChatRoom, User } = require('../models');

// GET /support_team/stats/overview?days=30 — one aggregation for the KPI
// board: volume, first-response + resolution averages, containment, CSAT,
// SLA compliance, and a per-agent table. Bounded by `days`.
// Role-scoped: agents see ONLY their own numbers (assignedAgent = self);
// supervisors see the floor. The panel never decides scope — the server does.
const statsOverview = catchAsync(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const callerRole = req.user && req.user.role;
  const callerId = req.user && (req.user._id || req.user.id);
  const scopedAgent =
    callerRole === 'supportSupervisor' ? req.query.agent || null : callerId;
  const scope = scopedAgent ? { assignedAgent: new mongoose.Types.ObjectId(scopedAgent) } : {};

  const matchWindow = { createdAt: { $gte: since }, ...scope };
  const [total, openNow, resolvedRooms, respondedRooms, handovers, breached, loadNow] =
    await Promise.all([
      SupportChatRoom.countDocuments(matchWindow),
      SupportChatRoom.countDocuments({ status: { $in: ['open', 'in_progress'] }, ...scope }),
      SupportChatRoom.find({ ...matchWindow, status: 'resolved', resolvedAt: { $exists: true } })
        .select('createdAt resolvedAt assignedAgent')
        .lean(),
      SupportChatRoom.find({ ...matchWindow, firstResponseAt: { $exists: true } })
        .select('createdAt firstResponseAt assignedAgent')
        .lean(),
      SupportChatRoom.countDocuments({ ...matchWindow, 'audit.action': { $in: ['handover', 'bot:handover'] } }),
      SupportChatRoom.countDocuments({ ...matchWindow, 'audit.action': 'sla:breach' }),
      SupportChatRoom.aggregate([
        { $match: { status: { $in: ['open', 'in_progress'] }, assignedAgent: { $exists: true, $ne: null } } },
        { $group: { _id: '$assignedAgent', open: { $sum: 1 } } },
      ]),
    ]);

  const avgSec = (rows, from, to) => {
    const ds = rows
      .map((r) => (r[to] && r[from] ? (new Date(r[to]).getTime() - new Date(r[from]).getTime()) / 1000 : null))
      .filter((d) => d !== null && d >= 0);
    if (!ds.length) return null;
    return Math.round(ds.reduce((s, d) => s + d, 0) / ds.length);
  };

  const csatRows = await SupportChatRoom.aggregate([
    { $match: { ...matchWindow, 'csat.score': { $gt: 0 } } },
    { $group: { _id: null, avg: { $avg: '$csat.score' }, n: { $sum: 1 } } },
  ]);
  const csatDist = await SupportChatRoom.aggregate([
    { $match: { ...matchWindow, 'csat.score': { $gt: 0 } } },
    { $group: { _id: '$csat.score', n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const csatByAgent = await SupportChatRoom.aggregate([
    { $match: { ...matchWindow, 'csat.score': { $gt: 0 }, assignedAgent: { $exists: true, $ne: null } } },
    { $group: { _id: '$assignedAgent', avg: { $avg: '$csat.score' }, n: { $sum: 1 } } },
  ]);
  const csatAgentMap = {};
  for (const c of csatByAgent) csatAgentMap[String(c._id)] = { avg: Math.round(c.avg * 10) / 10, n: c.n };

  const perAgent = {};
  for (const r of resolvedRooms) {
    const id = r.assignedAgent ? String(r.assignedAgent) : 'unassigned';
    perAgent[id] = perAgent[id] || { agentId: id, resolved: 0 };
    perAgent[id].resolved += 1;
  }
  for (const r of respondedRooms) {
    const id = r.assignedAgent ? String(r.assignedAgent) : 'unassigned';
    perAgent[id] = perAgent[id] || { agentId: id, resolved: 0 };
    const d =
      r.firstResponseAt && r.createdAt
        ? (new Date(r.firstResponseAt).getTime() - new Date(r.createdAt).getTime()) / 1000
        : null;
    if (d !== null && d >= 0) {
      perAgent[id].frt = perAgent[id].frt || [];
      perAgent[id].frt.push(d);
    }
  }
  const agentIds = Object.keys(perAgent).filter((i) => i !== 'unassigned');
  const users = agentIds.length
    ? await User.find({ _id: { $in: agentIds } }).select('firstName lastName image').lean()
    : [];
  const nameOf = {};
  for (const u of users) nameOf[String(u._id)] = `${u.firstName || ''} ${u.lastName || ''}`.trim();
  const loadMap = {};
  for (const l of loadNow) loadMap[String(l._id)] = l.open;
  const agents = Object.values(perAgent).map((a) => ({
    agentId: a.agentId,
    name: nameOf[a.agentId] || a.agentId,
    openNow: loadMap[a.agentId] || 0,
    resolved: a.resolved,
    avgFrtSec:
      a.frt && a.frt.length ? Math.round(a.frt.reduce((s, d) => s + d, 0) / a.frt.length) : null,
    csatAvg: csatAgentMap[a.agentId] ? csatAgentMap[a.agentId].avg : null,
    csatCount: csatAgentMap[a.agentId] ? csatAgentMap[a.agentId].n : 0,
  }));

  res.send({
    success: true,
    days,
    total,
    openNow,
    resolved: resolvedRooms.length,
    avgFirstResponseSec: avgSec(respondedRooms, 'createdAt', 'firstResponseAt'),
    avgResolutionSec: avgSec(resolvedRooms, 'createdAt', 'resolvedAt'),
    containmentPct: total ? Math.round(((total - handovers) / total) * 100) : null,
    csatAvg: csatRows.length ? Math.round(csatRows[0].avg * 10) / 10 : null,
    csatCount: csatRows.length ? csatRows[0].n : 0,
    csatDist: csatDist.map((d) => ({ score: d._id, n: d.n })),
    slaCompliancePct: total ? Math.round(((total - breached) / total) * 100) : null,
    agents,
  });
});

module.exports = { statsOverview };

// GET /support_team/stats/tickets/export?agent=&from=&to= — register-level
// CSV: one row per ticket with agent, state, SLA flags, CSAT. Date-bounded
// (default 30d, max 365d).
const ticketsExport = catchAsync(async (req, res) => {
  const { agent, from, to } = req.query;
  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || toDate - fromDate > 365 * 24 * 60 * 60 * 1000) {
    res.status(400).send({ success: false, code: 400, message: 'Invalid date range (max 365 days)', extra: null });
    return;
  }
  const filter = { createdAt: { $gte: fromDate, $lte: toDate } };
  if (agent) filter.assignedAgent = agent;
  const rooms = await SupportChatRoom.find(filter)
    .sort({ createdAt: -1 })
    .limit(2000)
    .populate('userId', 'firstName lastName')
    .populate('assignedAgent', 'firstName lastName')
    .select('userId assignedAgent supportType status handoverState priority createdAt resolvedAt firstResponseAt slaDueAt csat')
    .lean();
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const name = (u) => (u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '');
  const lines = [
    'ticket_id,customer,agent,type,status,stage,priority,created_at,resolved_at,first_response_at,sla_due_at,csat,breached',
    ...rooms.map((r) => {
      const breached = (r.slaDueAt && new Date(r.slaDueAt) < new Date() && r.status !== 'resolved') ? 'yes' : 'no';
      return [
        String(r._id),
        name(r.userId),
        name(r.assignedAgent),
        r.supportType,
        r.status,
        r.handoverState,
        r.priority,
        r.createdAt ? new Date(r.createdAt).toISOString() : '',
        r.resolvedAt ? new Date(r.resolvedAt).toISOString() : '',
        r.firstResponseAt ? new Date(r.firstResponseAt).toISOString() : '',
        r.slaDueAt ? new Date(r.slaDueAt).toISOString() : '',
        (r.csat && r.csat.score) || '',
        breached,
      ].map(cell).join(',');
    }),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="support-tickets-export.csv"');
  res.send(`\uFEFF${lines.join('\n')}`);
});

module.exports = { statsOverview, ticketsExport };
