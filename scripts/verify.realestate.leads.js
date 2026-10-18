/**
 * verify.realestate.leads.js — Phase 4 BR-06/BR-07 verification.
 *
 * BR-06: An enquiry creates a Lead. It is never a contact message.
 * BR-07: A lead has exactly one assigned executive at a time. Reassignment
 *        is recorded in LeadActivity, never silently overwritten.
 *
 * Run: node scripts/verify.realestate.leads.js
 */

const assert = require('assert');
const mongoose = require('mongoose');
const RealEstateLead = require('../src/modules/realestate/models/realestate.lead.model');
const RealEstateLeadActivity = require('../src/modules/realestate/models/realestate.lead.activity.model');
const RealEstateReferral = require('../src/modules/realestate/models/realestate.referral.model');

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

async function run() {
  console.log('\n[1] all three models register with the expected mongoose names');
  check('RealEstateLead', () => {
    assert.strictEqual(RealEstateLead.modelName, 'RealEstateLead');
  });
  check('RealEstateLeadActivity', () => {
    assert.strictEqual(RealEstateLeadActivity.modelName, 'RealEstateLeadActivity');
  });
  check('RealEstateReferral', () => {
    assert.strictEqual(RealEstateReferral.modelName, 'RealEstateReferral');
  });

  console.log('\n[2] BR-06 — enquiry creates a lead, not a contact message');
  check('lead has required fields', () => {
    const paths = RealEstateLead.schema.paths;
    assert.ok(paths.property, 'lead must have property ref');
    assert.ok(paths.customer, 'lead must have customer ref');
    assert.ok(paths.source, 'lead must have source');
    assert.ok(paths.status, 'lead must have status');
  });
  check('lead source enum includes ENQUIRY', () => {
    const sourceEnum = RealEstateLead.schema.path('source').enumValues;
    assert.ok(sourceEnum.includes('ENQUIRY'), 'ENQUIRY must be a valid source');
  });
  check('lead status defaults to NEW', () => {
    const statusPath = RealEstateLead.schema.paths.status;
    const defaultValue = typeof statusPath.default === 'function' ? statusPath.default() : statusPath.default;
    assert.strictEqual(defaultValue, 'NEW');
  });

  console.log('\n[3] BR-07 — one assigned executive at a time');
  check('lead has executive ref', () => {
    assert.ok(RealEstateLead.schema.paths.executive, 'lead must have executive ref');
  });
  check('lead activity records reassignment', () => {
    const actionEnum = RealEstateLeadActivity.schema.path('action').enumValues;
    assert.ok(actionEnum.includes('REASSIGNED'), 'REASSIGNED must be a valid activity action');
  });
  check('lead activity has fromExecutive and toExecutive', () => {
    assert.ok(RealEstateLeadActivity.schema.paths.fromExecutive, 'activity must record fromExecutive');
    assert.ok(RealEstateLeadActivity.schema.paths.toExecutive, 'activity must record toExecutive');
  });

  console.log('\n[4] BR-09 — structured customer interest');
  check('interest level is a closed enum', () => {
    const levelEnum = RealEstateLead.schema.path('interest.level').enumValues;
    assert.ok(levelEnum.includes('VERY_INTERESTED'));
    assert.ok(levelEnum.includes('NOT_INTERESTED'));
    assert.ok(levelEnum.includes('PURCHASE_DECISION_PENDING'));
  });
  check('interest reason is a closed enum', () => {
    const reasonEnum = RealEstateLead.schema.path('interest.reason').enumValues;
    assert.ok(reasonEnum.includes('PRICE'));
    assert.ok(reasonEnum.includes('LOAN_REQUIRED'));
    assert.ok(reasonEnum.includes('OTHER'));
  });

  console.log('\n[5] referral model — attribution');
  check('referral has unique index on lead', () => {
    const indexes = RealEstateReferral.schema._indexes;
    const hasUniqueLead = Object.values(indexes).some(
      (idx) => idx[1] && idx[1].unique && idx[0].lead
    );
    assert.ok(hasUniqueLead, 'referral must have unique index on lead');
  });
  check('referral status enum', () => {
    const statusEnum = RealEstateReferral.schema.path('status').enumValues;
    assert.ok(statusEnum.includes('PENDING'));
    assert.ok(statusEnum.includes('COMMISSION_EARNED'));
    assert.ok(statusEnum.includes('EXPIRED'));
  });

  console.log('\n[6] lead lifecycle states');
  check('lead status enum has all lifecycle states', () => {
    const statusEnum = RealEstateLead.schema.path('status').enumValues;
    const expected = [
      'NEW', 'CONTACTED', 'VISIT_REQUESTED', 'VISIT_SCHEDULED',
      'VISIT_COMPLETED', 'FOLLOW_UP', 'HOLD', 'SALE', 'LOST',
    ];
    expected.forEach((s) => {
      assert.ok(statusEnum.includes(s), `${s} must be a valid lead status`);
    });
  });

  console.log('\n[7] indexes');
  check('leadCode is unique', () => {
    const indexes = RealEstateLead.schema._indexes;
    const hasUniqueCode = Object.values(indexes).some(
      (idx) => idx[1] && idx[1].unique && idx[0].leadCode
    );
    assert.ok(hasUniqueCode, 'leadCode must be unique');
  });
  check('lead has property+status index', () => {
    const indexes = RealEstateLead.schema._indexes;
    const hasPropertyStatus = Object.values(indexes).some(
      (idx) => idx[0].property && idx[0].status
    );
    assert.ok(hasPropertyStatus, 'lead must have property+status index');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
