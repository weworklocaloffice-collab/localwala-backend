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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.invoice.js — BR-43: invoice numbers are server-controlled, per outlet, gapless.
 *
 * Run: node scripts/verify.stores.invoice.js
 *
 * ## What this pins
 *
 *   - format `{prefix}/{financialYear}/{sequence}`, zero-padded to six
 *   - the sequence is per-outlet: two outlets never share a counter
 *   - N parallel issues yield N DISTINCT numbers — the counter is the lock (single
 *     atomic $inc, no read-then-write), so concurrency cannot duplicate
 *   - the counter does NOT reset on April 1st; the financial year is part of the number
 *     and uniqueness holds either way
 *   - a missing outlet is a 404, not a number from nowhere
 *   - once set, the stored prefix wins over a later outletCode change, so renames never
 *     fork the series mid-year
 *
 * ## The honest limit, asserted as documentation
 *
 * The $inc and the order write are two separate writes (standalone mongod, no transactions).
 * A crash between them can SKIP a number. Skips are auditable — every issued number lives
 * on its order — and duplicates are impossible plus a sparse unique index. This suite
 * proves no-duplicates under concurrency; it does not (and cannot) prove no-skips under
 * crash, because that would require killing the process mid-write.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const invoiceService = require('../src/modules/stores/services/stores.invoice.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.outlet.model');

const StoreOutlet = mongoose.model('StoreOutlet');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const CHAIN = new mongoose.Types.ObjectId();
const STAMP = Date.now();

// Every outlet this run creates, so cleanup deletes by _id. Matching on outletCode would
// miss the `bare` fixture below, which deliberately unsets its code to prove the STORE
// fallback — a row with no code matches no code filter and would leak across runs.
const createdOutletIds = [];

const makeOutlet = async (code) => {
  const outlet = await StoreOutlet.create({
    chain: CHAIN,
    outletCode: code,
    name: 'invoice suite ' + code,
  });
  createdOutletIds.push(outlet._id);
  return outlet;
};

