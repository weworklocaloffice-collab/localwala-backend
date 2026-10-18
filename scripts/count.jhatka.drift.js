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
 * count.jhatka.drift.js — per-file count of route→model field drift.
 *
 * A progress view, not a gate: `verify.jhatka.routeschema.units.js` decides pass
 * or fail. This prints which files still have work and how much, so a rewrite
 * session can be tracked without re-reading the whole failure text.
 *
 * Usage: node scripts/count.jhatka.drift.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const ROUTES_DIR = path.join(REPO_ROOT, 'src', 'modules', 'jhatka', 'routes');

// Non-route modules are scanned too.
//
// The first version of this script looked ONLY at `routes/`, and so reported 11/11
// clean while `cron.js` — which runs the nightly subscription generator — was still
// carrying `sub.nextDeliveryDate`, `sub.cycleAnchorDay`, `sub.timezone` and
// `sub.outlets[0]`, none of which exist on `JhatkaSubscription`. The generator would
// have matched nothing and produced no occurrences, silently, every night.
//
// "The route layer is clean" and "the module is clean" are different claims, and
// only the second one is worth making.
const ALSO_SCANNED = ['cron.js'].map((f) => path.join(REPO_ROOT, 'src', 'modules', 'jhatka', f));

// Names verified absent from EVERY Jhatka model. A name that exists on SOME model
// is not drift — `estimatedAmountPaise` is real on JhatkaWeightConfirmation.
const FORBIDDEN = [
  'estimatedTotalPaise', 'finalTotalPaise', 'estimatedSubtotalPaise',
  'finalSubtotalPaise', 'estimatedTaxPaise', 'finalTaxPaise',
  'preAuthPaise', 'refundPaise', 'estimatedWeightGrams',
  'finalWeightGrams', 'deliveryId', 'statusHistory', 'scheduledFor',
  'codCeilingPaise',
  // Subscription vocabulary from the blueprint that the model does not carry.
  // Single `outlet`, not `outlets[]`; `nextOccurrenceDate`, not
  // `nextDeliveryDate`; `scheduleType`/`deliverySlot`, not `cycleAnchorDay`/
  // `timezone`.
  'nextDeliveryDate', 'cycleAnchorDay', 'timezone',
];

const stripNonCode = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '));

console.log('\n=== route → model field drift, per file ===\n');

let grand = 0;
const rows = [];

const scan = (file, displayName) => {
  // Qualified the member-access pattern so `sub.stats.nextDeliveryDate` does not read
  // as `sub.nextDeliveryDate`.
  //
  // `JhatkaSubscription` has BOTH a top-level `nextOccurrenceDate` and a nested
  // `stats.nextDeliveryDate`, and the drift list has to ban only the top-level name
  // — the nested one is real (jhatka.subscription.model.js:318). A bare
  // `\.token\b` cannot tell them apart, so it flagged correct code as drift. The
  // negative lookbehind below rejects a member access whose IMMEDIATE owner is
  // another identifier, which is exactly the `stats.` case.
  const memberAccess = (token) =>
    new RegExp(`(?<![\\w.])\\w+\\.${token}\\b`, 'g');
  const objectKey = (token) => new RegExp(`(?<![\\w.])${token}\\s*:`, 'g');

  const src = stripNonCode(fs.readFileSync(file, 'utf8'));
  let total = 0;
  const detail = [];
  FORBIDDEN.forEach((token) => {
    const hits =
      (src.match(memberAccess(token)) || []).length + (src.match(objectKey(token)) || []).length;
    if (hits) {
      total += hits;
      detail.push(`${token}x${hits}`);
    }
  });
  grand += total;
  rows.push({ file: displayName, total, detail });
};

fs.readdirSync(ROUTES_DIR)
  .filter((f) => f.endsWith('.js'))
  .sort()
  .forEach((f) => scan(path.join(ROUTES_DIR, f), f));

ALSO_SCANNED.forEach((f) => {
  if (fs.existsSync(f)) scan(f, `../${path.basename(f)}`);
});

rows.forEach(({ file, total, detail }) => {
  const label = total === 0 ? '  CLEAN  ' : `  ${String(total).padStart(3)}  `;
  console.log(`${label}${file}${total ? '   ' + detail.join(', ') : ''}`);
});

const dirty = rows.filter((r) => r.total > 0).length;
console.log('');
console.log(`  ${rows.length - dirty}/${rows.length} files clean, ${grand} violations remaining`);
console.log('');

process.exit(grand === 0 ? 0 : 1);