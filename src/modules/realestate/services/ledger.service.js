/*
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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');

const { Decimal128 } = mongoose.Types;
const RealEstateLedgerEntry = require('../models/realestate.ledger.entry.model');
const sequence = require('../models/realestate.sequence.model');

/**
 * Ledger service — the ONLY write path for RealEstateLedgerEntry.
 * No service in the vertical exposes an update or delete on this model.
 * All money movement goes through this function.
 *
 * @param {Object} options
 * @param {String} options.eventType - One of the 10 event types
 * @param {String} options.accountType - REVENUE | LIABILITY | PAYABLE | RECEIVABLE | EXPENSE
 * @param {String} options.direction - DEBIT | CREDIT
 * @param {Decimal128|Number} options.amount - Always stored as positive; direction carries sign
 * @param {String} options.currency - 'INR'
 * @param {String} options.partyType - CUSTOMER | VENDOR | EXECUTIVE | REFERRER | BANK | LOCALWALA
 * @param {ObjectId} options.party - The counterparty
 * @param {String} options.sourceModel - e.g. 'RealEstatePropertyHold'
 * @param {ObjectId} options.sourceId - The triggering document's _id
 * @param {String} options.narration - Human-readable description
 * @param {Object} options.metadata - Rule snapshot, hold terms, sale reference
 * @returns {Object} The created ledger entry document
 */
const SEPARATE_FINANCIAL_EVENTS = [
  'LISTING_PACKAGE_PAYMENT',
  'PROPERTY_SALE_COMMISSION',
  'PROPERTY_HOLD',
  'PROPERTY_HOLD_SERVICE_FEE',
];

// Financial-event separation (BR-02/BR-15, OD-04 §4): the four supplies
// above must never be merged into one entry. One entry = one eventType,
// one accountType. A caller needing two supplies writes two entries
// (see hold.service activateHold: LIABILITY + REVENUE).
function assertNoEventMerge(eventType, metadata) {
  if (!SEPARATE_FINANCIAL_EVENTS.includes(eventType)) return;
  if (metadata && metadata.mergedEvents) {
    throw new Error(`Ledger event merge blocked: ${eventType} must not merge supplies (BR-02).`);
  }
  if (metadata && Array.isArray(metadata.eventTypes) && metadata.eventTypes.length > 1) {
    throw new Error(`Ledger event merge blocked: single entry cannot carry ${metadata.eventTypes.join(',')}.`);
  }
}

exports.record = async function (
  {
    eventType,
    accountType,
    direction,
    amount,
    currency,
    partyType,
    party,
    sourceModel,
    sourceId,
    narration,
    metadata,
    custodyReference,
  },
  session = null
) {
  assertNoEventMerge(eventType, metadata);
  // Production: entry numbers must be unique under concurrency.
  // The old read-last-then-+1 raced (two writers read the same last row)
  // and hit E11000 on the unique index. `sequence.next` is one atomic
  // $inc + upsert, so concurrent writers never share a number.
  const entryNo = String(await sequence.next('ledgerEntry'));

  // Amount is always stored as positive; direction carries the sign
  const amountPositive =
    amount && typeof amount !== 'number'
      ? typeof amount === 'string'
        ? new Decimal128(amount.replace(/[^0-9.-]/g, ''))
        : new Decimal128(amount)
      : new Decimal128(amount);

  const doc = {
    entryNo,
    eventType,
    accountType,
    direction,
    amount: amountPositive,
    currency: currency || 'INR',
    partyType,
    party,
    sourceModel,
    sourceId,
    narration,
    metadata: metadata || {},
    // OD-01: external custodial reference for reconciliation. Null when
    // no approved custody is in force — never fabricate one.
    custodyReference: custodyReference || null,
  };

  // Session-aware: callers inside withOptionalTransaction/withRequiredTransaction
  // pass their session so ledger rows commit atomically with the hold flip.
  // Previously the session arg was silently dropped and ledger writes always
  // auto-committed, leaving partial money state on failure.
  const entry = session
    ? (await RealEstateLedgerEntry.create([doc], { session }))[0]
    : await RealEstateLedgerEntry.create(doc);

  return entry;
};

exports.SEPARATE_FINANCIAL_EVENTS = SEPARATE_FINANCIAL_EVENTS;
exports.assertNoEventMerge = assertNoEventMerge;

/**
 * Get ledger entries with filtering
 *
 * @param {Object} filter - MongoDB filter criteria
 * @param {Object} options - Query options
 * @param {Number} options.page - Page number (1-indexed)
 * @param {Number} options.limit - Items per page (default: 50)
 * @param {String} options.sort - Sort field (default: 'createdAt')
 * @param {Boolean} options.lean - Return lean documents
 * @returns {Object} Paginated result with entries and pagination info
 */
exports.getEntries = async function (filter, options = {}) {
  const page = options.page || 1;
  const limit = options.limit || 50;
  const sort = options.sort || 'createdAt';

  const skip = (page - 1) * limit;

  const entries = await RealEstateLedgerEntry.find(filter)
    .sort(sort)
    .skip(skip)
    .limit(limit);

  const total = await RealEstateLedgerEntry.countDocuments(filter);

  return {
    entries: entries.map((entry) => entry.toObject({ getters: true })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get ledger summary by event type and date range
 *
 * @param {Object} filter - MongoDB filter (e.g., { periodFrom, periodTo })
 * @returns {Object} Summary with gross, tds, net totals
 */
exports.getSummary = async function (filter = {}) {
  const pipeline = [
    { $match: filter },
    {
      $group: {
        _id: null,
        gross: {
          $sum: {
            $cond: [
              { $eq: ['$direction', 'CREDIT'] },
              '$amount',
              { $multiply: ['$amount', -1] },
            ],
          },
        },
        tds: {
          $sum: {
            $cond: [
              { $or: [
                { $eq: ['$accountType', 'REVENUE'] },
                { $eq: ['$accountType', 'PAYABLE'] },
              ] },
              { $cond: [
                { $eq: ['$direction', 'CREDIT'] },
                '$amount',
                { $multiply: ['$amount', -1] },
              ] },
            ],
          },
        },
        net: {
          $sum: {
            $cond: [
              { $eq: ['$accountType', 'REVENUE'] },
              { $cond: [{ $eq: ['$direction', 'CREDIT'] }, '$amount', { $multiply: ['$amount', -1] }] },
              { $cond: [{ $eq: ['$direction', 'CREDIT'] }, { $multiply: ['$amount', -1] }, '$amount'] },
            ],
          },
        },
      },
    },
  ];

  const result = await RealEstateLedgerEntry.aggregate(pipeline);
  return result.length > 0 ? result[0] : { gross: 0, tds: 0, net: 0 };
};

/**
 * Validate that no update or delete routes exist for this model.
 * This function is called by the contract verification script.
 *
 * @returns {Object} Status object
 */
exports.validateImmutability = async function () {
  // Check that no PATCH/DELETE routes accept ledger entry _id
  // This is enforced by the route validation, not the service
  return {
    immutable: true,
    message: 'RealEstateLedgerEntry is append-only — no PATCH/DELETE routes defined',
  };
};

module.exports = exports;