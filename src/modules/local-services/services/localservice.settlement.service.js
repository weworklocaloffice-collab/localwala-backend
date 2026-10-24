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
  let reversalFees = 0;
  let reversalCommission = 0;
  let reversalPayable = 0;
  let count = 0;
  for (const e of entries) {
    const fee = Math.abs(fromPaise(e.bookingFee) || 0);
    const comm = Math.abs(fromPaise(e.commissionAmount) || 0);
    const plat = Math.abs(fromPaise(e.platformRevenue) || 0);
    const pay = Math.abs(fromPaise(e.providerPayable) || 0);
    if (e.entryType === 'reversal') {
      reversals += plat;
      reversalFees += fee;
      reversalCommission += comm;
      reversalPayable += pay;
    } else {
      fees += fee;
      commission += comm;
      platform += plat;
      payable += pay;
      count += 1;
    }
  }
  const r2 = (n) => Number(n.toFixed(2));
  return {
    count,
    fees: r2(fees),
    commission: r2(commission),
    platform: r2(platform),
    payable: r2(payable),
    reversals: r2(reversals),
    reversalFees: r2(reversalFees),
    reversalCommission: r2(reversalCommission),
    reversalPayable: r2(reversalPayable),
    netFees: r2(fees - reversalFees),
    netCommission: r2(commission - reversalCommission),
    netPlatform: r2(platform - reversals),
    netPayable: r2(payable - reversalPayable),
    net: r2(platform - reversals),
  };
}

/**
 * Bookings whose payout must be held.
 *
 * A DISPUTED booking is money the platform has collected but may have to
 * return. Paying the provider while the dispute is open would move money the
 * platform does not own, so those entries are excluded from the batch and
 * stay in the unsettled pool until the dispute closes.
 */
const HELD_BOOKING_STATUSES = Object.freeze(['DISPUTED']);

async function loadHeldBookingIds(entries, { BookingModel } = {}) {
  const ids = [...new Set((entries || []).map((e) => e.bookingId).filter(Boolean))];
  if (!ids.length) return new Set();
  const Booking = BookingModel || require('../models/localservice.booking.model');
  const rows = await Booking.find({ _id: { $in: ids } })
    .select('_id status')
    .lean();
  return new Set(
    rows
      .filter((r) => HELD_BOOKING_STATUSES.includes(r.status))
      .map((r) => String(r._id))
  );
}

/**
 * Read the current global maximum settlement number.
 *
 * Tolerant of both a Mongoose query (`findOne().sort().lean()`) and a plain
 * stub that resolves the document directly.
 */
async function readMaxSettlementNo(Settlement) {
  const query = Settlement.findOne();
  let last;
  if (query && typeof query.sort === 'function') {
    const sorted = query.sort({ settlementNo: -1 });
    last = sorted && typeof sorted.lean === 'function' ? await sorted.lean() : await sorted;
  } else {
    last = await query;
  }
  return last ? Number(last.settlementNo || 0) : 0;
}

/**
 * Create a settlement row with a globally unique number.
 *
 * The retry lives here rather than in `generateSettlement` so every caller
 * (batch generation and any future manual settlement) gets the same
 * guarantee.
 */
async function createSettlementWithUniqueNumber(Settlement, payload, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const next = (await readMaxSettlementNo(Settlement)) + 1;
    try {
      return await Settlement.create({ ...payload, settlementNo: next });
    } catch (e) {
      if (e && e.code === 11000 && attempt < attempts - 1) {
        // Another vertical took the number first: re-read the maximum and retry.
        continue;
      }
      throw e;
    }
  }
  throw new ApiError(httpStatus.CONFLICT, 'Could not allocate a settlement number');
}

async function generateSettlement(
  { providerId, from, to } = {},
  { EntryModel, ProviderModel, SettlementModel, BookingModel } = {}
) {
  const Entry = EntryModel || require('../models/localservice.revenue.entry.model');
  const Provider = ProviderModel || require('../models/localservice.provider.model');
  const Settlement = SettlementModel || require('../../../kernel/settlement/models/settlement.model');
  const provider = await Provider.findById(providerId);
  if (!provider) {
    const e = new Error('Provider not found');
    e.statusCode = 404;
    throw e;
  }
  const q = {
    provider: providerId,
    status: 'applied',
    settlement: null,
    createdAt: { $gte: new Date(from), $lte: new Date(to) },
  };
  const allEntries = await Entry.find(q).lean();
  // Disputed bookings are held back: their payout waits for the dispute.
  const heldIds = await loadHeldBookingIds(allEntries, { BookingModel });
  const entries = allEntries.filter((e) => !heldIds.has(String(e.bookingId)));
  const heldEntries = allEntries.filter((e) => heldIds.has(String(e.bookingId)));
  const summary = summarizeEntries(entries);
  const heldSummary = summarizeEntries(heldEntries);
  // Without a linked Business there is no kernel counterparty — return summary.
  if (!provider.business) {
    return {
      settlement: null,
      summary,
      held: heldSummary,
      note: 'no linked Business; summary only',
    };
  }
  const settlement = await createSettlementWithUniqueNumber(Settlement, {
    vertical: 'local_services',
    counterpartyType: 'commission_partner',
    counterparty: provider.business,
    settlementType: 'order_revenue',
    period: 'custom',
    from: new Date(from),
    to: new Date(to),
    totals: {
      orderCount: summary.count,
      grossOrderValue: Math.round(summary.payable + summary.platform),
      refunds: Math.round(summary.reversalPayable + summary.reversals),
      platformFees: Math.round(summary.netPlatform),
      netAmount: Math.round(summary.netPayable),
    },
    status: 'pending',
  });
  // Consume the included entries so a repeated generate cannot pay twice. The
  // update is skipped for pure stubs (unit tests) that do not implement it.
  if (entries.length && typeof Entry.updateMany === 'function') {
    await Entry.updateMany(
      { _id: { $in: entries.map((e) => e._id) } },
      { $set: { settlement: settlement._id } }
    );
  }
  return { settlement, summary, held: heldSummary };
}

