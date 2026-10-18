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

const RealEstateCustodyStatement = require('../models/realestate.custody.statement.model');
const RealEstateLedgerEntry = require('../models/realestate.ledger.entry.model');
const auditService = require('./realestate.audit.service');

/**
 * Custody service (Phase B external leg) — provider abstraction +
 * statement matching.
 *
 * Providers (ingestion varies, matching identical):
 *  - ManualCustody (this file): bank statement CSV upload, maker-checked
 *    by the uploader's finance role. Works day one, no bank API needed.
 *  - ApiCustody (later): RazorpayX/Cashfree virtual-account webhooks
 *    writing rows in the same shape; `matchStatement` is reused as-is.
 *
 * Matching rule (deliberately strict): a statement row twins a ledger
 * row on EXACT paise equality within a ±7-day window, credits against
 * PROPERTY_HOLD debits and debits against REFUND/LIABILITY credits.
 * Near-misses surface as unmatched on both sides for a human to clear —
 * fuzzy matching would reconcile away real discrepancies.
 */

const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;
const MAX_CSV_CHARS = 2 * 1024 * 1024;

const toPaise = (rupees) => {
  const n = Number(rupees);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
};

function parseStatementCsv(csvText) {
  if (typeof csvText !== 'string' || !csvText.trim()) {
    throw new Error('Statement file is empty.');
  }
  if (csvText.length > MAX_CSV_CHARS) throw new Error('Statement file exceeds 2 MB.');
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) throw new Error('Statement has no data rows.');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = {
    date: header.indexOf('date'),
    reference: header.indexOf('reference'),
    amount: header.indexOf('amount'),
    direction: header.indexOf('direction'),
    balance: header.indexOf('balance'),
  };
  if (idx.date < 0 || idx.reference < 0 || idx.amount < 0 || idx.direction < 0) {
    throw new Error('Statement header must be: date,reference,amount,direction[,balance].');
  }
  const rows = [];
  const errors = [];
  for (let i = 1; i < lines.length; i++) {
    if (rows.length >= MAX_ROWS) {
      errors.push(`row ${i + 1}: capped at ${MAX_ROWS} rows`);
      break;
    }
    const cols = lines[i].split(',').map((c) => c.trim());
    const date = new Date(cols[idx.date]);
    const direction = (cols[idx.direction] || '').toUpperCase();
    const amountPaise = toPaise(cols[idx.amount]);
    if (Number.isNaN(date.getTime())) {
      errors.push(`row ${i + 1}: bad date "${cols[idx.date]}"`);
      continue;
    }
    if (!cols[idx.reference]) {
      errors.push(`row ${i + 1}: empty reference`);
      continue;
    }
    if (amountPaise === null) {
      errors.push(`row ${i + 1}: bad amount "${cols[idx.amount]}"`);
      continue;
    }
    if (direction !== 'CREDIT' && direction !== 'DEBIT') {
      errors.push(`row ${i + 1}: direction must be CREDIT or DEBIT`);
      continue;
    }
    const row = { date, reference: cols[idx.reference], amountPaise, direction };
    if (idx.balance >= 0 && cols[idx.balance] !== undefined && cols[idx.balance] !== '') {
      const b = toPaise(cols[idx.balance]);
      if (b !== null) row.balancePaise = b;
    }
    rows.push(row);
  }
  if (!rows.length) throw new Error('Statement has no valid rows: ' + errors.slice(0, 3).join('; '));
  return { rows, skipped: errors.length, errors: errors.slice(0, 10) };
}

