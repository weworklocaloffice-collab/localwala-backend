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
 * localservice.lead.service — qualify() writes exactly one LEAD_FEE entry.
 * Lead fee rides the rule's bookingFee field (commission must be OFF —
 * validated). Invalid leads reverse via revenue.booking.service.
 */
async function qualifyLead(leadId, { actorId } = {}, { LeadModel, RuleModel, EntryModel } = {}) {
  const Lead = LeadModel || require('../models/localservice.lead.model');
  const Rule = RuleModel || require('../models/localservice.revenue.rule.model');
  const Entry = EntryModel || require('../models/localservice.revenue.entry.model');
  const lead = await Lead.findById(leadId);
  if (!lead) throw new ApiError(httpStatus.NOT_FOUND, 'Lead not found');
  if (lead.qualified) {
    const existing = await Entry.findOne({ bookingId: String(lead._id), entryType: 'charge' });
    return { lead, entry: existing, deduped: true };
  }
  // Claim: qualifying provider owns the lead from here (open board -> mine).
  if (actorId) {
    try {
      const Provider = require('../models/localservice.provider.model');
      const provider = await Provider.findOne({ owner: actorId });
      if (provider) lead.provider = provider._id;
    } catch (e) {
      console.error('LocalServices lead claim failed:', e.message);
    }
  }
  const q = Rule.find({ status: 'active', revenueModel: 'LEAD_FEE' });
  const rules = typeof q.lean === 'function' ? await q.lean() : await q;
  const { fromPaise } = require('../../../utils/money');
  const hydrated = (rules || []).map((r) => ({ ...r, bookingFee: fromPaise(r.bookingFee) }));
  const rule = revenueService.resolveRule(
    hydrated,
    { categoryKey: lead.categoryKey, serviceKey: lead.serviceKey },
    new Date()
  );
  if (!rule) throw new ApiError(httpStatus.NOT_FOUND, 'No active LEAD_FEE rule');
  const calc = revenueService.calculateRevenue(rule, { labourAmount: 0, partsAmount: 0 }, {});
  const key = revenueService.buildIdempotencyKey(String(lead._id), rule.code, rule.version);
  try {
    const entry = await Entry.create({
      idempotencyKey: key,
      bookingId: String(lead._id),
      rule: rule._id,
      ruleSnapshot: calc.ruleSnapshot,
      labourAmount: 0,
      partsAmount: 0,
      bookingFee: calc.bookingFee,
      commissionBase: 0,
      commissionAmount: 0,
      customerTotal: calc.bookingFee,
      providerPayable: 0,
      platformRevenue: calc.bookingFee,
      currency: rule.currency || 'INR',
      payer: rule.payer || 'provider',
      qualifyingEvent: rule.qualifyingEvent || 'QUOTE_ACCEPTED',
      entryType: 'charge',
      status: 'applied',
      createdBy: actorId || undefined,
    });
    lead.qualified = true;
    lead.status = 'ACCEPTED';
    lead.leadFee = calc.bookingFee;
    lead.revenueEntry = entry._id || undefined;
    await lead.save();
    return { lead, entry, deduped: false };
  } catch (e) {
    if (e && (e.code === 11000 || String(e.message || '').includes('idempotencyKey'))) {
      const existing = await Entry.findOne({ idempotencyKey: key });
      return { lead, entry: existing, deduped: true };
    }
    throw e;
  }
}

module.exports = { qualifyLead };
