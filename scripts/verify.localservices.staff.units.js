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
 * verify.localservices.staff.units.js — staff/coverage pure units (no DB).
 * Run: node scripts/verify.localservices.staff.units.js
 */

const staff = require('../src/modules/local-services/services/localservice.staff.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// Monday 2026-11-02 10:30 (day 1)
const monday1030 = new Date('2026-11-02T10:30:00');
const member = { status: 'active', shifts: [{ day: 1, start: '09:00', end: '18:00' }], leave: [] };
ok('in-shift available', staff.isStaffAvailable(member, monday1030) === true);
ok('off-shift blocked', staff.isStaffAvailable({ ...member, shifts: [{ day: 2, start: '09:00', end: '18:00' }] }, monday1030) === false);
ok('leave blocks', staff.isStaffAvailable({ ...member, leave: [{ from: new Date('2026-11-01'), to: new Date('2026-11-05') }] }, monday1030) === false);
ok('inactive blocked', staff.isStaffAvailable({ ...member, status: 'inactive' }, monday1030) === false);
ok('locality covered', staff.isCovered({ localities: ['Whitefield'], pincodes: ['560066'] }, { locality: 'whitefield' }) === true);
ok('pincode covered', staff.isCovered({ localities: [], pincodes: ['560066'] }, { pincode: '560066' }) === true);
ok('uncovered false', staff.isCovered({ localities: ['Whitefield'], pincodes: [] }, { locality: 'Indiranagar' }) === false);

console.log(failures === 0 ? '\nAll local-services staff units passed.' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
