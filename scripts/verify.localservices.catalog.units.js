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
 * verify.localservices.catalog.units.js — catalogue pure units (no DB).
 * Run: node scripts/verify.localservices.catalog.units.js
 */

const { validateFacetValue } = require('../src/modules/local-services/models/localservice.facet.model');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

ok('TEXT accepts string', validateFacetValue({ key: 'note', dataType: 'TEXT' }, 'hi').valid);
ok('TEXT rejects number', !validateFacetValue({ key: 'note', dataType: 'TEXT' }, 5).valid);
ok('NUMBER accepts finite', validateFacetValue({ key: 'n', dataType: 'NUMBER' }, 3).valid);
ok('ENUM accepts option', validateFacetValue({ key: 'vt', dataType: 'ENUM', options: ['sedan', 'suv'] }, 'suv').valid);
ok('ENUM rejects unknown', !validateFacetValue({ key: 'vt', dataType: 'ENUM', options: ['sedan', 'suv'] }, 'truck').valid);
ok(
  'MULTI_ENUM accepts subset',
  validateFacetValue({ key: 'm', dataType: 'MULTI_ENUM', options: ['a', 'b'] }, ['a']).valid
);
ok('required blocks empty', !validateFacetValue({ key: 'r', dataType: 'TEXT', required: true }, '').valid);
ok('optional allows empty', validateFacetValue({ key: 'o', dataType: 'TEXT' }, '').valid);

console.log(failures === 0 ? '\nAll local-services catalog units passed.' : `\n${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;
