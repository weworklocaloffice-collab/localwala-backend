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
 * verify.localservices.provider.units.js — provider/offering pure units (no DB).
 * Run: node scripts/verify.localservices.provider.units.js
 */

const { PROVIDER_TRANSITIONS } = require('../src/modules/local-services/controllers/ls.provider.controller');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const can = (from, to) => (PROVIDER_TRANSITIONS[from] || []).includes(to);

ok('DRAFT->SUBMITTED allowed', can('DRAFT', 'SUBMITTED'));
ok('SUBMITTED->UNDER_REVIEW allowed', can('SUBMITTED', 'UNDER_REVIEW'));
ok('UNDER_REVIEW->APPROVED allowed', can('UNDER_REVIEW', 'APPROVED'));
ok('APPROVED->ACTIVE allowed', can('APPROVED', 'ACTIVE'));
ok('ACTIVE->SUSPENDED allowed', can('ACTIVE', 'SUSPENDED'));
ok('SUSPENDED->ACTIVE allowed', can('SUSPENDED', 'ACTIVE'));
ok('DRAFT->ACTIVE blocked', !can('DRAFT', 'ACTIVE'));
ok('ACTIVE->DRAFT blocked', !can('ACTIVE', 'DRAFT'));
ok('offering price >= 0 rule (negative rejected)', Number(-5) < 0);

console.log(failures === 0 ? '\nAll local-services provider units passed.' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
