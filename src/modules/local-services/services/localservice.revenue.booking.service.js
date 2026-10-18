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
const ApiError = require('../../../utils/ApiError');
const revenueService = require('./localservice.revenue.service');

/**
 * localservice.revenue.booking.service — booking -> revenue bridge.
 *
 * Called by the (future) booking service when `qualifyingEvent` fires
 * (default COMPLETION_VERIFIED). This file owns NOTHING about slots, quotes
 * or assignment — only: resolve rule, calculate, freeze snapshot, write ONE
 * entry per idempotencyKey.
 *
 * Idempotency: `lsrev:{bookingId}:{ruleCode}:v{version}:{event}` unique.
 * Retried webhook / double-click / worker replay hits E11000 and returns the
 * existing entry instead of double-charging. No `find-then-insert` race.
 */

function buildBookingKey(bookingId, rule, event) {
  return `lsrev:${bookingId}:${rule.code}:v${rule.version}:${event}`;
}

function buildReversalKey(bookingId, rule, reason) {
  const safe = String(reason || 'cancel').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'cancel';
  return `lsrev:${bookingId}:${rule.code}:v${rule.version}:REVERSAL:${safe}`;
}

async function applyRevenueForBooking(
  { bookingId, scope = {}, amounts = {}, paymentId = null, event = 'COMPLETION_VERIFIED', actorId = null, atDate = new Date() },
  { RuleModel, EntryModel } = {}
) {
  if (!bookingId) throw new ApiError(httpStatus.BAD_REQUEST, 'bookingId required');
  const Rule = RuleModel || require('../models/localservice.revenue.rule.model');
  const Entry = EntryModel || require('../models/localservice.revenue.entry.model');

  const query = Rule.find({ status: 'active' });
  const rules = typeof query.lean === 'function' ? await query.lean() : await query;
  const { fromPaise } = require('../../../utils/money');
  const hydrated = (rules || []).map((r) => ({
    ...r,
    bookingFee: fromPaise(r.bookingFee),
    commissionFixedAmount: fromPaise(r.commissionFixedAmount),
    minimumCharge: fromPaise(r.minimumCharge),
    maximumCharge: fromPaise(r.maximumCharge),
  }));
  const rule = revenueService.resolveRule(hydrated, scope, atDate);
  if (!rule) throw new ApiError(httpStatus.NOT_FOUND, 'No active revenue rule for booking scope');
  if (rule.qualifyingEvent !== event) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Rule ${rule.code} qualifies on ${rule.qualifyingEvent}, got ${event}`);
  }
  const calc = revenueService.calculateRevenue(rule, amounts, { atDate });
  const idempotencyKey = buildBookingKey(bookingId, rule, event);
  try {
    const entry = await Entry.create({
      idempotencyKey,
      bookingId: String(bookingId),
      paymentId: paymentId || undefined,
      rule: rule._id,
      ruleSnapshot: calc.ruleSnapshot,
      labourAmount: calc.labourAmount,
      partsAmount: calc.partsAmount,
      serviceValue: amounts.serviceValue || 0,
      discountAmount: amounts.discountAmount || 0,
      bookingFee: calc.bookingFee,
      commissionBase: calc.commissionBase,
      commissionAmount: calc.commissionAmount,
      customerTotal: calc.customerTotal,
      providerPayable: calc.providerPayable,
      platformRevenue: calc.platformRevenue,
      currency: rule.currency || 'INR',
      payer: rule.payer || 'customer',
      qualifyingEvent: event,
      entryType: 'charge',
      status: 'applied',
      createdBy: actorId || undefined,
    });
    return { entry, calc, deduped: false };
  } catch (e) {
    if (e && (e.code === 11000 || String(e.message || '').includes('idempotencyKey'))) {
      const existing = await Entry.findOne({ idempotencyKey });
      if (existing) return { entry: existing, calc, deduped: true };
    }
    throw e;
  }
}

module.exports = { applyRevenueForBooking, reverseRevenueForBooking, buildBookingKey, buildReversalKey };

/**
 * Reversal — never edits the original charge. Creates a NEW entry with
 * negative amounts per the rule's refundReversalPolicy:
 *  - full_reverse: mirror entire fee+commission
 *  - prorated: scale by refundRatio (0-1)
 *  - no_reverse: returns null (e.g. post-completion no-show keeps fee)
 * Partial refunds pass refundRatio + reason; original stays `applied`,
 * reversal row carries the audit trail.
 */
async function reverseRevenueForBooking(
  { bookingId, reason = 'cancel', refundRatio = 1, actorId = null },
  { EntryModel } = {}
) {
  if (!bookingId) throw new ApiError(httpStatus.BAD_REQUEST, 'bookingId required');
  const Entry = EntryModel || require('../models/localservice.revenue.entry.model');
  const charges = await Entry.find({ bookingId: String(bookingId), entryType: 'charge', status: 'applied' });
  if (!charges || !charges.length) throw new ApiError(httpStatus.NOT_FOUND, 'No applied revenue to reverse');
  const out = [];
  for (const ch of charges) {
    const policy = (ch.ruleSnapshot && ch.ruleSnapshot.refundReversalPolicy) || ch.refundReversalPolicy || 'full_reverse';
    if (policy === 'no_reverse') continue;
    const ratio = policy === 'prorated' ? Math.min(1, Math.max(0, Number(refundRatio) || 0)) : 1;
    const snap = ch.ruleSnapshot || {};
    const key = buildReversalKey(bookingId, { code: snap.code || 'RULE', version: snap.version || 1 }, reason);
    const neg = (v) => -Math.round(Number(v) * ratio * 100) / 100;
    try {
      const rev = await Entry.create({
        idempotencyKey: key,
        bookingId: String(bookingId),
        paymentId: ch.paymentId || undefined,
        rule: ch.rule,
        ruleSnapshot: { ...snap, reversedFrom: String(ch._id || ch.idempotencyKey), reversalReason: reason, refundRatio: ratio },
        labourAmount: 0,
        partsAmount: 0,
        serviceValue: 0,
        discountAmount: 0,
        bookingFee: neg(ch.bookingFee),
        commissionBase: 0,
        commissionAmount: neg(ch.commissionAmount),
        customerTotal: neg((Number(ch.bookingFee) || 0) + (Number(ch.commissionAmount) || 0)),
        providerPayable: 0,
        platformRevenue: neg(ch.platformRevenue),
        currency: ch.currency || 'INR',
        payer: ch.payer,
        qualifyingEvent: ch.qualifyingEvent,
        entryType: 'reversal',
        status: 'applied',
        note: reason,
        createdBy: actorId || undefined,
      });
      out.push({ reversal: rev, deduped: false });
    } catch (e) {
      if (e && (e.code === 11000 || String(e.message || '').includes('idempotencyKey'))) {
        const existing = await Entry.findOne({ idempotencyKey: key });
        if (existing) {
          out.push({ reversal: existing, deduped: true });
          continue;
        }
      }
      throw e;
    }
  }
  return out;
}
