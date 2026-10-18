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
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * BR-18 — the document visibility matrix. No database required.
 *
 * Run:  node scripts/verify.realestate.documents.js
 *
 * ## Why this is a matrix assertion and not a handful of spot checks
 *
 * "Which actor sees which document class" is a 5 × 4 table, and a spot check that
 * "a customer cannot see ADMIN_ONLY" passes whether or not a customer can see
 * BANK_VISIBLE. The failure that matters is a cell that is too permissive — a vendor
 * reading a bank's assessment, or a customer reading a PAN card — and the only way to
 * be sure a cell is right is to assert every cell.
 *
 * So the whole table is asserted, including the cells that must be EMPTY.
 */

const documentAccess = require('../src/modules/realestate/middlewares/realestate.document.access');

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m) => {
  failed++;
  console.log('  FAIL ' + m);
};

const CLASSES = ['INTERNAL', 'CUSTOMER_VISIBLE', 'BANK_VISIBLE', 'ADMIN_ONLY'];
const ACTORS = ['guest', 'customer', 'executive', 'vendor', 'bank', 'admin'];

/**
 * The expected matrix. Read as: this actor MAY read these classes.
 *
 *   guest/customer/executive  CUSTOMER_VISIBLE only
 *   vendor                    their own working papers + what a customer sees
 *   bank                      assessment papers + what a customer sees
 *   admin                     everything
 */
const EXPECTED = {
  guest: ['CUSTOMER_VISIBLE'],
  customer: ['CUSTOMER_VISIBLE'],
  executive: ['CUSTOMER_VISIBLE'],
  vendor: ['INTERNAL', 'CUSTOMER_VISIBLE'],
  bank: ['BANK_VISIBLE', 'CUSTOMER_VISIBLE'],
  admin: ['INTERNAL', 'CUSTOMER_VISIBLE', 'BANK_VISIBLE', 'ADMIN_ONLY'],
};