const cleanup = async () => {
  await StoreOutlet.deleteMany({ _id: { $in: createdOutletIds } });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== format and monotonicity ===\n');

  const outlet = await makeOutlet('INV-' + STAMP);

  const first = await invoiceService.issueInvoiceNumber(outlet._id);
  ck('the number has three slash-separated parts', first.invoiceNo.split('/').length === 3, first.invoiceNo);
  ck('the sequence is zero-padded to six', /\/\d{6}$/.test(first.invoiceNo), first.invoiceNo);
  ck('the prefix comes from the outlet code', first.invoiceNo.startsWith('INV-' + STAMP + '/'), first.invoiceNo);
  ck('the first issue is sequence 1', first.sequence === 1, `sequence=${first.sequence}`);

  const second = await invoiceService.issueInvoiceNumber(outlet._id);
  ck('the second issue is sequence 2', second.sequence === 2, `sequence=${second.sequence}`);
  ck('the two numbers differ', second.invoiceNo !== first.invoiceNo);

  console.log('\n=== per-outlet series are independent ===\n');

  const other = await makeOutlet('INV2-' + STAMP);
  const otherFirst = await invoiceService.issueInvoiceNumber(other._id);
  ck('a second outlet starts at its own sequence 1', otherFirst.sequence === 1, `sequence=${otherFirst.sequence}`);
  ck('the two outlets carry different prefixes', otherFirst.prefix !== first.prefix);
  const third = await invoiceService.issueInvoiceNumber(outlet._id);
  ck('the first outlet continues its own series at 3', third.sequence === 3, `sequence=${third.sequence}`);

  console.log('\n=== concurrency: N parallel issues, N distinct numbers ===\n');

  const N = 50;
  const issued = await Promise.all(
    Array.from({ length: N }, () => invoiceService.issueInvoiceNumber(outlet._id))
  );
  const numbers = issued.map((r) => r.invoiceNo);
  ck('all N numbers are distinct', new Set(numbers).size === N, `distinct=${new Set(numbers).size} of ${N}`);
  const seqs = issued.map((r) => r.sequence).sort((a, b) => a - b);
  ck('the sequences advance by exactly N with no gaps in the batch',
    seqs[seqs.length - 1] - seqs[0] === N - 1 && new Set(seqs).size === N,
    `first=${seqs[0]} last=${seqs[seqs.length - 1]}`);
  const after = await StoreOutlet.findById(outlet._id).select('invoiceSeries.lastSequence').lean();
  ck('the stored counter advanced by N', after.invoiceSeries.lastSequence === 3 + N,
    `lastSequence=${after.invoiceSeries.lastSequence}`);

  console.log('\n=== the financial year boundary ===\n');

  const fyOutlet = await makeOutlet('INV3-' + STAMP);
  const march = new Date(2026, 2, 31);
  const april = new Date(2026, 3, 1);
  const jan = new Date(2026, 0, 15);
  const oct = new Date(2026, 9, 13);

  const m = await invoiceService.issueInvoiceNumber(fyOutlet._id, { atDate: march });
  const a = await invoiceService.issueInvoiceNumber(fyOutlet._id, { atDate: april });
  const j = await invoiceService.issueInvoiceNumber(fyOutlet._id, { atDate: jan });
  const o = await invoiceService.issueInvoiceNumber(fyOutlet._id, { atDate: oct });
  ck('March 2026 is FY 2025-26 (Indian FY starts April)', m.financialYear === '2025-26', m.financialYear);
  ck('April 2026 is FY 2026-27', a.financialYear === '2026-27', a.financialYear);
  ck('January 2026 is FY 2025-26', j.financialYear === '2025-26', j.financialYear);
  ck('October 2026 is FY 2026-27', o.financialYear === '2026-27', o.financialYear);
  ck('the sequence does NOT reset across the year boundary',
    m.sequence === 1 && a.sequence === 2 && j.sequence === 3 && o.sequence === 4,
    `seqs=${[m.sequence, a.sequence, j.sequence, o.sequence].join(',')}`);
  ck('numbers from different years still differ', m.invoiceNo !== a.invoiceNo);

  console.log('\n=== prefix persistence ===\n');

  const renameOutlet = await makeOutlet('INV4-' + STAMP);
  await invoiceService.issueInvoiceNumber(renameOutlet._id);
  await StoreOutlet.updateOne({ _id: renameOutlet._id }, { outletCode: 'RENAMED-' + STAMP });
  const afterRename = await invoiceService.issueInvoiceNumber(renameOutlet._id);
  ck('a later outletCode change does not fork the series', afterRename.prefix === 'INV4-' + STAMP, afterRename.prefix);
  ck('the renamed series continues its sequence', afterRename.sequence === 2, `sequence=${afterRename.sequence}`);

  const bare = await StoreOutlet.create({ chain: CHAIN, outletCode: 'INV5-' + STAMP, name: 'bare' });
  createdOutletIds.push(bare._id);
  await StoreOutlet.updateOne({ _id: bare._id }, { $unset: { outletCode: 1 } });
  const fallback = await invoiceService.issueInvoiceNumber(bare._id);
  ck('an outlet with no code at all falls back to STORE', fallback.prefix === 'STORE', fallback.prefix);

  console.log('\n=== a missing outlet is a 404 ===\n');

  let missing = false;
  try {
    await invoiceService.issueInvoiceNumber(new mongoose.Types.ObjectId());
  } catch (e) {
    missing = e.statusCode === 404 && /OUTLET_NOT_FOUND/.test(e.message);
  }
  ck('issuing for a missing outlet is a 404, not a number from nowhere', missing);
};

run()
  .catch((e) => {
    failures += 1;
    console.log('\nSUITE ERROR: ' + (e && e.stack ? e.stack : e));
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      /* the run already failed; cleanup errors must not mask it */
    }
    await mongoose.disconnect();
    console.log('\n' + (failures === 0 ? 'ALL STORES INVOICE CHECKS PASSED' : failures + ' STORES INVOICE CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });