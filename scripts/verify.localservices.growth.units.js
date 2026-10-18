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
 * verify.localservices.growth.units.js — plans + featured pure units.
 * Run: node scripts/verify.localservices.growth.units.js
 */

const growth = require('../src/modules/local-services/services/localservice.growth.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

ok('monthly renew +1mo', growth.nextRenewAt(new Date('2026-01-15T00:00:00Z'), 'monthly').toISOString() === '2026-02-15T00:00:00.000Z');
ok('yearly renew +1y', growth.nextRenewAt(new Date('2026-01-15T00:00:00Z'), 'yearly').toISOString() === '2027-01-15T00:00:00.000Z');
const placements = [
  { provider: 'p1', service: null, status: 'active', from: new Date('2026-01-01'), to: new Date('2026-12-31') },
  { provider: 'p2', service: null, status: 'scheduled', from: new Date('2026-01-01'), to: new Date('2026-12-31') },
];
ok('sponsored provider flagged', growth.isFeatured(placements, { providerId: 'p1' }, new Date('2026-06-01')) === true);
ok('scheduled not flagged', growth.isFeatured(placements, { providerId: 'p2' }, new Date('2026-06-01')) === false);
ok('expired not flagged', growth.isFeatured(placements, { providerId: 'p1' }, new Date('2027-06-01')) === false);

console.log(failures === 0 ? '\nAll local-services growth units passed.' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