async function uploadStatement({ filename, csvText }, actor = {}) {
  if (!actor._id) throw new Error('uploadStatement requires an actor.');
  const { rows, skipped, errors } = parseStatementCsv(csvText);
  const doc = await RealEstateCustodyStatement.create({
    filename: String(filename || 'statement.csv').slice(0, 200),
    uploadedBy: actor._id,
    rowCount: rows.length,
    rows,
    status: 'PENDING',
  });
  await auditService.record({
    eventType: 'REALESTATE_CUSTODY_STATEMENT_UPLOADED',
    targetType: 'RealEstateCustodyStatement',
    targetId: doc._id,
    actor: actor._id,
    actorType: 'admin',
    metadata: { filename: doc.filename, rowCount: rows.length, skippedRows: skipped },
  });
  return { statement: doc.toObject({ getters: true }), skipped, errors };
}

const ledgerPaise = (entry) => {
  const n = Number(entry.amount && entry.amount.toString ? entry.amount.toString() : entry.amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

async function matchStatement(statementId, actor = {}) {
  const doc = await RealEstateCustodyStatement.findById(statementId);
  if (!doc) throw new Error('Custody statement not found.');
  const dates = doc.rows.map((r) => new Date(r.date).getTime());
  const from = new Date(Math.min(...dates) - MATCH_WINDOW_MS);
  const to = new Date(Math.max(...dates) + MATCH_WINDOW_MS);
  const [holdDebits, refundCredits] = await Promise.all([
    RealEstateLedgerEntry.find({
      eventType: 'PROPERTY_HOLD',
      direction: 'DEBIT',
      createdAt: { $gte: from, $lte: to },
    })
      .select('amount createdAt narration')
      .lean(),
    RealEstateLedgerEntry.find({
      eventType: 'REFUND',
      accountType: 'LIABILITY',
      direction: 'CREDIT',
      createdAt: { $gte: from, $lte: to },
    })
      .select('amount createdAt narration')
      .lean(),
  ]);
  const pool = [...holdDebits, ...refundCredits].map((e) => ({
    id: String(e._id),
    paise: ledgerPaise(e),
    at: new Date(e.createdAt).getTime(),
    // Credits twin hold debits, debits twin refund credits.
    side: e.eventType === 'PROPERTY_HOLD' ? 'CREDIT' : 'DEBIT',
    used: false,
  }));
  const unmatchedStatementRows = [];
  let matchedCount = 0;
  doc.rows.forEach((row, i) => {
    const at = new Date(row.date).getTime();
    const twin = pool.find(
      (p) =>
        !p.used &&
        p.side === row.direction &&
        p.paise === row.amountPaise &&
        Math.abs(p.at - at) <= MATCH_WINDOW_MS
    );
    if (twin) {
      twin.used = true;
      matchedCount += 1;
    } else {
      unmatchedStatementRows.push(i);
    }
  });
  const unmatchedLedgerEntries = pool.filter((p) => !p.used).map((p) => p.id);
  doc.status = 'MATCHED';
  doc.match = { unmatchedStatementRows, unmatchedLedgerEntries, matchedCount, matchedAt: new Date() };
  await doc.save();
  await auditService.record({
    eventType: 'REALESTATE_CUSTODY_STATEMENT_MATCHED',
    targetType: 'RealEstateCustodyStatement',
    targetId: doc._id,
    actor: actor._id || null,
    actorType: 'admin',
    metadata: {
      matchedCount,
      unmatchedStatement: unmatchedStatementRows.length,
      unmatchedLedger: unmatchedLedgerEntries.length,
    },
  });
  return doc.toObject({ getters: true });
}

async function listStatements({ page = 1, limit = 20 } = {}) {
  const [docs, total] = await Promise.all([
    RealEstateCustodyStatement.find({})
      .select('-rows')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    RealEstateCustodyStatement.countDocuments({}),
  ]);
  return { results: docs, total, page, limit };
}

async function getStatement(statementId) {
  return RealEstateCustodyStatement.findById(statementId).lean();
}

const realEstateCustodyService = {
  MATCH_WINDOW_MS,
  parseStatementCsv,
  uploadStatement,
  matchStatement,
  listStatements,
  getStatement,
};

module.exports = realEstateCustodyService;
