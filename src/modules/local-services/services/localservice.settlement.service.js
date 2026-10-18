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

const { fromPaise } = require('../../../utils/money');

/**
 * localservice.settlement.service — payable batching from RevenueEntry.
 * Pure summarize (no DB) + generate (writes kernel Settlement when the
 * provider has a linked Business; otherwise returns summary-only so
 * providers without a Business row still reconcile).
 */
function summarizeEntries(entries = []) {
  let fees = 0;
  let commission = 0;
  let platform = 0;
  let payable = 0;
  let reversals = 0;
  let count = 0;
  for (const e of entries) {
    const fee = Math.abs(fromPaise(e.bookingFee) || 0);
    const comm = Math.abs(fromPaise(e.commissionAmount) || 0);
    const plat = Math.abs(fromPaise(e.platformRevenue) || 0);
    const pay = Math.abs(fromPaise(e.providerPayable) || 0);
    if (e.entryType === 'reversal') reversals += plat;
    else {
      fees += fee;
      commission += comm;
      platform += plat;
      payable += pay;
      count += 1;
    }
  }
  const r2 = (n) => Number(n.toFixed(2));
  return { count, fees: r2(fees), commission: r2(commission), platform: r2(platform), payable: r2(payable), reversals: r2(reversals), net: r2(platform - reversals) };
}

async function generateSettlement({ providerId, from, to } = {}, { EntryModel, ProviderModel, SettlementModel } = {}) {
  const Entry = EntryModel || require('../models/localservice.revenue.entry.model');
  const Provider = ProviderModel || require('../models/localservice.provider.model');
  const Settlement = SettlementModel || require('../../../kernel/settlement/models/settlement.model');
  const provider = await Provider.findById(providerId);
  if (!provider) {
    const e = new Error('Provider not found');
    e.statusCode = 404;
    throw e;
  }
  const q = { status: 'applied', createdAt: { $gte: new Date(from), $lte: new Date(to) } };
  const entries = await Entry.find(q).lean();
  const summary = summarizeEntries(entries);
  // Without a linked Business there is no kernel counterparty — return summary.
  if (!provider.business) return { settlement: null, summary, note: 'no linked Business; summary only' };
  const last = await Settlement.findOne({ vertical: 'local_services' }).sort({ settlementNo: -1 }).lean();
  const settlement = await Settlement.create({
    settlementNo: (last ? last.settlementNo : 0) + 1,
    vertical: 'local_services',
    counterpartyType: 'commission_partner',
    counterparty: provider.business,
    settlementType: 'order_revenue',
    period: 'custom',
    from: new Date(from),
    to: new Date(to),
    totals: {
      orderCount: summary.count,
      grossOrderValue: Math.round(summary.platform + summary.payable),
      refunds: Math.round(summary.reversals),
      platformFees: Math.round(summary.platform),
      netAmount: Math.round(summary.payable),
    },
    status: 'pending',
  });
  return { settlement, summary };
}

module.exports = { summarizeEntries, generateSettlement, markSettlement };

const SETTLEMENT_TRANSITIONS = {
  pending: ['processing', 'settled', 'failed'],
  processing: ['settled', 'failed', 'disputed'],
  settled: ['reversed'],
  failed: ['processing'],
  disputed: ['settled', 'reversed'],
  reversed: [],
};

async function markSettlement(settlementId, to, { note } = {}, { SettlementModel } = {}) {
  const Settlement = SettlementModel || require('../../../kernel/settlement/models/settlement.model');
  const doc = await Settlement.findById(settlementId);
  if (!doc) {
    const e = new Error('Settlement not found');
    e.statusCode = 404;
    throw e;
  }
  if (!(SETTLEMENT_TRANSITIONS[doc.status] || []).includes(to)) {
    const e = new Error(`Illegal settlement transition ${doc.status} -> ${to}`);
    e.statusCode = 409;
    throw e;
  }
  doc.status = to;
  if (note) doc.notes = note;
  await doc.save();
  return doc;
}
