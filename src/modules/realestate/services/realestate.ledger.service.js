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

const RealEstateLedgerEntry = require('../models/realestate.ledger.entry.model');
const sequence = require('../models/realestate.sequence.model');

/**
 * Real Estate ledger service — the ONLY write path to the ledger.
 *
 * Every hold, sale, commission, refund and settlement writes through
 * `record()`. There is deliberately no `update` or `remove` export:
 * corrections are compensating REVERSAL entries (BR-17).
 *
 * ## Amount convention (plan §4.3.4)
 *
 * `amount` is always positive (rupees at the edge, paise inside via
 * `moneyField`). `direction` carries the sign. Reports compute
 * `signedAmount = direction === 'CREDIT' ? amount : -amount`.
 */

// Production: entry numbers must be unique across restarts and processes.
// The old in-memory counter + timestamp slice collided after a restart
// (counter reset) and under concurrent writes (same ms slice), failing
// loudly on the unique index in the middle of money activation.
// `sequence.next` is one atomic $inc + upsert — concurrent writers never
// share a number.
async function nextEntryNo() {
  const seq = await sequence.next('ledgerEntry');
  const now = new Date();
  const period = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `RE-LED-${period}-${String(seq).padStart(6, '0')}`;
}

function signedAmount(entry) {
  return entry.direction === 'CREDIT' ? entry.amount : -entry.amount;
}

/**
 * Record one immutable ledger entry.
 */
const SEPARATE_FINANCIAL_EVENTS = [
  'LISTING_PACKAGE_PAYMENT',
  'PROPERTY_SALE_COMMISSION',
  'PROPERTY_HOLD',
  'PROPERTY_HOLD_SERVICE_FEE',
];

// Financial-event separation (BR-02/BR-15, OD-04 §4): the four supplies
// above must never be merged into one entry. One entry = one eventType.
// A caller needing two supplies writes two entries (see hold.service
// activateHold: LIABILITY principal + REVENUE fee).
function assertNoEventMerge(eventType, metadata) {
  if (!SEPARATE_FINANCIAL_EVENTS.includes(eventType)) return;
  if (metadata && metadata.mergedEvents) {
    throw new Error(`Ledger event merge blocked: ${eventType} must not merge supplies (BR-02).`);
  }
  if (metadata && Array.isArray(metadata.eventTypes) && metadata.eventTypes.length > 1) {
    throw new Error(`Ledger event merge blocked: single entry cannot carry ${metadata.eventTypes.join(',')}.`);
  }
}

async function record(
  {
    eventType,
    accountType,
    direction,
    amount,
    partyType,
    party = null,
    sourceModel,
    sourceId,
    narration = '',
    metadata = undefined,
    settlement = null,
    reversesEntry = null,
    custodyReference = null,
  },
  session = null
) {
  assertNoEventMerge(eventType, metadata);
  if (typeof amount !== 'number' || !(amount > 0)) {
    throw new Error('Ledger amount must be a positive number (rupees); direction carries the sign.');
  }
  const doc = { entryNo: await nextEntryNo(), eventType, accountType, direction, amount, partyType, sourceModel, sourceId, narration };
  if (party) doc.party = party;
  if (metadata !== undefined) doc.metadata = metadata;
  if (settlement) doc.settlement = settlement;
  if (reversesEntry) doc.reversesEntry = reversesEntry;
  // OD-01: external custodial reference for reconciliation. Null when no
  // approved custody is in force — never fabricate one.
  if (custodyReference) doc.custodyReference = custodyReference;
  if (session) {
    const [created] = await RealEstateLedgerEntry.create([doc], { session });
    return created;
  }
  return RealEstateLedgerEntry.create(doc);
}

/**
 * Record a compensating REVERSAL of an existing entry. The original
 * row is never touched; the reversal nets to zero in reports.
 */
async function reverse(originalEntryId, narration = '', session = null) {
  const original = await RealEstateLedgerEntry.findById(originalEntryId);
  if (!original) throw new Error('Original ledger entry not found');
  return record(
    {
      eventType: 'REVERSAL',
      accountType: original.accountType,
      direction: original.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
      amount: original.amount,
      partyType: original.partyType,
      party: original.party || null,
      sourceModel: 'RealEstateLedgerEntry',
      sourceId: original._id,
      narration: narration || `Reversal of ${original.entryNo}`,
      reversesEntry: original._id,
    },
    session
  );
}

async function listBySource(sourceModel, sourceId) {
  return RealEstateLedgerEntry.find({ sourceModel, sourceId }).sort({ createdAt: 1 });
}

async function netBySource(sourceModel, sourceId) {
  const entries = await listBySource(sourceModel, sourceId);
  return entries.reduce((sum, e) => sum + signedAmount(e), 0);
}

const realEstateLedgerService = {
  record,
  reverse,
  listBySource,
  netBySource,
  signedAmount,
  SEPARATE_FINANCIAL_EVENTS,
  assertNoEventMerge,
};

module.exports = realEstateLedgerService;
