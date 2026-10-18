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
 * verify.localservices.recurring.units.js — recurring pure + idempotent units.
 * Run: node scripts/verify.localservices.recurring.units.js
 */

const recurring = require('../src/modules/local-services/services/localservice.recurring.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

(async () => {
  const d = new Date('2026-01-01T00:00:00Z');
  ok('daily +1', recurring.nextDate(d, 'daily').toISOString() === '2026-01-02T00:00:00.000Z');
  ok('alternate +2', recurring.nextDate(d, 'alternate_days').toISOString() === '2026-01-03T00:00:00.000Z');
  ok('weekly kernel +7', recurring.nextDate(d, 'weekly').toISOString() === '2026-01-08T00:00:00.000Z');

  // Idempotent generation: second run => alreadyPresent, schedule still advances.
  const store = new Map();
  const ag = {
    _id: 'ag1',
    cadence: 'weekly',
    intervalCount: 1,
    nextOccurrenceDate: new Date('2026-01-01T00:00:00Z'),
    endDate: null,
    status: 'active',
    save: async () => ag,
  };
  const AgreementModel = { find: async () => (ag.status === 'active' && ag.nextOccurrenceDate <= new Date('2026-01-10T00:00:00Z') ? [ag] : []) };
  const OccurrenceModel = {
    create: async (doc) => {
      const k = `${doc.agreement}:${new Date(doc.occurrenceDate).toISOString()}`;
      if (store.has(k)) {
        const e = new Error('dup');
        e.code = 11000;
        throw e;
      }
      store.set(k, doc);
      return doc;
    },
  };
  const r1 = await recurring.generateDueOccurrences(new Date('2026-01-10T00:00:00Z'), { AgreementModel, OccurrenceModel });
  ok('first generates 1', r1.generated === 1, JSON.stringify(r1));
  // reset date to same to force duplicate path
  ag.nextOccurrenceDate = new Date('2026-01-01T00:00:00Z');
  const r2 = await recurring.generateDueOccurrences(new Date('2026-01-10T00:00:00Z'), { AgreementModel, OccurrenceModel });
  ok('retry alreadyPresent, schedule advances either way', r2.alreadyPresent === 1 && ag.nextOccurrenceDate > new Date('2026-01-01T00:00:00Z'), JSON.stringify(r2));

  console.log(failures === 0 ? '\nAll local-services recurring units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