const run = () => {
  console.log('\n[1] the full actor × class matrix');
  for (const actor of ACTORS) {
    for (const cls of CLASSES) {
      const should = EXPECTED[actor].includes(cls);
      const does = documentAccess.allowedClasses(actor).includes(cls);
      if (should === does) {
        ok(`${actor.padEnd(10)} ${cls.padEnd(17)} ${does ? 'CAN read' : 'cannot read'}`);
      } else {
        bad(
          `${actor.padEnd(10)} ${cls.padEnd(17)} expected ${should ? 'CAN' : 'cannot'} read, got ${does ? 'CAN' : 'cannot'}`
        );
      }
    }
  }

  console.log('\n[2] the four cells a leak would come from, named explicitly');
  {
    const cases = [
      ['customer', 'INTERNAL', false, 'a customer must not read a vendor working paper'],
      ['customer', 'BANK_VISIBLE', false, 'a customer must not read a bank assessment'],
      ['customer', 'ADMIN_ONLY', false, 'a customer must not read reviewer material'],
      ['executive', 'ADMIN_ONLY', false, 'a field agent is not a reviewer'],
      ['vendor', 'BANK_VISIBLE', false, 'a vendor must not read a bank assessment'],
      ['vendor', 'ADMIN_ONLY', false, 'a vendor must not read reviewer material'],
      ['bank', 'ADMIN_ONLY', false, 'a bank is an external party, not an admin'],
      ['bank', 'INTERNAL', false, 'a bank must not read a vendor working paper'],
    ];
    cases.forEach(([actor, cls, expected, why]) => {
      const does = documentAccess.allowedClasses(actor).includes(cls);
      if (does === expected) ok(`${actor} ✗ ${cls} — ${why}`);
      else bad(`LEAK: ${actor} CAN read ${cls} — ${why}`);
    });
  }

  console.log('\n[3] an unknown role gets the NARROWEST set, not the widest');
  {
    const forUnknown = documentAccess.allowedClasses('cityMaster');
    if (JSON.stringify(forUnknown) === JSON.stringify(['CUSTOMER_VISIBLE'])) {
      ok('an unrecognised role resolves to CUSTOMER_VISIBLE only');
    } else {
      bad('an unrecognised role resolved to ' + JSON.stringify(forUnknown));
    }
    const noUser = documentAccess.actorTypeOf({});
    if (noUser === 'guest') ok('a request with no user resolves to guest');
    else bad('no-user resolved to ' + noUser);
    const nullReq = documentAccess.actorTypeOf(null);
    if (nullReq === 'guest') ok('a null request resolves to guest rather than throwing');
    else bad('null request resolved to ' + nullReq);
  }

  console.log('\n[4] buildQuery scopes by class AND property');
  {
    const q = documentAccess.buildQuery('customer', 'PROP1');
    if (
      JSON.stringify(q.visibility) === JSON.stringify({ $in: ['CUSTOMER_VISIBLE'] }) &&
      q.property === 'PROP1'
    ) {
      ok('customer query = { property, visibility: { $in: [CUSTOMER_VISIBLE] } }');
    } else bad('customer query = ' + JSON.stringify(q));

    const qNoProp = documentAccess.buildQuery('admin');
    if (qNoProp.property === undefined && qNoProp.visibility.$in.length === 4) {
      ok('admin query with no property scopes by class only');
    } else bad('admin query = ' + JSON.stringify(qNoProp));

    const vendorQuery = documentAccess.buildQuery('vendor', 'P');
    if (
      vendorQuery.visibility.$in.includes('INTERNAL') &&
      !vendorQuery.visibility.$in.includes('ADMIN_ONLY')
    ) {
      ok('vendor query includes INTERNAL but not ADMIN_ONLY');
    } else bad('vendor query = ' + JSON.stringify(vendorQuery));
  }

  console.log('\n[5] redact strips the file for actors who may not download');
  {
    const doc = {
      _id: 'D1',
      title: 'Sale Deed',
      fileUrl: 'https://cdn.example.com/deed.pdf',
      fileName: 'deed.pdf',
      checksum: 'abc123',
      category: 'OWNERSHIP',
      visibility: 'CUSTOMER_VISIBLE',
      rejectionReason: 'blurry scan',
      verifiedBy: 'USER1',
    };

    ['guest', 'customer', 'executive'].forEach((actor) => {
      const r = documentAccess.redact(doc, actor);
      const leaked = ['fileUrl', 'fileName', 'checksum'].filter((k) => k in r);
      if (!leaked.length) ok(`${actor.padEnd(10)} receives no fileUrl/fileName/checksum`);
      else bad(`${actor} received ${leaked.join(', ')}`);
    });

    ['vendor', 'bank', 'admin'].forEach((actor) => {
      const r = documentAccess.redact(doc, actor);
      if (r.fileUrl === doc.fileUrl)
        ok(`${actor.padEnd(10)} does receive fileUrl (scoped by ownership downstream)`);
      else bad(`${actor} lost fileUrl`);
    });

    const cust = documentAccess.redact(doc, 'customer');
    if (!('rejectionReason' in cust) && !('verifiedBy' in cust)) {
      ok('a customer does not receive reviewer working notes');
    } else bad('a customer received reviewer notes');
    if (cust.title === doc.title && cust.category === doc.category) {
      ok('non-sensitive fields survive the redaction');
    } else bad('redaction removed too much');
  }

  console.log('\n[6] redact does not mutate its input');
  {
    const doc = { title: 't', fileUrl: 'u', fileName: 'f', checksum: 'c' };
    const copy = { ...doc };
    documentAccess.redact(doc, 'customer');
    if (JSON.stringify(doc) === JSON.stringify(copy)) ok('the source document is unchanged');
    else bad('redact mutated its input — the same doc reused elsewhere would be silently stripped');
  }

  console.log('\n[7] assertReadable returns 404, never 403');
  {
    const req = {
      documentAccess: {
        actorType: 'customer',
        allowedClasses: documentAccess.allowedClasses('customer'),
      },
    };
    const visible = { visibility: 'CUSTOMER_VISIBLE' };
    const hidden = { visibility: 'ADMIN_ONLY' };

    try {
      documentAccess.assertReadable(visible, req);
      ok('a readable document passes');
    } catch (e) {
      bad('a readable document was rejected: ' + e.message);
    }

    try {
      documentAccess.assertReadable(hidden, req);
      bad('an unreadable document was accepted');
    } catch (e) {
      // 404, not 403 — a 403 confirms the document exists, which is itself a disclosure.
      if (e.statusCode === 404)
        ok('an unreadable document yields 404, not 403 (existence is not disclosed)');
      else bad('unreadable yielded status ' + e.statusCode);
    }

    try {
      documentAccess.assertReadable(null, req);
      bad('a null document was accepted');
    } catch (e) {
      if (e.statusCode === 404) ok('a missing document yields 404');
      else bad('null yielded status ' + e.statusCode);
    }
  }

  console.log('\n[8] the express middleware attaches a per-request decision');
  {
    const mkReq = (role) => ({ user: role ? { role } : undefined });
    const actors = [
      [undefined, 'guest'],
      ['user', 'guest'],
      ['vendor', 'vendor'],
      ['bank', 'bank'],
      ['admin', 'admin'],
    ];
    actors.forEach(([role, expected]) => {
      const req = mkReq(role);
      documentAccess.attach()(req, {}, () => {});
      if (req.documentAccess && req.documentAccess.actorType === expected) {
        ok(`role ${String(role).padEnd(8)} -> actorType ${expected}`);
      } else {
        bad(`role ${role} -> ${req.documentAccess && req.documentAccess.actorType}`);
      }
    });

    const req = mkReq('customer');
    documentAccess.attach()(req, {}, () => {});
    if (
      typeof req.documentAccess.buildQuery === 'function' &&
      typeof req.documentAccess.redact === 'function'
    ) {
      ok('the attached helper carries buildQuery and redact already bound to the actor');
    } else bad('the attached helper is missing bound helpers');
  }

  console.log(
    '\n' + (failed === 0 ? 'ALL DOCUMENT ACCESS CHECKS PASSED' : failed + ' CHECK(S) FAILED')
  );
  process.exit(failed === 0 ? 0 : 1);
};

run();
