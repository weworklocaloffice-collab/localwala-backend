/**
 * verify.reels.social.js — does the social + reels hybrid monolith hold together?
 *
 * Hand-rolled like verify.realestate.boot.js (only fs, path, and the app's own
 * deps — no mocha/chai). Needs no database: schema introspection, Joi shapes,
 * pure functions and route tables all resolve without a Mongo connection.
 *
 * Run: node scripts/verify.reels.social.js
 */

const fs = require('fs');
const path = require('path');

const API = path.resolve(__dirname, '..');

let failed = 0;
let passed = 0;
const ok = (m) => {
  passed++;
  console.log(`  OK   ${m}`);
};
const bad = (m, e) => {
  failed++;
  console.log(`  FAIL ${m}  ->  ${e}`);
};
const check = (name, fn) => {
  try {
    fn();
    ok(name);
  } catch (e) {
    bad(name, e.message);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const FINGERPRINT = 'LWL|WWL|2026|LOCALWALA|NODE';

// [1] module trees require cleanly (wrong relative paths surface only here) //
console.log('\n[1] social + reels modules require cleanly');
for (const rel of [
  'src/modules/social/index.js',
  'src/modules/social/routes/social.route.js',
  'src/modules/reels/index.js',
  'src/modules/reels/routes/reels.admin.route.js',
  'src/modules/reels/workers/reels.cron.service.js',
  'src/routes/v1/index.js',
  'src/routes/v1/reel.route.js',
  'src/services/cron.job.scheduler.service.js',
  'src/models/index.js',
]) {
  check(rel, () => require(path.join(API, rel)));
}

// [2] pure functions: CTA matrix, phone normalisation, hashing //
console.log('\n[2] pure functions behave');
const adminService = require(path.join(API, 'src/modules/reels/admin/reels.admin.service'));
const contactsService = require(path.join(API, 'src/modules/social/contacts/contacts.service'));

check('suggestCta covers the documented matrix', () => {
  const cases = [
    ['FOOD', 'PRODUCT', 'ORDER NOW'],
    ['FOOD', 'RESTAURANT', 'ORDER NOW'],
    ['DAIRY', 'PRODUCT', 'SUBSCRIBE'],
    ['SERVICES', 'SERVICE', 'BOOK NOW'],
    ['SERVICES', 'VENDOR', 'BOOK NOW'],
    ['REAL_ESTATE', 'PROPERTY', 'VIEW PROPERTY'],
  ];
  for (const [vertical, target, expected] of cases) {
    assert(adminService.suggestCta(vertical, target) === expected, `${vertical}+${target}`);
  }
  assert(adminService.suggestCta('FOOD', 'PROPERTY') === 'VIEW MORE', 'unknown pairing falls back');
});

check('every matrix pairing is a legal vertical/target pairing', () => {
  for (const [vertical, targets] of Object.entries(adminService.TARGETS_BY_VERTICAL)) {
    assert(targets.length > 0, `${vertical} has no targets`);
  }
});

check('normalizePhone canonical vectors (must match Flutter)', () => {
  assert(contactsService.normalizePhone('+91 98765 43210') === '919876543210', 'in cc + spaces');
  assert(contactsService.normalizePhone('098765 43210') === '9876543210', 'leading zero stripped');
});

check('sha256Hex is 64-char lowercase hex and deterministic', () => {
  const a = contactsService.sha256Hex('919876543210');
  assert(/^[0-9a-f]{64}$/.test(a), 'format');
  assert(contactsService.sha256Hex('919876543210') === a, 'deterministic');
  assert(contactsService.sha256Hex('919876543211') !== a, 'distinct input, distinct hash');
});

// [3] Joi shapes accept the documented contracts and reject garbage //
console.log('\n[3] validation contracts hold');
const Joi = require(path.join(API, 'node_modules/joi'));
const compile = (schema) => Joi.compile(schema).prefs({ abortEarly: false });

check('sync-contacts accepts 64-hex array, rejects plaintext', () => {
  const v = require(
    path.join(API, 'src/modules/social/contacts/validators/sync-contacts.validator')
  );
  const good = compile(v.syncContactsValidation).validate({ body: { contacts: ['a'.repeat(64)] } });
  assert(!good.error, `valid rejected: ${good.error && good.error.message}`);
  const empty = compile(v.syncContactsValidation).validate({ body: { contacts: [] } });
  assert(empty.error, 'empty array accepted');
  const plain = compile(v.syncContactsValidation).validate({
    body: { contacts: ['+919876543210'] },
  });
  assert(plain.error, 'plaintext phone accepted — must be hash-only');
});

check('admin create accepts FOOD+PRODUCT, rejects FOOD+PROPERTY shape', () => {
  const v = require(path.join(API, 'src/modules/reels/admin/reels.admin.validation'));
  const base = { vertical: 'FOOD', target: { type: 'PRODUCT', refId: 'a'.repeat(24) } };
  assert(!compile(v.createReelValidation).validate({ body: base }).error, 'valid create rejected');
  const noTarget = compile(v.createReelValidation).validate({ body: { vertical: 'FOOD' } });
  assert(noTarget.error, 'targetless create accepted');
});

// [4] routes registered where the doc says they are //
console.log('\n[4] route tables match docs §7.4/§7.5');
const routePaths = (router) =>
  router.stack
    .filter((l) => l.route)
    .map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);

check('social routes: sync + privacy', () => {
  const paths = routePaths(require(path.join(API, 'src/modules/social/routes/social.route')));
  for (const p of ['POST /contacts/sync', 'GET /privacy', 'PATCH /privacy'])
    assert(paths.includes(p), `missing ${p}`);
});

check('customer reels: feed + interactions, NO upload (V1 rule)', () => {
  const paths = routePaths(require(path.join(API, 'src/routes/v1/reel.route')));
  for (const p of [
    'GET /feed',
    'POST /:reelId/like',
    'POST /:reelId/comment',
    'POST /:reelId/report',
  ]) {
    assert(paths.includes(p), `missing ${p}`);
  }
  assert(!paths.some((p) => p.includes('/upload')), 'customer upload route still present');
});

check('admin reels: documented endpoints present (V1 contract)', () => {
  const paths = routePaths(require(path.join(API, 'src/modules/reels/routes/reels.admin.route')));
  // The media-upload pipeline (§7.5) and the /lookups picker are part of V1.
  const expected = [
    'POST /upload-url',
    'POST /upload',
    'POST /finalize',
    'GET /lookups',
    'POST /',
    'GET /',
    'GET /:id',
    'PATCH /:id',
    'DELETE /:id',
    'POST /:id/publish',
    'GET /reports',
    'POST /reports/:reportId/review',
    'GET /:id/analytics',
  ];
  for (const p of expected) assert(paths.includes(p), `missing ${p}: ${paths.join(', ')}`);
  assert(!paths.some((p) => p === 'PUT /:id'), 'reels has no PUT (use PATCH)');
});

check('moderation queue: reports listed before :id, decisions valid', () => {
  const paths = routePaths(require(path.join(API, 'src/modules/reels/routes/reels.admin.route')));
  assert(paths.includes('GET /reports'), 'GET /reports missing');
  assert(paths.includes('POST /reports/:reportId/review'), 'review route missing');
  const src = fs.readFileSync(
    path.join(API, 'src/modules/reels/routes/reels.admin.route.js'),
    'utf8'
  );
  assert(src.indexOf("'/reports'") < src.indexOf("'/:id'"), 'reports must precede :id');
  const v = require(path.join(API, 'src/modules/reels/admin/reels.admin.validation'));
  for (const d of ['REVIEWING', 'DISMISS', 'HIDE_REEL', 'REMOVE_REEL']) {
    const r = compile(v.reviewReportValidation).validate({
      params: { reportId: 'a'.repeat(24) },
      body: { decision: d },
    });
    assert(!r.error, `decision ${d} rejected`);
  }
});

// [5] schema indexes exist (introspection — no DB round trip) //
console.log('\n[5] indexes declared on schemas');
const models = require(path.join(API, 'src/models'));

const hasIndex = (model, fields) => {
  const indexes = model.schema.indexes().map(([spec]) => JSON.stringify(spec));
  return indexes.some((spec) => fields.every((f) => spec.includes(`"${f}"`)));
};

check('user_contact_matches: unique (userId, matchedUserId)', () => {
  const unique = models.UserContactMatch.schema.indexes().filter(([, opts]) => opts && opts.unique);
  assert(
    unique.some(([spec]) => spec.userId === 1 && spec.matchedUserId === 1),
    'unique pair missing'
  );
  assert(hasIndex(models.UserContactMatch, ['matchedUserId']), 'matchedUserId index missing');
});

check('reel_interactions: unique (reelId, userId, type)', () => {
  const unique = models.ReelInteraction.schema.indexes().filter(([, opts]) => opts && opts.unique);
  assert(
    unique.some(([spec]) => spec.reelId === 1 && spec.userId === 1 && spec.type === 1),
    'unique triple missing'
  );
});

check('reels: status, vertical, publishAt indexes', () => {
  const Reel = models.Reel || require(path.join(API, 'src/models/reel.model'));
  assert(hasIndex(Reel, ['status']), 'status index missing');
  assert(hasIndex(Reel, ['vertical']), 'vertical index missing');
  assert(hasIndex(Reel, ['publishAt']), 'publishAt index missing');
});

check('users.phoneHash: sparse unique index for indexed contact matching', () => {
  const User = models.User || require(path.join(API, 'src/models/user.model'));
  const unique = User.schema.indexes().filter(([, opts]) => opts && opts.unique);
  const phoneHashIdx = unique.find(
    ([spec, opts]) => spec.phoneHash === 1 && opts && opts.sparse === true
  );
  assert(phoneHashIdx, 'users.phoneHash sparse unique index missing');
});

// [6] dependency direction: social never imports reels //
console.log('\n[6] dependency direction (docs §2)');
const walk = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
};

