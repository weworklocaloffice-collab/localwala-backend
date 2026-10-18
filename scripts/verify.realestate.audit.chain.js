/**
 * LocalWala – Real Estate audit vocabulary + hash-chain gate (Phase D).
 *
 * Two parts:
 *  [A] Static (no DB): every `auditService.record()` call site in the
 *      vertical uses an eventType/targetType from the model's closed
 *      enums (actorType case-insensitive — the service normalizes).
 *      This is the regression test for the silent-drop class of bug:
 *      `record()` swallows validation failures by design, so a wrong
 *      string used to mean a missing trail with all checks green.
 *  [B] Live (needs MONGODB_URL, skipped otherwise): `verifyChain()`
 *      over the newest 500 rows — detects rewritten rows and forks.
 *
 * Run: node scripts/verify.realestate.audit.chain.js
 */

const fs = require('fs');
const path = require('path');

const API = path.resolve(__dirname, '..');
const MODULE = path.join(API, 'src', 'modules', 'realestate');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};

const RealEstateAuditLog = require(path.join(MODULE, 'models/realestate.audit.log.model.js'));
const auditService = require(path.join(MODULE, 'services/realestate.audit.service.js'));

const EVENT_ENUM = new Set(RealEstateAuditLog.schema.path('eventType').enumValues);
const TARGET_ENUM = new Set(RealEstateAuditLog.schema.path('targetType').enumValues);
const ACTOR_ENUM = new Set(RealEstateAuditLog.schema.path('actorType').enumValues);

const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
};

// [A] Vocabulary: for each file calling auditService.record, pull the
// eventType/targetType/actorType literals near each call.
try {
  const offenders = [];
  for (const file of walk(MODULE)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes('auditService.record')) continue;
    const calls = src.split('auditService.record(').slice(1);
    for (const chunk of calls) {
      const window = chunk.slice(0, 1200);
      const ev = (window.match(/eventType:\s*'([^']+)'/) || [])[1];
      const tt = (window.match(/targetType:\s*'([^']+)'/) || [])[1];
      const at = (window.match(/actorType:\s*'([^']+)'/) || [])[1];
      if (ev && !EVENT_ENUM.has(ev)) offenders.push(`${path.basename(file)}: eventType ${ev}`);
      if (tt && !TARGET_ENUM.has(tt)) offenders.push(`${path.basename(file)}: targetType ${tt}`);
      if (at && !ACTOR_ENUM.has(String(at).toUpperCase())) {
        offenders.push(`${path.basename(file)}: actorType ${at}`);
      }
    }
  }
  if (offenders.length) throw new Error(offenders.slice(0, 8).join('; '));
  ok('every auditService.record call site uses enum vocabulary');
} catch (e) {
  bad('audit vocabulary', e.message);
}

// [A2] Hash helpers are pure and deterministic.
try {
  const a = auditService.computeHash({ prevHash: 'GENESIS', eventType: 'X' });
  const b = auditService.computeHash({ prevHash: 'GENESIS', eventType: 'X' });
  const c = auditService.computeHash({ prevHash: 'GENESIS', eventType: 'Y' });
  if (a !== b) throw new Error('hash not deterministic');
  if (a === c) throw new Error('hash does not commit to content');
  if (auditService.normalizeActorType('admin') !== 'ADMIN') throw new Error('actor normalize broken');
  ok('chain hashing is deterministic and content-committing');
} catch (e) {
  bad('hash primitives', e.message);
}

// [B] Live chain verification (skipped without a database).
(async () => {
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) {
    console.log('  SKIP live chain check (MONGODB_URL not set)');
    return done();
  }
  try {
    require('dotenv').config({ path: path.join(API, '.env') });
    const mongoose = require('mongoose');
    const url2 = process.env.MONGODB_URL || process.env.MONGODB_URI || url;
    await mongoose.connect(url2, { serverSelectionTimeoutMS: 8000 });
    const res = await auditService.verifyChain(500);
    await mongoose.disconnect();
    if (!res.ok) throw new Error(`chain broken at ${res.brokenAt || '?'}${res.branched ? ' (fork)' : ''}`);
    ok(`chain intact over ${res.checked} row(s)`);
  } catch (e) {
    bad('live chain', e.message);
  }
  done();
})();

function done() {
  if (failed) {
    console.log(`\n${failed} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log('\nALL AUDIT CHAIN CHECKS PASSED');
}
