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

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const ApiError = require('../../../utils/ApiError');
const LocalServiceRevenueRule = require('../models/localservice.revenue.rule.model');
const LocalServiceRevenueEntry = require('../models/localservice.revenue.entry.model');
const revenueService = require('../services/localservice.revenue.service');

const ALLOWED_TRANSITIONS = {
  draft: ['pending_approval', 'archived'],
  pending_approval: ['approved', 'archived'],
  approved: ['scheduled', 'active', 'archived'],
  scheduled: ['active', 'archived'],
  active: ['suspended', 'expired', 'archived'],
  suspended: ['active', 'archived'],
  expired: ['archived'],
  archived: [],
};

const assertTransition = (from, to) => {
  if (!(ALLOWED_TRANSITIONS[from] || []).includes(to)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Illegal revenue-rule transition ${from} -> ${to}`);
  }
};

const createRule = catchAsync(async (req, res) => {
  const rule = await LocalServiceRevenueRule.create({ ...req.body, createdBy: req.user._id, status: 'draft' });
  res.status(httpStatus.CREATED).send({ rule });
});

const listRules = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'revenueModel', 'categoryKey', 'serviceKey']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await LocalServiceRevenueRule.paginate(filter, options);
  res.status(httpStatus.OK).send(result);
});

const getRule = catchAsync(async (req, res) => {
  const rule = await LocalServiceRevenueRule.findById(req.params.id);
  if (!rule) throw new ApiError(httpStatus.NOT_FOUND, 'Revenue rule not found');
  res.status(httpStatus.OK).send({ rule, specificity: rule.scopeSpecificity(), inForce: rule.isInForceOn(new Date()) });
});

const cloneRule = catchAsync(async (req, res) => {
  const src = await LocalServiceRevenueRule.findById(req.params.id);
  if (!src) throw new ApiError(httpStatus.NOT_FOUND, 'Revenue rule not found');
  const obj = src.toObject();
  delete obj._id;
  delete obj.createdAt;
  delete obj.updatedAt;
  const rule = await LocalServiceRevenueRule.create({
    ...obj,
    code: `${obj.code}-CLONE`,
    version: 1,
    status: 'draft',
    createdBy: req.user._id,
    supersedes: src._id,
  });
  res.status(httpStatus.CREATED).send({ rule });
});

const transitionRule = catchAsync(async (req, res) => {
  const { id, status } = req.params;
  const rule = await LocalServiceRevenueRule.findById(id);
  if (!rule) throw new ApiError(httpStatus.NOT_FOUND, 'Revenue rule not found');
  assertTransition(rule.status, status);
  // Approval requires note + approver; activation stamps audit.
  if (status === 'approved' && !req.body.approvalNote) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'approvalNote required to approve');
  }
  const from = rule.status;
  rule.status = status;
  rule.updatedBy = req.user._id;
  if (status === 'approved') {
    rule.approvedBy = req.user._id;
    rule.approvedAt = new Date();
    rule.approvalNote = req.body.approvalNote;
  }
  if (status === 'active') {
    rule.activatedBy = req.user._id;
    rule.activatedAt = new Date();
  }
  if (status === 'suspended') rule.suspendReason = req.body.reason || 'suspended by admin';
  await rule.save();
  try {
    const RuleHistory = require('../models/localservice.rule.history.model');
    await RuleHistory.create({ rule: rule._id, from, to: status, actor: req.user._id, note: req.body.approvalNote || req.body.reason || undefined });
  } catch (e) {
    console.error('LocalServices rule audit failed:', e.message);
  }
  res.status(httpStatus.OK).send({ rule });
});

const previewRevenue = catchAsync(async (req, res) => {
  const atDate = req.body.atDate ? new Date(req.body.atDate) : new Date();
  const rules = await LocalServiceRevenueRule.find({ status: 'active' }).lean();
  // lean() returns paise for money fields — service works in rupees, so hydrate minimally
  const { fromPaise } = require('../../../utils/money');
  const hydrated = rules.map((r) => ({ ...r, bookingFee: fromPaise(r.bookingFee), commissionFixedAmount: fromPaise(r.commissionFixedAmount), minimumCharge: fromPaise(r.minimumCharge), maximumCharge: fromPaise(r.maximumCharge) }));
  const rule = revenueService.resolveRule(hydrated, req.body, atDate);
  if (!rule) throw new ApiError(httpStatus.NOT_FOUND, 'No active rule for scope');
  const calc = revenueService.calculateRevenue(rule, req.body, { atDate });
  res.status(httpStatus.OK).send({ rule: { code: rule.code, version: rule.version }, estimate: true, ...calc });
});

const getMapping = catchAsync(async (req, res) => {
  // Effective policy display: full inheritance chain platform > category > sub > service
  const atDate = req.query.atDate ? new Date(req.query.atDate) : new Date();
  const q = pick(req.query, ['categoryKey', 'subcategoryKey', 'serviceKey']);
  const rules = await LocalServiceRevenueRule.find({ status: 'active' }).lean();
  const chain = [null, q.categoryKey || null, q.subcategoryKey || null, q.serviceKey || null];
  const levels = ['platform', 'category', 'subcategory', 'service'].map((level, i) => {
    const scope = {};
    if (i >= 1 && chain[1]) scope.categoryKey = chain[1];
    if (i >= 2 && chain[2]) scope.subcategoryKey = chain[2];
    if (i >= 3 && chain[3]) scope.serviceKey = chain[3];
    const { fromPaise } = require('../../../utils/money');
    const hydrated = rules.map((r) => ({ ...r, bookingFee: fromPaise(r.bookingFee) }));
    const rule = revenueService.resolveRule(
      hydrated.filter((r) => {
        const s = (r.provider ? 4 : r.serviceKey ? 3 : r.subcategoryKey ? 2 : r.categoryKey ? 1 : 0);
        return s <= i;
      }),
      scope,
      atDate
    );
    return { level, scope, rule: rule ? { code: rule.code, version: rule.version, bookingFeeEnabled: rule.bookingFeeEnabled, commissionEnabled: rule.commissionEnabled } : null };
  });
  const effective = levels.filter((l) => l.rule).pop();
  res.status(httpStatus.OK).send({ chain: levels, effective });
});

const exportEntries = catchAsync(async (req, res) => {
  // CSV export of revenue entries (query filters shared with listEntries).
  // Amounts via getters (rupees); never aggregate paise here.
  const filter = pick(req.query, ['bookingId', 'status', 'entryType']);
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }
  const rows = await LocalServiceRevenueEntry.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
  const { fromPaise } = require('../../../utils/money');
  const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['bookingId,entryType,bookingFee,commission,platform,payable,status,createdAt'];
  for (const e of rows) {
    lines.push(
      [
        csv(e.bookingId),
        csv(e.entryType),
        csv(fromPaise(e.bookingFee)),
        csv(fromPaise(e.commissionAmount)),
        csv(fromPaise(e.platformRevenue)),
        csv(fromPaise(e.providerPayable)),
        csv(e.status),
        csv(e.createdAt ? new Date(e.createdAt).toISOString() : ''),
      ].join(',')
    );
  }
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="ls-revenue-entries.csv"');
  res.status(httpStatus.OK).send(lines.join('\n'));
});

const listEntries = catchAsync(async (req, res) => {  const filter = pick(req.query, ['bookingId', 'status', 'entryType', 'ruleSnapshot.categoryKey', 'ruleSnapshot.serviceKey']);
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await LocalServiceRevenueEntry.paginate(filter, options);
  res.status(httpStatus.OK).send(result);
});

const revenueSummary = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['bookingId', 'status', 'ruleSnapshot.categoryKey', 'ruleSnapshot.serviceKey']);
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }
  const entries = await LocalServiceRevenueEntry.find(filter).lean();
  const { fromPaise } = require('../../../utils/money');
  let fees = 0, commission = 0, platform = 0, payable = 0, customer = 0, reversals = 0;
  for (const e of entries) {
    const sign = e.entryType === 'reversal' ? -1 : 1;
    // lean paise -> rupees; reversal rows already negative, so take abs then sign
    const fee = Math.abs(fromPaise(e.bookingFee));
    const comm = Math.abs(fromPaise(e.commissionAmount));
    const plat = Math.abs(fromPaise(e.platformRevenue));
    const pay = Math.abs(fromPaise(e.providerPayable));
    const cust = Math.abs(fromPaise(e.customerTotal));
    if (e.entryType === 'reversal') reversals += plat;
    else {
      fees += fee;
      commission += comm;
      platform += plat;
      payable += pay;
      customer += cust;
    }
  }
  void sign;
  res.status(httpStatus.OK).send({
    grossBookingValue: Number(customer.toFixed(2)),
    bookingFees: Number(fees.toFixed(2)),
    commission: Number(commission.toFixed(2)),
    platformRevenue: Number(platform.toFixed(2)),
    providerPayable: Number(payable.toFixed(2)),
    reversals: Number(reversals.toFixed(2)),
    netRevenue: Number((platform - reversals).toFixed(2)),
    count: entries.length,
  });
});

const settlementService = require('../services/localservice.settlement.service');

const generateSettlement = catchAsync(async (req, res) => {
  const { settlement, summary, note } = await settlementService.generateSettlement(req.body);
  res.status(httpStatus.CREATED).send({ settlement, summary, note: note || undefined });
});

const markSettlement = catchAsync(async (req, res) => {
  const doc = await settlementService.markSettlement(req.params.id, req.params.status, req.body);
  res.status(httpStatus.OK).send({ settlement: doc });
});

module.exports = { createRule, listRules, getRule, cloneRule, transitionRule, previewRevenue, getMapping, listEntries, exportEntries, revenueSummary, generateSettlement, markSettlement, assertTransition };
