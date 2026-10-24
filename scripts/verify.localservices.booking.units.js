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
 * verify.localservices.booking.units.js — booking engine pure units (no DB).
 * Run: node scripts/verify.localservices.booking.units.js
 */

const booking = require('../src/modules/local-services/services/localservice.booking.service');
const availability = require('../src/modules/local-services/services/localservice.availability.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// 1. Legal ladder
ok('DRAFT->REQUESTED allowed', booking.canTransition('DRAFT', 'REQUESTED'));
ok('REQUESTED->PENDING_PROVIDER allowed', booking.canTransition('REQUESTED', 'PENDING_PROVIDER'));
ok('CONFIRMED->IN_PROGRESS allowed', booking.canTransition('CONFIRMED', 'IN_PROGRESS'));
ok('IN_PROGRESS->COMPLETED allowed', booking.canTransition('IN_PROGRESS', 'COMPLETED'));

// 2. Illegal jumps rejected
ok('DRAFT->COMPLETED blocked', !booking.canTransition('DRAFT', 'COMPLETED'));
ok('COMPLETED->CONFIRMED blocked', !booking.canTransition('COMPLETED', 'CONFIRMED'));
let threw = false;
try {
  booking.assertTransition('DRAFT', 'COMPLETED');
} catch (e) {
  threw = e.statusCode === 409;
}
ok('illegal throws 409', threw);

// 2b. Actor-scoped transitions: a customer cannot complete a booking alone.
ok('customer cannot complete', !booking.canActorTransition('customer', 'IN_PROGRESS', 'COMPLETED'));
ok('customer cannot confirm', !booking.canActorTransition('customer', 'ACCEPTED', 'CONFIRMED'));
ok('customer can request', booking.canActorTransition('customer', 'DRAFT', 'REQUESTED'));
ok('customer can dispute', booking.canActorTransition('customer', 'IN_PROGRESS', 'DISPUTED'));
ok('provider can complete', booking.canActorTransition('provider', 'IN_PROGRESS', 'COMPLETED'));
let actorThrew = false;
try {
  booking.assertActorTransition('customer', 'IN_PROGRESS', 'COMPLETED');
} catch (e) {
  actorThrew = e.statusCode === 403;
}
ok('actor violation throws 403', actorThrew);

// 2c. Booking references do not repeat across calls/process restarts.
const code1 = booking.buildBookingCode();
const code2 = booking.buildBookingCode();
ok('booking codes unique', code1 !== code2, `${code1} == ${code2}`);

// 3. Overlap: same slot twice blocked, adjacent free
const held = [{ status: 'held', startAt: new Date('2026-11-01T10:00:00Z'), endAt: new Date('2026-11-01T11:00:00Z') }];
let blocked = false;
try {
  availability.assertSlotFree(held, new Date('2026-11-01T10:30:00Z'), new Date('2026-11-01T11:30:00Z'), 0);
} catch (e) {
  blocked = e.statusCode === 409;
}
ok('overlapping slot blocked', blocked);
let free = true;
try {
  availability.assertSlotFree(held, new Date('2026-11-01T11:00:00Z'), new Date('2026-11-01T12:00:00Z'), 0);
} catch {
  free = false;
}
ok('adjacent slot free', free);
// Released holds don't block
let releasedFree = true;
try {
  availability.assertSlotFree(
    [{ status: 'released', startAt: new Date('2026-11-01T10:00:00Z'), endAt: new Date('2026-11-01T11:00:00Z') }],
    new Date('2026-11-01T10:30:00Z'),
    new Date('2026-11-01T11:30:00Z'),
    0
  );
} catch {
  releasedFree = false;
}
ok('released hold frees slot', releasedFree);

// 3b. Expired holds and capacity
let expiredFree = true;
try {
  availability.assertSlotFree(
    [
      {
        status: 'held',
        startAt: new Date('2026-11-01T10:00:00Z'),
        endAt: new Date('2026-11-01T11:00:00Z'),
        expiresAt: new Date('2026-11-01T09:00:00Z'),
      },
    ],
    new Date('2026-11-01T10:30:00Z'),
    new Date('2026-11-01T11:30:00Z'),
    0,
    { now: new Date('2026-11-01T10:00:00Z') }
  );
} catch {
  expiredFree = false;
}
ok('expired hold frees slot', expiredFree);

const activeHeld = [{ status: 'held', startAt: new Date('2026-11-01T10:00:00Z'), endAt: new Date('2026-11-01T11:00:00Z'), expiresAt: new Date('2026-11-01T23:00:00Z') }];
let capacityTwoFree = true;
try {
  availability.assertSlotFree(activeHeld, new Date('2026-11-01T10:30:00Z'), new Date('2026-11-01T11:30:00Z'), 0, {
    capacity: 2,
    now: new Date('2026-11-01T09:00:00Z'),
  });
} catch {
  capacityTwoFree = false;
}
ok('capacity 2 allows one existing hold', capacityTwoFree);
let capacityFullBlocked = false;
try {
  availability.assertSlotFree([...activeHeld, ...activeHeld], new Date('2026-11-01T10:30:00Z'), new Date('2026-11-01T11:30:00Z'), 0, {
    capacity: 2,
    now: new Date('2026-11-01T09:00:00Z'),
  });
} catch (e) {
  capacityFullBlocked = e.statusCode === 409;
}
ok('capacity 2 blocks third overlap', capacityFullBlocked);

// 3c. Working hours (local-time rules)
const insideStart = new Date(2026, 10, 2, 10, 0);
const rule = { day: insideStart.getDay(), open: '09:00', close: '18:00' };
ok('inside working hours allowed', availability.isWithinWorkingHours(rule, insideStart, new Date(2026, 10, 2, 11, 0)));
ok('outside working hours blocked', !availability.isWithinWorkingHours(rule, new Date(2026, 10, 2, 18, 30), new Date(2026, 10, 2, 19, 30)));
ok('wrong weekday blocked', !availability.isWithinWorkingHours({ ...rule, day: (rule.day + 1) % 7 }, insideStart, new Date(2026, 10, 2, 11, 0)));
const overnight = { day: insideStart.getDay(), open: '22:00', close: '02:00' };
ok('overnight rule allows next-day end', availability.isWithinWorkingHours(overnight, new Date(2026, 10, 2, 23, 0), new Date(2026, 10, 3, 1, 0)));

// 4. Completion hook calls revenue once (stubbed models, no DB)
(async () => {
  const fakeBooking = {
    _id: 'b1',
    status: 'IN_PROGRESS',
    categoryKey: 'home',
    labourAmount: 400,
    partsAmount: 100,
    discountAmount: 0,
    serviceValue: 500,
    payment: null,
    save: async () => fakeBooking,
  };
  const BookingModel = { findById: async () => fakeBooking };
  const HistoryModel = { create: async () => ({}) };
  // stub revenue hook by monkey-patching require cache
  const bookingService = require('../src/modules/local-services/services/localservice.revenue.booking.service');
  const orig = bookingService.applyRevenueForBooking;
  let calls = 0;
  bookingService.applyRevenueForBooking = async () => {
    calls += 1;
    return { entry: { _id: 'e1', idempotencyKey: 'k' }, deduped: false };
  };
  const { booking: updated, revenue } = await booking.transitionBooking('b1', 'COMPLETED', {}, { BookingModel, HistoryModel });
  bookingService.applyRevenueForBooking = orig;
  ok('COMPLETED fires revenue hook', calls === 1 && updated.status === 'COMPLETED' && revenue.deduped === false);
  console.log(failures === 0 ? '\nAll local-services booking units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
