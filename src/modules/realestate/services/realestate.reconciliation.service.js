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

const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
const RealEstateHoldRefund = require('../models/realestate.hold.refund.model');
const RealEstateLedgerEntry = require('../models/realestate.ledger.entry.model');
const RealEstateReconciliation = require('../models/realestate.reconciliation.model');
const auditService = require('./realestate.audit.service');

/**
 * Reconciliation service (Phase B) — the internal three-way money match.
 *
 * Compares, in paise integers:
 *  1. Outstanding principal liability (PROPERTY_HOLD debits minus
 *     principal REFUND credits) vs principal on live holds
 *     (ACTIVE + REFUND_PENDING).
 *  2. Every ACTIVE hold carries its ledgerPrincipal pointer.
 *  3. Every COMPLETED refund has ≥1 ledger REFUND row for it.
 *  4. No PROPERTY_HOLD ledger row points at a missing hold.
 *
 * External bank-statement matching mounts here later (statement lines
 * vs these same ledger rows) without changing the checks above.
 */

const toPaise = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'object' && typeof v.toString === 'function') {
    const n = Number(v.toString());
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

async function runReconciliation(triggeredBy = 'cron') {
  const [holds, refunds, holdDebits, refundCredits] = await Promise.all([
    RealEstatePropertyHold.find({}).select('status principal ledgerPrincipal').lean(),
    RealEstateHoldRefund.find({}).select('status principalAmount').lean(),
    RealEstateLedgerEntry.find({ eventType: 'PROPERTY_HOLD' })
      .select('direction amount sourceId')
      .lean(),
    RealEstateLedgerEntry.find({ eventType: 'REFUND', accountType: 'LIABILITY' })
      .select('direction amount sourceId sourceModel')
      .lean(),
  ]);

  const checks = [];
  const check = (name, expectedPaise, actualPaise, detail = '') => {
    checks.push({
      name,
      expectedPaise,
      actualPaise,
      pass: expectedPaise === actualPaise,
      detail,
    });
  };

  // Check 1 — liability outstanding vs live-hold principal.
  const LIVE = ['ACTIVE', 'REFUND_PENDING'];
  const livePrincipalPaise = holds
    .filter((h) => LIVE.includes(h.status))
    .reduce((s, h) => s + Math.round(Number(h.principal) || 0), 0);
  const debitPaise = holdDebits.reduce(
    (s, e) => s + (e.direction === 'DEBIT' ? toPaise(e.amount) : -toPaise(e.amount)),
    0
  );
  const creditPaise = refundCredits.reduce(
    (s, e) => s + (e.direction === 'CREDIT' ? toPaise(e.amount) : -toPaise(e.amount)),
    0
  );
  check(
    'outstanding_principal_liability',
    livePrincipalPaise,
    debitPaise - creditPaise,
    `${holds.filter((h) => LIVE.includes(h.status)).length} live holds, ${holdDebits.length} hold rows, ${refundCredits.length} refund rows`
  );

  // Check 2 — every ACTIVE hold points at its principal ledger row.
  const activeMissing = holds.filter((h) => h.status === 'ACTIVE' && !h.ledgerPrincipal);
  check(
    'active_holds_have_ledger_pointer',
    holds.filter((h) => h.status === 'ACTIVE').length,
    holds.filter((h) => h.status === 'ACTIVE').length - activeMissing.length,
    activeMissing.length ? `${activeMissing.length} ACTIVE hold(s) without ledgerPrincipal` : 'all linked'
  );

  // Check 3 — every COMPLETED refund has ≥1 ledger REFUND row.
  const refundedIds = new Set(
    refundCredits.map((e) => String(e.sourceId)).filter(Boolean)
  );
  const completed = refunds.filter((r) => r.status === 'COMPLETED');
  const completedCovered = completed.filter((r) => refundedIds.has(String(r._id)));
  check(
    'completed_refunds_have_ledger_rows',
    completed.length,
    completedCovered.length,
    completed.length - completedCovered.length
      ? `${completed.length - completedCovered.length} COMPLETED refund(s) without ledger rows`
      : 'all covered'
  );

  // Check 4 — no orphan hold ledger rows.
  const holdIds = new Set(holds.map((h) => String(h._id)));
  const orphans = holdDebits.filter((e) => e.sourceId && !holdIds.has(String(e.sourceId)));
  check('hold_ledger_rows_have_holds', holdDebits.length, holdDebits.length - orphans.length,
    orphans.length ? `${orphans.length} orphan row(s)` : 'none');

  const mismatchCount = checks.filter((c) => !c.pass).length;
  const report = await RealEstateReconciliation.create({
    checkedAt: new Date(),
    healthy: mismatchCount === 0,
    mismatchCount,
    checks,
    triggeredBy,
  });

  await auditService.record({
    eventType: 'REALESTATE_RECONCILIATION',
    targetType: 'RealEstateReconciliation',
    targetId: report._id,
    actorType: 'system',
    reason: '',
    metadata: {
      healthy: report.healthy,
      mismatchCount,
      failedChecks: checks.filter((c) => !c.pass).map((c) => c.name),
    },
  });
  if (!report.healthy) {
    console.error(
      `realestate reconciliation UNHEALTHY: ${checks
        .filter((c) => !c.pass)
        .map((c) => `${c.name} expected=${c.expectedPaise} actual=${c.actualPaise}`)
        .join('; ')}`
    );
  }
  return report.toObject({ getters: true });
}

async function latestReport() {
  return RealEstateReconciliation.findOne({}).sort({ checkedAt: -1 }).lean();
}

async function listReports({ page = 1, limit = 20 } = {}) {
  const [docs, total] = await Promise.all([
    RealEstateReconciliation.find({})
      .sort({ checkedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    RealEstateReconciliation.countDocuments({}),
  ]);
  return { results: docs, total, page, limit };
}

const realEstateReconciliationService = {
  runReconciliation,
  latestReport,
  listReports,
};

module.exports = realEstateReconciliationService;
