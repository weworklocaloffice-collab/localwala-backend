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

const RealEstateSettlement = require('../models/realestate.settlement.model');
const RealEstateLedgerEntry = require('../models/realestate.ledger.entry.model');
const { SETTLEMENT_TRANSITIONS, canTransition } = require('../utils/realestate.state.machine');
const fcmNotificationService = require('../../../services/fcm.notification.service');

let settlementSequence = 0;

function nextSettlementNo() {
  settlementSequence += 1;
  const ts = Date.now().toString().slice(-8);
  return `RE-SET-${ts}-${String(settlementSequence).padStart(4, '0')}`;
}

function signedAmount(entry) {
  const amt = entry.amount || 0;
  return entry.direction === 'CREDIT' ? amt : -amt;
}

/**
 * Generate a settlement FROM ledger entries (plan §5.11).
 *
 * The caller passes unsettled entry ids for one party + period. This
 * service re-reads them, sums signed amounts, freezes `entryIds[]`,
 * and stamps the ledger rows with this settlement. A later
 * correction is a new entry in the next period — this statement never
 * changes.
 */
async function generate({ partyType, party = null, periodFrom, periodTo, entryIds, tdsPercent = 0 }, session = null) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    throw new Error('generate() requires at least one ledger entry id.');
  }
  const entries = await RealEstateLedgerEntry.find({ _id: { $in: entryIds } });
  if (entries.length !== entryIds.length) throw new Error('One or more ledger entries were not found.');
  if (entries.some((e) => e.settlement)) throw new Error('One or more entries are already settled.');

  const gross = Number(entries.reduce((s, e) => s + signedAmount(e), 0).toFixed(2));
  const tds = Number(((gross * tdsPercent) / 100).toFixed(2));
  const net = Number((gross - tds).toFixed(2));

  const doc = {
    settlementNo: nextSettlementNo(),
    partyType,
    periodFrom,
    periodTo,
    entryIds,
    totals: { gross, tds, net },
    status: 'PENDING',
  };
  if (party) doc.party = party;

  const created = session
    ? (await RealEstateSettlement.create([doc], { session }))[0]
    : await RealEstateSettlement.create(doc);

  await RealEstateLedgerEntry.updateMany(
    { _id: { $in: entryIds } },
    { $set: { settlement: created._id } },
    session ? { session } : {}
  );

  // Phase 10: party confirmation. Never throws into generation.
  try {
    if (party) {
      const recipientType = partyType === 'VENDOR' ? 'VENDOR' : partyType === 'EXECUTIVE' ? 'EXECUTIVE' : 'CUSTOMER';
      await fcmNotificationService.realEstateSettlementCreated({
        userId: party,
        recipientType,
        title: 'Settlement created',
        body: `Settlement ${created.settlementNo} created for ₹${created.totals.net.toLocaleString('en-IN')}.`,
        data: { settlementId: String(created._id) },
      });
    }
  } catch (e) {
    /* notify-only */
  }

  return created;
}

function assertSettlementTransition(from, to) {
  if (!canTransition(SETTLEMENT_TRANSITIONS, from, to)) {
    const allowed = SETTLEMENT_TRANSITIONS[from] || [];
    throw new Error(
      allowed.length
        ? `Cannot move settlement from "${from}" to "${to}". Allowed: ${allowed.join(', ')}.`
        : `Settlement is already "${from}" and cannot change.`
    );
  }
}

/**
 * Admin: advance one step along the chain
 * PENDING → VERIFIED → EARNED → SETTLEMENT_CREATED → PAID.
 *
 * The statement itself (entryIds[], totals) never changes — only the
 * workflow state. VERIFIED stamps approvedBy/approvedAt; PAID stamps
 * paidAt plus the payout reference. Skips are rejected by the machine.
 */
async function setStatus(settlementId, to, { actorId = null, payoutReference = '' } = {}) {
  const doc = await RealEstateSettlement.findById(settlementId);
  if (!doc) throw new Error('Settlement not found');
  assertSettlementTransition(doc.status, to);
  doc.status = to;
  if (to === 'VERIFIED') {
    if (actorId) doc.approvedBy = actorId;
    doc.approvedAt = new Date();
  }
  if (to === 'PAID') {
    doc.paidAt = new Date();
    if (payoutReference) doc.payoutReference = String(payoutReference).trim();
  }
  await doc.save();
  return doc.toObject({ getters: true });
}

const realEstateSettlementService = {
  generate,
  assertSettlementTransition,
  setStatus,
};

module.exports = realEstateSettlementService;
