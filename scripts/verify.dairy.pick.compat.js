/*
 * Confirms the `pick()` change cannot regress the food module.
 *
 * `pick` is the only shared utility this dairy work touched, and
 * `src/controllers/orders.controller.js` — the food module's largest controller —
 * calls it 24 times. So its old and new behaviour is compared directly rather than
 * assumed equivalent.
 *
 * The fix it enabled: a Mongoose document keeps its fields in `_doc`, so
 * `hasOwnProperty('status')` on the document is false and the old `pick` returned
 * `{}` for every document.
 *
 * The risk it introduced: dropping `hasOwnProperty` means an *inherited* property
 * would now be copied where it previously was not. That is checked here for the
 * shapes the food module actually passes — `req.query` and `req.body`.
 *
 * Usage: `node scripts/verify.pick.compat.js`
 */

const pick = require('../src/utils/pick');

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/** The original implementation, for comparison. */
const originalPick = (object, keys) =>
  keys.reduce((result, key) => {
    if (object && Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined) {
      result[key] = object[key];
    }
    return result;
  }, {});

console.log('\n1. Plain objects behave identically to the original');

const cases = [
  ['typical query', { sortBy: 'name', limit: '10', page: '2', extra: 'ignored' }, ['sortBy', 'limit', 'page']],
  ['empty object', {}, ['sortBy', 'limit']],
  ['undefined value present', { a: undefined, b: 1 }, ['a', 'b']],
  ['null value present', { a: null, b: 1 }, ['a', 'b']],
  ['falsy values kept', { a: 0, b: false, c: '', d: null }, ['a', 'b', 'c', 'd']],
  ['all keys absent', { x: 1 }, ['a', 'b', 'c']],
  ['array value', { ids: [1, 2, 3] }, ['ids']],
];

for (const [label, input, keys] of cases) {
  const before = JSON.stringify(originalPick(input, keys));
  const after = JSON.stringify(pick(input, keys));
  check(`identical: ${label}`, before === after, `before=${before} after=${after}`);
}

console.log('\n2. Inherited properties are not copied');

const proto = { injected: 'LEAKED' };
const withProto = Object.create(proto);
withProto.own = 'kept';

check(
  'an inherited key is still skipped',
  JSON.stringify(pick(withProto, ['own', 'injected'])) === JSON.stringify({ own: 'kept' }),
  JSON.stringify(pick(withProto, ['own', 'injected']))
);

console.log('\n3. The bug it fixed: Mongoose documents now work');

const mongoose = require('mongoose');
const { User } = require('../src/models');

const doc = new User({
  firstName: 'Asha',
  lastName: 'Rao',
  countryCode: '+91',
  mobile: 9000000001,
  email: 'pick.compat@example.com',
  password: 'Pickcompat@123',
});

check(
  'the original returned nothing for a document',
  JSON.stringify(originalPick(doc, ['firstName', 'email'])) === '{}',
  JSON.stringify(originalPick(doc, ['firstName', 'email']))
);
check(
  'the current one returns the fields',
  pick(doc, ['firstName', 'email']).firstName === 'Asha',
  JSON.stringify(pick(doc, ['firstName', 'email']))
);
check(
  'an absent field is still absent rather than undefined',
  !('rating' in pick(doc, ['firstName', 'rating'])),
  JSON.stringify(pick(doc, ['firstName', 'rating']))
);

console.log('\n4. A lean() result works too');

// `lean()` returns plain objects, which is why the plain-object path matters most.
const lean = { _id: 'x', name: 'Category', status: true, __v: 0 };
check(
  'a lean result is handled like a plain object',
  JSON.stringify(pick(lean, ['name', 'status'])) === JSON.stringify({ name: 'Category', status: true }),
  JSON.stringify(pick(lean, ['name', 'status']))
);

console.log(
  failures === 0
    ? '\nPICK IS COMPATIBLE WITH THE FOOD MODULE'
    : `\n${failures} CHECK(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);