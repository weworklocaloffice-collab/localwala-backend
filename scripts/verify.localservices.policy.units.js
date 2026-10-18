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

/**
 * verify.localservices.policy.units.js — policy engine units (no DB).
 * Run: node scripts/verify.localservices.policy.units.js
 */

const policy = require('../src/modules/local-services/services/localservice.policy.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const start = new Date('2026-11-10T10:00:00Z');
// 48h before, 24h cutoff => full refund
const r1 = policy.cancelCalc({ totalRupees: 523.95, paidRupees: 523.95, feeRupees: 60, cutoffHours: 24, startAt: start, now: new Date('2026-11-08T10:00:00Z'), cancelledBy: 'customer' });
ok('early cancel full refund', r1.refund === 523.95 && r1.feeRetained === 0 && r1.withinCutoff === true, JSON.stringify(r1));
// 2h before => fee retained 60, refund 463.95
const r2 = policy.cancelCalc({ totalRupees: 523.95, paidRupees: 523.95, feeRupees: 60, cutoffHours: 24, startAt: start, now: new Date('2026-11-10T08:00:00Z'), cancelledBy: 'customer' });
ok('late cancel retains fee', r2.refund === 463.95 && r2.feeRetained === 60 && r2.withinCutoff === false, JSON.stringify(r2));
// Provider cancels => always full
const r3 = policy.cancelCalc({ totalRupees: 523.95, paidRupees: 523.95, feeRupees: 60, cutoffHours: 24, startAt: start, now: new Date('2026-11-10T08:00:00Z'), cancelledBy: 'provider' });
ok('provider cancel full refund', r3.refund === 523.95 && r3.feeRetained === 0);
// Reschedule rules
ok('reschedule allowed early', policy.canReschedule({ startAt: start, now: new Date('2026-11-08T10:00:00Z'), cutoffHours: 24 }) === true);
ok('reschedule blocked late', policy.canReschedule({ startAt: start, now: new Date('2026-11-10T08:00:00Z'), cutoffHours: 24 }) === false);
// Exception matrix (§14-D): 8 frozen scenarios + unknown rejected.
ok('declined retains fee', policy.exceptionOutcome('declined_quote').fee === 'retain');
ok('no-show refunds fee', policy.exceptionOutcome('tech_no_show').fee === 'refund');
ok('cannot-repair refunds fee', policy.exceptionOutcome('cannot_repair').fee === 'refund');
ok('cancel-after-inspection retains', policy.exceptionOutcome('cancel_after_inspection').fee === 'retain');
ok('tech parts excluded', policy.exceptionOutcome('parts_by_technician').commission === 'excluded-default');
ok('customer parts labour-only', policy.exceptionOutcome('parts_by_customer').parts === 'zero-bill');
let threw = false;
try {
  policy.exceptionOutcome('alien_abduction');
} catch (e) {
  threw = e.statusCode === 400;
}
ok('unknown scenario rejected', threw);

console.log(failures === 0 ? '\nAll local-services policy units passed.' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
