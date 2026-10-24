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
 * verify.localservices.allocation.units.js – staff/resource allocation units.
 * Run: node scripts/verify.localservices.allocation.units.js
 */

const allocation = require('../src/modules/local-services/services/localservice.assignment.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` – ${detail}` : ''}`);
  }
};

const throwsConflict = (fn) => {
  try {
    fn();
    return false;
  } catch (e) {
    return e.statusCode === 409;
  }
};

// 1. Booking window uses the explicit end, then offering/service duration.
const slot = allocation.bookingWindow(
  { scheduledAt: new Date('2026-11-02T10:00:00Z') },
  { offering: { durationMinutes: 90 } }
);
ok('slot window uses offering duration', slot && slot.endAt.getTime() - slot.startAt.getTime() === 90 * 60000);
const dateRange = allocation.bookingWindow({
  startAt: new Date('2026-11-02T10:00:00Z'),
  endAt: new Date('2026-11-03T10:00:00Z'),
});
ok('date-range window keeps explicit end', dateRange && dateRange.endAt.getTime() - dateRange.startAt.getTime() === 24 * 60 * 60000);
ok('unscheduled booking has no window', allocation.bookingWindow({}) === null);

// 2. Overlap counts ignore released rows and the booking being reassigned.
const windowStart = new Date('2026-11-02T10:00:00Z');
const windowEnd = new Date('2026-11-02T11:00:00Z');
const rows = [
  { booking: 'a', status: 'assigned', startAt: new Date('2026-11-02T10:30:00Z'), endAt: new Date('2026-11-02T11:30:00Z') },
  { booking: 'b', status: 'released', startAt: new Date('2026-11-02T10:30:00Z'), endAt: new Date('2026-11-02T11:30:00Z') },
  { booking: 'c', status: 'assigned', startAt: new Date('2026-11-02T12:00:00Z'), endAt: new Date('2026-11-02T13:00:00Z') },
];
ok('one live overlap counted', allocation.countAssignmentOverlaps(rows, windowStart, windowEnd) === 1);
ok('current booking excluded', allocation.countAssignmentOverlaps(rows, windowStart, windowEnd, { excludeBooking: 'a' }) === 0);
const bufferRows = [{ booking: 'c', status: 'assigned', startAt: new Date('2026-11-02T12:00:00Z'), endAt: new Date('2026-11-02T13:00:00Z') }];
ok(
  'buffer expands the overlap window',
  allocation.countAssignmentOverlaps(bufferRows, windowStart, new Date('2026-11-02T11:30:00Z'), { bufferMinutes: 60 }) === 1
);

// 3. Staff allocation refuses any live overlap.
ok(
  'staff overlap throws 409',
  throwsConflict(() => allocation.assertStaffFree(rows, windowStart, windowEnd))
);
ok(
  'staff free when overlap belongs to same booking',
  !throwsConflict(() => allocation.assertStaffFree(rows, windowStart, windowEnd, { excludeBooking: 'a' }))
);

// 4. Resource capacity allows parallel use only up to its limit.
ok(
  'resource capacity 2 allows one overlap',
  !throwsConflict(() => allocation.assertResourceCapacity(rows, windowStart, windowEnd, { capacity: 2 }))
);
ok(
  'resource capacity 1 blocks one overlap',
  throwsConflict(() => allocation.assertResourceCapacity(rows, windowStart, windowEnd, { capacity: 1 }))
);
const twoRows = [
  ...rows,
  { booking: 'd', status: 'assigned', startAt: new Date('2026-11-02T10:00:00Z'), endAt: new Date('2026-11-02T11:00:00Z') },
  { booking: 'e', status: 'assigned', startAt: new Date('2026-11-02T10:15:00Z'), endAt: new Date('2026-11-02T11:15:00Z') },
];
ok(
  'resource capacity 2 blocks a third overlap',
  throwsConflict(() => allocation.assertResourceCapacity(twoRows, windowStart, windowEnd, { capacity: 2 }))
);

console.log(failures === 0 ? '\nAll local-services allocation units passed.' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
