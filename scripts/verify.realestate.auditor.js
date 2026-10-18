/**
 * LocalWala – Real Estate auditor isolation gate (Phase A).
 *
 * Asserts three things statically:
 *  1. `auth.factory.js` uses OR semantics (`.some()`), so a route citing
 *     `(areaRight, audit_view)` admits either — without this, the auditor
 *     below would be locked out of every read.
 *  2. Every GET route in `realestate.admin.route.js` admits
 *     `audit_view`, and NO write route (post/patch/put/delete) does.
 *     The auditor is read-only by construction, not convention.
 *  3. The `auditor` role holds exactly `uploadImage` + `audit_view`
 *     (nothing that any write route cites), and `financeApprover`
 *     holds the approve right but neither draft/edit (`manage`) nor
 *     `activate`.
 *
 * Run: node scripts/verify.realestate.auditor.js
 */

const fs = require('fs');
const path = require('path');

const API = path.resolve(__dirname, '..');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};

const { roleRights } = require(path.join(API, 'src/config/roles.js'));

// [1] OR semantics in the factory.
try {
  const factory = fs.readFileSync(path.join(API, 'src/middlewares/auth.factory.js'), 'utf8');
  if (!/requiredRights\.some\(/.test(factory)) throw new Error('factory does not use .some()');
  if (/requiredRights\.every\(/.test(factory)) throw new Error('factory still uses .every()');
  ok('auth.factory.js grants on ANY listed right (.some())');
} catch (e) {
  bad('auth factory OR semantics', e.message);
}

// [2] Route coverage — group physical lines into route statements: a
// statement starts at a `router.<verb>(` line and ends at the first
// line ending with `);`.
try {
  const src = fs.readFileSync(
    path.join(API, 'src/modules/realestate/routes/realestate.admin.route.js'),
    'utf8'
  );
  const blocks = [];
  let current = null;
  for (const line of src.split('\n')) {
    const m = line.match(/^\s*router\.(get|post|patch|put|delete)\(/);
    if (m) {
      if (current) blocks.push(current);
      current = { verb: m[1], text: line };
    } else if (current) {
      current.text += '\n' + line;
    }
    if (current && /^\s*\);/.test(line)) {
      blocks.push(current);
      current = null;
    }
  }
  const gets = blocks.filter((b) => b.verb === 'get');
  const writes = blocks.filter((b) => b.verb !== 'get');
  const withAudit = (b) => /AUDIT_VIEW|audit_view/.test(b.text);
  const missingReads = gets.filter((b) => !withAudit(b));
  const leakingWrites = writes.filter(withAudit);
  if (missingReads.length) {
    throw new Error(
      missingReads.length +
        ' GET route(s) without audit_view: ' +
        missingReads
          .map((b) => (b.text.match(/'(\/[^']*)'/) || [])[1])
          .filter(Boolean)
          .join(', ')
    );
  }
  ok(`all ${gets.length} GET routes admit audit_view`);
  if (leakingWrites.length) throw new Error(leakingWrites.length + ' write route(s) admit audit_view');
  ok(`all ${writes.length} write routes exclude audit_view`);
} catch (e) {
  bad('route read/write split', e.message);
}

// [3] Role contents.
try {
  const auditor = roleRights.get('auditor') || [];
  const want = ['uploadImage', 'realestate.audit_view'];
  const same =
    auditor.length === want.length && want.every((r) => auditor.includes(r));
  if (!same) throw new Error('auditor holds: ' + auditor.join(','));
  ok('auditor holds exactly uploadImage + audit_view');

  const approver = roleRights.get('financeApprover') || [];
  if (!approver.includes('realestate.admin_hold_policy_approve')) {
    throw new Error('financeApprover lacks the approve right');
  }
  const forbidden = approver.filter((r) =>
    ['realestate.admin_hold_policy_manage', 'realestate.admin_hold_policy_activate'].includes(r)
  );
  if (forbidden.length) throw new Error('financeApprover can draft/edit/activate: ' + forbidden.join(','));
  ok('financeApprover approves but cannot draft/edit/activate');
} catch (e) {
  bad('role contents', e.message);
}

if (failed) {
  console.log(`\n${failed} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL AUDITOR CHECKS PASSED');
