/**
 * Checks that the committed Postman collection matches the route file.
 *
 * ## Why this exists
 *
 * `build.dairy.postman.js` regenerates the `Dairy Routes` folder from
 * `dairy.route.js`. Without a check, the collection quietly rots: nobody
 * re-runs a generator on a schedule, so a route added last week is simply absent
 * from the folder people actually click through, and the first person to notice
 * is the one trying to use it.
 *
 * This runs the same derivation and compares. It never writes, so it is safe to
 * put in the suite.
 *
 * ## What it does not check
 *
 * That the requests *work*. A collection can be perfectly current and still
 * 404 if a variable is unfilled. That is what `verify.dairy.http.js` is for.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const builder = path.join(__dirname, 'build.dairy.postman.js');

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('\n1. Postman collection matches the routes');

try {
  const out = execFileSync(process.execPath, [builder, '--check'], { encoding: 'utf8' });
  check('the committed collection is what the route file produces', true, out.trim());
} catch (error) {
  check(
    'the committed collection is what the route file produces',
    false,
    'stale — run `node scripts/build.dairy.postman.js`'
  );
}

// A current collection is still worthless if it lost the folder, or the folder
// lost its requests, so assert the shape too.
const fs = require('fs');

try {
  const collection = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'Resource', 'postman_collection.json'), 'utf8')
  );

  const dairy = (collection.item || []).find((folder) => folder.name === 'Dairy Routes');

  check('the collection has a Dairy Routes folder', Boolean(dairy));

  const count = dairy ? dairy.item.reduce((sum, f) => sum + f.item.length, 0) : 0;
  check('the folder carries a request per route', count >= 150, `${count} requests`);

  // Every partner request must carry the token-scoped note. If that note ever
  // disappears, the folder is quietly telling people to pass an outlet id.
  const partner = dairy ? dairy.item.find((f) => f.name.startsWith('Partner')) : null;
  const withoutNote = partner
    ? partner.item.filter((r) => !String(r.request.description || '').includes('decides which outlet'))
    : [];
  check(
    'every partner request explains the outlet comes from the token',
    partner && withoutNote.length === 0,
    `${withoutNote.length} without it`
  );

  // A literal money or quantity value would be a real transaction if sent.
  const badLiterals = [];
  (dairy ? dairy.item : []).forEach((folder) =>
    folder.item.forEach((r) => {
      const raw = r.request.body && r.request.body.raw;
      if (!raw) return;
      const body = JSON.parse(raw);
      Object.keys(body).forEach((key) => {
        if (
          typeof body[key] === 'number'
          && /amount|quantity|price|rate|balance|mobile|qty/i.test(key)
        ) {
          badLiterals.push(`${r.name} -> ${key}: ${body[key]}`);
        }
      });
    })
  );
  check(
    'no request carries a literal money or quantity value',
    badLiterals.length === 0,
    badLiterals.slice(0, 3).join(' | ')
  );
} catch (error) {
  check('the collection is readable', false, error.message);
}

console.log(
  failures === 0 ? '\nALL POSTMAN COLLECTION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`
);

process.exit(failures === 0 ? 0 : 1);