/**
 * Pay a settlement out.
 *
 * The platform's money leaves the platform here. Today the payout target is
 * the shared wallet of the provider's owner: the balance is credited and a
 * transaction row records it, exactly like the wallet refund path. A bank
 * transfer is recorded as a reference for the finance team to execute (the
 * platform does not run a bank rail).
 */
async function paySettlement(
  settlementId,
  { method = 'wallet', note, reference, account } = {},
  { SettlementModel, ProviderModel, creditWallet } = {}
) {
  const Settlement = SettlementModel || require('../../../kernel/settlement/models/settlement.model');
  const Provider = ProviderModel || require('../models/localservice.provider.model');
  const doc = await Settlement.findById(settlementId);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Settlement not found');
  if (doc.status !== 'processing' && doc.status !== 'pending') {
    throw new ApiError(httpStatus.CONFLICT, `Settlement is ${doc.status}, not payable`);
  }
  const amount = Number((doc.totals && doc.totals.netAmount) || 0);
  if (!(amount > 0)) {
    throw new ApiError(httpStatus.CONFLICT, 'Settlement has no payable amount');
  }

  if (doc.status === 'pending') {
    doc.status = 'processing';
    await doc.save();
  }

  if (method === 'wallet') {
    // The settlement's counterparty is the provider's linked Business; the
    // payout goes to the wallet of the Local Services provider behind it.
    const provider = await Provider.findOne({ business: doc.counterparty }).catch(() => null);
    const owner = provider && provider.owner;
    if (!owner) {
      throw new ApiError(httpStatus.CONFLICT, 'Settlement counterparty has no provider owner to pay');
    }
    const credit = creditWallet || require('./localservice.wallet.refund').creditWallet;
    const result = await credit({
      userId: owner,
      amountRupees: amount,
      bookingCode: `SETTLEMENT-${doc.settlementNo}`,
      reason: note || `Local Services settlement ${doc.settlementNo}`,
    });
    doc.payoutMethod = 'wallet';
    doc.gatewayReference = result.transactionId || '';
    doc.status = 'settled';
    doc.settlementDate = new Date();
    if (note) doc.notes = note;
    await doc.save();
    return { settlement: doc, payout: { method: 'wallet', amount, reference: result.transactionId } };
  }

  // Bank payout: the platform records the instruction and the reference. The
  // finance team executes the transfer; the settlement is only "settled"
  // once the reference is supplied, because an unpaid settlement marked
  // settled is a lie in the ledger.
  if (!reference) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A payout reference is required for a bank payout');
  }
  doc.payoutMethod = 'bank';
  doc.payoutDetails = { ...(doc.payoutDetails || {}), ...(account || {}) };
  doc.gatewayReference = reference;
  doc.status = 'settled';
  doc.settlementDate = new Date();
  if (note) doc.notes = note;
  await doc.save();
  return { settlement: doc, payout: { method: 'bank', amount, reference } };
}

module.exports = {
  summarizeEntries,
  generateSettlement,
  markSettlement,
  paySettlement,
  createSettlementWithUniqueNumber,
  loadHeldBookingIds,
  HELD_BOOKING_STATUSES,
};

const SETTLEMENT_TRANSITIONS = {
  pending: ['processing', 'settled', 'failed'],
  processing: ['settled', 'failed', 'disputed'],
  settled: ['reversed'],
  failed: ['processing'],
  disputed: ['settled', 'reversed'],
  reversed: [],
};

async function markSettlement(settlementId, to, { note } = {}, { SettlementModel, EntryModel } = {}) {
  const Settlement = SettlementModel || require('../../../kernel/settlement/models/settlement.model');
  const Entry = EntryModel || require('../models/localservice.revenue.entry.model');
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
  // A failed/reversed batch releases its entries back to the unsettled pool.
  if ((to === 'failed' || to === 'reversed') && typeof Entry.updateMany === 'function') {
    await Entry.updateMany({ settlement: doc._id }, { $unset: { settlement: 1 } });
  }
  return doc;
}
