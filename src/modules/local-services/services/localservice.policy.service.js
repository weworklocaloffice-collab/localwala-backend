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

const { toPaise, fromPaise } = require('../../../utils/money');

/**
 * localservice.policy.service — cancellation/reschedule/dispute rules (pure).
 *
 * - Cancel within cutoff (hours before start) => full refund of collected;
 *   after cutoff => fee retained, labour refunded per policy.
 * - Reschedule allowed only before cutoff and only to a free slot (checked by caller).
 * - Dispute freezes settlement (caller holds payout while DISPUTED).
 */
function hoursBefore(startAt, now = new Date()) {
  return (new Date(startAt).getTime() - new Date(now).getTime()) / 3600000;
}

function cancelQuote({ paidPaise, feePaise, cutoffHours = 24, startAt, now = new Date(), cancelledBy = 'customer' }) {
  const hb = hoursBefore(startAt, now);
  if (cancelledBy === 'provider') {
    // Provider cancels => full refund always (platform absorbs policy cost).
    return { refundPaise: paidPaise, feeRetainedPaise: 0, withinCutoff: true };
  }
  if (hb >= cutoffHours) return { refundPaise: paidPaise, feeRetainedPaise: 0, withinCutoff: true };
  return { refundPaise: Math.max(0, paidPaise - feePaise), feeRetainedPaise: Math.min(feePaise, paidPaise), withinCutoff: false };
}

function cancelCalc({ totalRupees, paidRupees, feeRupees, cutoffHours, startAt, now, cancelledBy }) {
  const r = cancelQuote({
    paidPaise: toPaise(paidRupees),
    feePaise: toPaise(feeRupees),
    cutoffHours,
    startAt,
    now,
    cancelledBy,
  });
  return { refund: fromPaise(r.refundPaise), feeRetained: fromPaise(r.feeRetainedPaise), withinCutoff: r.withinCutoff };
}

function canReschedule({ startAt, now = new Date(), cutoffHours = 24 }) {
  return hoursBefore(startAt, now) >= cutoffHours;
}

/**
 * Home Services exception matrix (§14-D, frozen commercial defaults).
 * Maps each scenario to fee/commission/parts treatment + the mechanics row
 * that already enforces it. Warranty-linked second visits are doc-only:
 * linkage model is Phase 2, so warranty callbacks book as new bookings today.
 */
const EXCEPTION_OUTCOMES = Object.freeze({
  declined_quote: { fee: 'retain', commission: 'none', parts: 'n/a', via: 'customer late-cancel (fee retained)', evidence: ['diagnosis', 'itemised-quote'] },
  tech_no_show: { fee: 'refund', commission: 'none', parts: 'n/a', via: 'provider cancel (full refund)', evidence: ['no-show flag'] },
  cannot_repair: { fee: 'refund', commission: 'none', parts: 'n/a', via: 'provider cancel (full refund)', evidence: ['diagnosis'] },
  cancel_after_inspection: { fee: 'retain', commission: 'none', parts: 'n/a', via: 'customer late-cancel (fee retained)', evidence: [] },
  second_visit_chargeable: { fee: 'new-rule', commission: 'due-on-new-labour', parts: 'quote+approval', via: 'new booking', evidence: ['completion evidence'] },
  warranty_callback: { fee: 'waived-manual', commission: 'none', parts: 'n/a', via: 'new booking (linkage Phase 2 — waive manually today)', evidence: ['original completion'] },
  parts_by_technician: { fee: 'per-rule', commission: 'excluded-default', parts: 'pass-through+approval', via: 'quote acceptance', evidence: ['itemised quote', 'approval'] },
  parts_by_customer: { fee: 'per-rule', commission: 'labour-only', parts: 'zero-bill', via: 'quote acceptance', evidence: ['itemised quote'] },
});

function exceptionOutcome(scenario) {
  const row = EXCEPTION_OUTCOMES[scenario];
  if (!row) {
    const e = new Error(`Unknown exception scenario ${scenario}`);
    e.statusCode = 400;
    throw e;
  }
  return { scenario, ...row };
}

module.exports = { hoursBefore, cancelQuote, cancelCalc, canReschedule, exceptionOutcome, EXCEPTION_OUTCOMES };