check('no file under modules/social requires modules/reels', () => {
  const offenders = walk(path.join(API, 'src/modules/social')).filter((f) =>
    /require\(['"][^'"]*reels[^'"]*['"]\)/.test(fs.readFileSync(f, 'utf8'))
  );
  assert(offenders.length === 0, `offenders: ${offenders.join(', ')}`);
});

// [7] licence headers on every new module file //
console.log('\n[7] licence headers');
check('fingerprint on all social + reels module files', () => {
  const files = [
    ...walk(path.join(API, 'src/modules/social')),
    ...walk(path.join(API, 'src/modules/reels')),
  ];
  assert(files.length > 0, 'no module files found');
  const bare = files.filter((f) => !fs.readFileSync(f, 'utf8').includes(FINGERPRINT));
  assert(bare.length === 0, `missing header: ${bare.join(', ')}`);
});

// [8] rate limiting sits behind auth on every expensive write //
console.log('\n[8] rate limiting wired');
check('limiters exported and are middleware functions', () => {
  const limiters = require(path.join(API, 'src/middlewares/rateLimiter'));
  for (const name of [
    'contactsSyncLimiter',
    'reelsInteractLimiter',
    'reelsCommentLimiter',
    'reelsAdminUploadLimiter',
  ]) {
    assert(typeof limiters[name] === 'function', `${name} missing`);
  }
});

check('expensive routes reference a limiter after auth', () => {
  const pairs = [
    ['src/modules/social/routes/social.route.js', 'contactsSyncLimiter'],
    ['src/routes/v1/reel.route.js', 'reelsInteractLimiter'],
    ['src/routes/v1/reel.route.js', 'reelsCommentLimiter'],
    ['src/modules/reels/routes/reels.admin.route.js', 'reelsAdminUploadLimiter'],
  ];
  for (const [rel, limiter] of pairs) {
    const src = fs.readFileSync(path.join(API, rel), 'utf8');
    assert(src.includes(limiter), `${rel} missing ${limiter}`);
  }
});

// [9] Phase-2 backfill script exists and references the right model //
console.log('\n[9] Phase-2 backfill script');
check('migrate.user.phonehash.js exists and uses bulkWrite', () => {
  const src = fs.readFileSync(path.join(API, 'scripts/migrate.user.phonehash.js'), 'utf8');
  assert(src.includes("require('../src/models')"), 'must import models barrel');
  assert(src.includes('bulkWrite'), 'must batch with bulkWrite');
  assert(src.includes('phoneHash'), 'must write to phoneHash field');
});

check('contacts.service.js uses indexed phoneHash $in (no full scan)', () => {
  const src = fs.readFileSync(path.join(API, 'src/modules/social/contacts/contacts.service.js'), 'utf8');
  assert(src.includes('phoneHash: { $in'), 'must use indexed $in query');
  assert(!/User\.find\({ status: true }\)[\s\S]*\.skip\(skip\)[\s\S]*\.limit\(batchSize\)/.test(src), 'old batch-scan loop still present');
});

check('proof.cache abstraction: memory by default, redis when REDIS_URL set', () => {
  const svc = fs.readFileSync(path.join(API, 'src/modules/social/social-proof/social-proof.service.js'), 'utf8');
  assert(!svc.includes('new Map()'), 'in-memory Map must not be hardcoded in the service');
  assert(svc.includes("require('./proof.cache')"), 'service must delegate to proof.cache');
  const cacheSrc = fs.readFileSync(path.join(API, 'src/modules/social/social-proof/proof.cache.js'), 'utf8');
  assert(cacheSrc.includes('module.exports = { get, set'), 'cache must export get/set');
  assert(cacheSrc.includes('REDIS_URL'), 'cache must check REDIS_URL');
  assert(cacheSrc.includes('memoryGet') && cacheSrc.includes('redisGet'), 'both backends wired');
});

// [10] route ordering: literals before :param routes (Express first-match-wins) //
// Regression: GET /v1/admin/reels/lookups was registered AFTER GET /:id, so
// "lookups" was captured as an id and rejected by reelIdValidation with a 400
// ("id must only contain hexadecimal characters"). The admin panel's target
// picker then silently stayed empty. Literal paths must precede any param path
// they could be swallowed by.
console.log('\n[10] route ordering (literal before :param)');

// Extracts (method, path) pairs in registration order. The reels admin router
// is mounted flat under /v1/admin/reels, so paths are first-segment.
const extractRouteOrder = (src) => {
  const re = /router\.(get|post|patch|put|delete)\(\s*'([^']+)'/g;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ method: m[1], path: m[2], at: m.index });
  }
  return out;
};

