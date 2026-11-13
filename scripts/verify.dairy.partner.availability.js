const assert = require('assert');
const availability = require('../src/modules/dairy/services/dairy.partner.availability.service');
const { locationRequirements } = require('../src/modules/dairy/services/dairy.outlet.location');

const week = Array.from({ length: 7 }, (_, day) => ({
  day,
  isOpen: true,
  opensAt: '09:00',
  closesAt: '18:00',
}));

assert.strictEqual(availability.normalizeSchedule(week).length, 7);
assert.throws(() => availability.normalizeSchedule(week.slice(1)), /seven days/);
assert.throws(() => availability.normalizeSchedule(week.map((row, i) => i === 1 ? { ...row, opensAt: '18:00' } : row)), /valid opening time/);
assert.strictEqual(availability.normalizeSpecialHours([
  { date: '2026-12-25', isClosed: true, label: 'Public holiday' },
]).length, 1);
assert.throws(() => availability.normalizeSpecialHours([
  { date: '2026-02-30', isClosed: true },
]), /valid YYYY-MM-DD/);
assert.throws(() => availability.normalizeSpecialHours([
  { date: '2026-12-25', isClosed: true },
  { date: '2026-12-25', isClosed: false, opensAt: '09:00', closesAt: '12:00' },
]), /only once/);

const operations = {
  acceptingOrders: true,
  timezone: 'Asia/Kolkata',
  operatingHours: week,
  orderCutoffTime: '17:00',
};
assert.strictEqual(
  availability.evaluateAvailability(operations, new Date('2026-11-02T04:30:00.000Z')).canAcceptOrders,
  true,
  'Monday 10:00 IST is within the configured schedule and cut-off'
);
assert.strictEqual(
  availability.evaluateAvailability(operations, new Date('2026-11-02T11:45:00.000Z')).reason,
  'cutoff_passed',
  'Monday 17:15 IST is rejected after the order cut-off'
);
assert.strictEqual(
  availability.evaluateAvailability({ ...operations, specialHours: [{ date: '2026-11-02', isClosed: true }] }, new Date('2026-11-02T04:30:00.000Z')).reason,
  'special_closed',
  'A dated closure overrides otherwise-open weekly hours'
);
assert.strictEqual(
  availability.evaluateAvailability({ ...operations, operatingHours: week.map((row) => row.day === 1 ? { ...row, isOpen: false } : row), specialHours: [{ date: '2026-11-02', isClosed: false, opensAt: '09:00', closesAt: '18:00' }] }, new Date('2026-11-02T04:30:00.000Z')).canAcceptOrders,
  true,
  'Special opening hours override a normally-closed weekday'
);
assert.strictEqual(
  availability.evaluateAvailability({ ...operations, acceptingOrders: false }, new Date('2026-11-02T04:30:00.000Z')).reason,
  'paused'
);
assert.throws(
  () => availability.assertPrimaryLocalityEnabled({ locality: 'home' }, new Set(['home', 'neighbor']), ['neighbor']),
  /primary locality must remain enabled/
);
assert.doesNotThrow(
  () => availability.assertPrimaryLocalityEnabled({ locality: 'home' }, new Set(['home', 'neighbor']), ['home', 'neighbor'])
);
assert.strictEqual(locationRequirements({
  city: 'city',
  locality: 'locality',
  address: '12 Main Street, Alwal',
  location: { type: 'Point', coordinates: [78.5, 17.5] },
}).complete, true);
assert.deepStrictEqual(locationRequirements({ city: 'city', locality: 'locality' }).missing, ['address', 'mapPin']);
assert.strictEqual(
  availability.evaluateAvailability({ ...operations, operatingHours: [], orderCutoffTime: '21:00' }, new Date('2026-11-02T16:00:00.000Z')).canAcceptOrders,
  false,
  'The cut-off remains enforced when weekly hours have not yet been configured'
);

console.log('Dairy partner availability checks passed.');
