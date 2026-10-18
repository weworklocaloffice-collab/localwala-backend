/**
 * verify.realestate.visits.js — Phase 5 BR-08/BR-09 verification.
 *
 * BR-08: An executive cannot self-report a visit without a geolocation-verified
 *        check-in. VISIT_COMPLETED requires a checkIn with coordinates inside
 *        checkInRadiusMeters of the property.
 * BR-09: Customer interest is structured, from a closed enum, with a reason
 *        code from a closed enum.
 *
 * Run: node scripts/verify.realestate.visits.js
 */

const assert = require('assert');
const RealEstateExecutive = require('../src/modules/realestate/models/realestate.executive.model');
const RealEstateVisitRequest = require('../src/modules/realestate/models/realestate.visit.request.model');
const RealEstateVisit = require('../src/modules/realestate/models/realestate.visit.model');
const RealEstateInterest = require('../src/modules/realestate/models/realestate.interest.model');
const RealEstateFollowUp = require('../src/modules/realestate/models/realestate.followup.model');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  OK   ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${name}: ${e.message}`);
    failed++;
  }
}

console.log('\n[1] all five models register with the expected mongoose names');
check('RealEstateExecutive', () => {
  assert.strictEqual(RealEstateExecutive.modelName, 'RealEstateExecutive');
});
check('RealEstateVisitRequest', () => {
  assert.strictEqual(RealEstateVisitRequest.modelName, 'RealEstateVisitRequest');
});
check('RealEstateVisit', () => {
  assert.strictEqual(RealEstateVisit.modelName, 'RealEstateVisit');
});
check('RealEstateInterest', () => {
  assert.strictEqual(RealEstateInterest.modelName, 'RealEstateInterest');
});
check('RealEstateFollowUp', () => {
  assert.strictEqual(RealEstateFollowUp.modelName, 'RealEstateFollowUp');
});

console.log('\n[2] BR-08 — geofenced check-in');
check('visit has checkInRadiusMeters field', () => {
  assert.ok(RealEstateVisit.schema.paths.checkInRadiusMeters, 'visit must have checkInRadiusMeters');
});
check('visit has checkIn fields', () => {
  const paths = RealEstateVisit.schema.paths;
  assert.ok(paths['checkIn.coordinates'], 'visit must have checkIn.coordinates');
  assert.ok(paths['checkIn.timestamp'], 'visit must have checkIn.timestamp');
  assert.ok(paths['checkIn.distanceMeters'], 'visit must have checkIn.distanceMeters');
});
check('checkInRadiusMeters defaults to 200', () => {
  const radiusPath = RealEstateVisit.schema.paths.checkInRadiusMeters;
  const defaultValue = typeof radiusPath.default === 'function' ? radiusPath.default() : radiusPath.default;
  assert.strictEqual(defaultValue, 200);
});

console.log('\n[3] BR-09 — structured customer interest');
check('interest level is a closed enum', () => {
  const levelEnum = RealEstateInterest.schema.path('level').enumValues;
  assert.ok(levelEnum.includes('VERY_INTERESTED'));
  assert.ok(levelEnum.includes('NOT_INTERESTED'));
  assert.ok(levelEnum.includes('PURCHASE_DECISION_PENDING'));
});
check('interest reason is a closed enum', () => {
  const reasonEnum = RealEstateInterest.schema.path('reason').enumValues;
  assert.ok(reasonEnum.includes('PRICE'));
  assert.ok(reasonEnum.includes('LOAN_REQUIRED'));
  assert.ok(reasonEnum.includes('OTHER'));
});
check('interest has unique index on visit', () => {
  const indexes = RealEstateInterest.schema._indexes;
  const hasUniqueVisit = Object.values(indexes).some(
    (idx) => idx[1] && idx[1].unique && idx[0].visit
  );
  assert.ok(hasUniqueVisit, 'interest must have unique index on visit');
});

console.log('\n[4] executive model');
check('executive has operationalZone ref', () => {
  assert.ok(RealEstateExecutive.schema.paths.operationalZone, 'executive must have operationalZone');
});
check('executive has maxConcurrentVisits', () => {
  assert.ok(RealEstateExecutive.schema.paths.maxConcurrentVisits, 'executive must have maxConcurrentVisits');
});
check('executive has available flag', () => {
  assert.ok(RealEstateExecutive.schema.paths.available, 'executive must have available flag');
});
check('executive has unique index on user', () => {
  const indexes = RealEstateExecutive.schema._indexes;
  const hasUniqueUser = Object.values(indexes).some(
    (idx) => idx[1] && idx[1].unique && idx[0].user
  );
  assert.ok(hasUniqueUser, 'executive must have unique index on user');
});

console.log('\n[5] follow-up model');
check('follow-up has nextFollowUpAt indexed', () => {
  const indexes = RealEstateFollowUp.schema._indexes;
  const hasNextFollowUp = Object.values(indexes).some(
    (idx) => idx[0].nextFollowUpAt
  );
  assert.ok(hasNextFollowUp, 'follow-up must have nextFollowUpAt index');
});
check('follow-up status enum', () => {
  const statusEnum = RealEstateFollowUp.schema.path('status').enumValues;
  assert.ok(statusEnum.includes('PENDING'));
  assert.ok(statusEnum.includes('COMPLETED'));
  assert.ok(statusEnum.includes('RESCHEDULED'));
  assert.ok(statusEnum.includes('CANCELLED'));
});

console.log('\n[6] visit request model');
check('visit request status enum', () => {
  const statusEnum = RealEstateVisitRequest.schema.path('status').enumValues;
  assert.ok(statusEnum.includes('PENDING_ASSIGNMENT'));
  assert.ok(statusEnum.includes('ASSIGNED'));
  assert.ok(statusEnum.includes('COMPLETED'));
  assert.ok(statusEnum.includes('CANCELLED'));
});
check('visit request has checkInRadiusMeters', () => {
  assert.ok(RealEstateVisitRequest.schema.paths.checkInRadiusMeters, 'request must have checkInRadiusMeters');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