const adminRouteSrc = fs.readFileSync(
  path.join(API, 'src/modules/reels/routes/reels.admin.route.js'),
  'utf8'
);
const orderedRoutes = extractRouteOrder(adminRouteSrc);

check('reels admin router registers literal paths before :id', () => {
  assert(orderedRoutes.length > 0, 'no routes parsed from reels.admin.route.js');
  const paramId = orderedRoutes.find((r) => r.method === 'get' && r.path === '/:id');
  assert(paramId, 'GET /:id route not found');
  const firstParamAt = paramId.at;
  // Every literal GET path with a single non-param segment must be declared
  // before the first GET /:id, or "lookups"/"reports" would be captured as id.
  const shadowed = orderedRoutes
    .filter((r) => r.method === 'get' && !r.path.includes(':') && r.path !== '/')
    .filter((r) => r.at > firstParamAt)
    .map((r) => `${r.method.toUpperCase()} ${r.path}`);
  assert(
    shadowed.length === 0,
    `declared after GET /:id and unreachable: ${shadowed.join(', ')}`
  );
});

check('/lookups and /reports resolve to their own handlers, not /:id', () => {
  for (const p of ['/lookups', '/reports']) {
    const route = orderedRoutes.find((r) => r.method === 'get' && r.path === p);
    assert(route, `GET ${p} not registered`);
    assert(route.at < orderedRoutes.find((r) => r.path === '/:id').at, `GET ${p} declared after GET /:id`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
