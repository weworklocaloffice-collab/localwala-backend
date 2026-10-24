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

// 4. Full-window staff availability, including leave overlap and overnight shifts.
const mondayWindow = [new Date('2026-11-02T10:30:00'), new Date('2026-11-02T11:30:00')];
ok('window inside shift', staff.isStaffAvailableForRange(member, ...mondayWindow) === true);
ok('window crossing shift end blocked', staff.isStaffAvailableForRange(member, new Date('2026-11-02T17:30:00'), new Date('2026-11-02T18:30:00')) === false);
ok(
  'leave overlapping window blocked',
  staff.isStaffAvailableForRange(
    { ...member, leave: [{ from: new Date('2026-11-02T11:00:00'), to: new Date('2026-11-02T12:00:00') }] },
    ...mondayWindow
  ) === false
);
const overnight = {
  status: 'active',
  shifts: [{ day: 1, start: '22:00', end: '02:00' }],
  leave: [],
};
ok('overnight shift covers same-day late window', staff.isStaffAvailableForRange(overnight, new Date('2026-11-02T23:00:00'), new Date('2026-11-02T23:30:00')) === true);
ok('overnight shift covers next-day early window', staff.isStaffAvailableForRange(overnight, new Date('2026-11-03T01:00:00'), new Date('2026-11-03T01:30:00')) === true);
ok('overnight shift does not cover after close', staff.isStaffAvailableForRange(overnight, new Date('2026-11-03T02:30:00'), new Date('2026-11-03T03:00:00')) === false);
const twoDay = {
  status: 'active',
  shifts: [
    { day: 1, start: '09:00', end: '18:00' },
    { day: 2, start: '09:00', end: '18:00' },
  ],
  leave: [],
};
ok('multi-day gap between shifts blocked', staff.isStaffAvailableForRange(twoDay, new Date('2026-11-02T10:00:00'), new Date('2026-11-03T12:00:00')) === false);
const overnight24 = {
  status: 'active',
  shifts: [{ day: 1, start: '09:00', end: '09:00' }],
  leave: [],
};
ok('overnight shift covers a multi-day window', staff.isStaffAvailableForRange(overnight24, new Date('2026-11-02T10:00:00'), new Date('2026-11-03T08:00:00')) === true);
ok('multi-day window blocked when next day missing', staff.isStaffAvailableForRange(member, new Date('2026-11-02T10:00:00'), new Date('2026-11-03T12:00:00')) === false);

// 5. Qualification is explicit: service id or matching skill key.
const qualified = { services: ['svc1'], skills: ['plumbing'] };
ok('service id qualifies', staff.isQualified(qualified, { serviceId: 'svc1' }) === true);
ok('skill key qualifies', staff.isQualified(qualified, { serviceKey: 'PLUMBING' }) === true);
ok('unrelated service blocked', staff.isQualified(qualified, { serviceId: 'svc2', serviceKey: 'electrical' }) === false);

console.log(failures === 0 ? '\nAll local-services staff units passed.' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
