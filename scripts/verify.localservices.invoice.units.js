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
 * verify.localservices.invoice.units.js — GST invoice numbering and splits.
 * Run: node scripts/verify.localservices.invoice.units.js
 */

const invoice = require('../src/modules/local-services/services/localservice.invoice.service');
const invoicePdf = require('../src/modules/local-services/services/localservice.invoice.pdf.service');
const bookingService = require('../src/modules/local-services/services/localservice.booking.service');
const { invoiceTotal } = require('../src/modules/local-services/models/localservice.fulfilment.model');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const booking = {
  _id: 'b1',
  provider: 'p1',
  taxAmount: 180,
  labourAmount: 1000,
  partsAmount: 0,
  items: [
    { kind: 'service', label: 'Labour', lineTotal: 1000 },
    { kind: 'tax', label: 'GST 18%', lineTotal: 180 },
  ],
  addressSnapshot: { name: 'Asha', address: 'MG Road', stateCode: '27' },
};

const provider = {
  _id: 'p1',
  businessName: 'FixIt Services',
  businessAddress: 'Industrial Area',
  gstin: '27AAPFU0939F1ZV',
};

const counter = () => {
  let seq = 0;
  return () => {
    seq += 1;
    return { seq };
  };
};

const run = async () => {
  ok('March belongs to the previous financial year', invoice.financialYear(new Date('2026-03-31T00:00:00Z')) === '2025-26');
  ok('April starts the next financial year', invoice.financialYear(new Date('2026-04-01T00:00:00Z')) === '2026-27');
  ok('GSTIN prefix is the state code', invoice.stateCodeOf('27AAPFU0939F1ZV') === '27');
  ok('a non-numeric state has no GST code', invoice.stateCodeOf('Karnataka') === '');

  const snapshot = bookingService.buildAddressSnapshot({
    receiverName: 'Asha',
    receiverContact: '9876543210',
    flatHouse: '12 MG Road',
    locality: 'Indiranagar',
    pincode: '560038',
    state: 'Karnataka',
    stateCode: '29',
    gstin: '29aapfu0939f1zv',
  });
  ok('address snapshot freezes the receiver', snapshot.name === 'Asha' && snapshot.phone === '9876543210');
  ok('address snapshot joins the address line', snapshot.address === '12 MG Road, Indiranagar, 560038');
  ok('address snapshot keeps the GST state code', snapshot.stateCode === '29');
  ok('address snapshot normalises the GSTIN', snapshot.gstin === '29AAPFU0939F1ZV');
  ok('missing state code falls back to the GSTIN prefix', bookingService.buildAddressSnapshot({ gstin: '27AAPFU0939F1ZV' }).stateCode === '27');
  ok('numeric state is a last-resort state code', bookingService.buildAddressSnapshot({ state: '24' }).stateCode === '24');
  ok('no address means no snapshot', bookingService.buildAddressSnapshot(null) === undefined);

  const next = counter();
  const CounterModel = { findOneAndUpdate: async () => next() };
  const firstNo = await invoice.nextInvoiceNo(new Date('2026-06-01T00:00:00Z'), { CounterModel });
  const secondNo = await invoice.nextInvoiceNo(new Date('2026-06-02T00:00:00Z'), { CounterModel });
  ok('invoice numbers carry the financial year', firstNo === 'LS/2026-27/000001');
  ok('invoice numbers are consecutive', secondNo === 'LS/2026-27/000002');

  const intra = invoice.buildInvoicePayload({ booking, provider, invoiceNo: firstNo, at: new Date('2026-06-01T00:00:00Z') });
  ok('taxable value excludes tax', intra.taxableValue === 1000);
  ok('tax total is the frozen tax', intra.taxTotal === 180);
  ok('total includes tax', intra.total === 1180);
  ok('derived tax rate is 18%', intra.taxPercent === 18);
  ok('intra-state splits CGST', intra.cgst === 90);
  ok('intra-state splits SGST', intra.sgst === 90);
  ok('intra-state has no IGST', intra.igst === 0);
  ok('intra-state is flagged', intra.isInterState === false);
  ok('place of supply is the customer state', intra.placeOfSupply === '27');
  ok('sac code defaults to 9987', intra.sacCode === '9987');
  ok('seller snapshot carries GSTIN', intra.seller.gstin === '27AAPFU0939F1ZV');
  ok('buyer snapshot carries the name', intra.buyer.name === 'Asha');

  const inter = invoice.buildInvoicePayload({
    booking: { ...booking, addressSnapshot: { ...booking.addressSnapshot, stateCode: '29' } },
    provider,
    invoiceNo: secondNo,
    at: new Date('2026-06-01T00:00:00Z'),
  });
  ok('inter-state is flagged', inter.isInterState === true);
  ok('inter-state charges IGST', inter.igst === 180);
  ok('inter-state has no CGST', inter.cgst === 0);
  ok('inter-state has no SGST', inter.sgst === 0);
  ok('inter-state place of supply is the customer state', inter.placeOfSupply === '29');

  const fallback = invoice.buildInvoicePayload({
    booking: { _id: 'b2', provider: 'p1', labourAmount: 500, partsAmount: 200, taxAmount: 0 },
    provider,
    invoiceNo: 'LS/2026-27/000003',
  });
  ok('fallback lines use labour and parts', fallback.lines.length === 2 && fallback.lines[1].amount === 200);
  ok('fallback taxable value is the sum', fallback.taxableValue === 700);
  ok('no tax means no split', fallback.cgst === 0 && fallback.igst === 0);
  ok('invoiceTotal still sums lines', invoiceTotal([{ amount: 100.5 }, { amount: 20 }]) === 120.5);

  let existingFetched = false;
  const existing = { _id: 'inv1', booking: 'b1', status: 'issued' };
  const deduped = await invoice.issueInvoiceForBooking({
    bookingId: 'b1',
    InvoiceModel: { findOne: async () => existing },
    BookingModel: { findById: async () => ((existingFetched = true), booking) },
    ProviderModel: { findById: async () => provider },
    CounterModel: { findOneAndUpdate: async () => ({ seq: 4 }) },
  });
  ok('existing invoice is reused', deduped.invoice === existing);
  ok('existing invoice is reported deduped', deduped.deduped === true);
  ok('existing invoice avoids a booking read', existingFetched === false);

  const created = [];
  const issued = await invoice.issueInvoiceForBooking({
    bookingId: 'b1',
    InvoiceModel: {
      findOne: async () => null,
      create: async (payload) => {
        created.push(payload);
        return { _id: 'inv2', ...payload, async save() { return this; } };
      },
    },
    BookingModel: { findById: async () => booking },
    ProviderModel: { findById: async () => provider },
    CounterModel: { findOneAndUpdate: async () => ({ seq: 5 }) },
  });
  ok('new invoice is issued', issued.deduped === false && issued.invoice.invoiceNo === 'LS/2026-27/000005');
  ok('new invoice snapshots the seller', created[0].seller.name === 'FixIt Services');
  ok('new invoice records the booking', created[0].booking === 'b1');

  const raced = { _id: 'inv3', booking: 'b1', status: 'issued' };
  let findOneCalls = 0;
  const race = await invoice.issueInvoiceForBooking({
    bookingId: 'b1',
    InvoiceModel: {
      findOne: async () => (findOneCalls += 1) > 1 ? raced : null,
      create: async () => {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      },
    },
    BookingModel: { findById: async () => booking },
    ProviderModel: { findById: async () => provider },
    CounterModel: { findOneAndUpdate: async () => ({ seq: 6 }) },
  });
  ok('duplicate booking invoice is deduped', race.deduped === true && race.invoice === raced);

  const voidTarget = {
    status: 'issued',
    voidedAt: null,
    async save() { return this; },
  };
  const voided = await invoice.voidInvoiceForBooking({
    bookingId: 'b1',
    at: new Date('2026-07-01T00:00:00Z'),
    InvoiceModel: { findOne: async () => voidTarget },
  });
  ok('void marks the invoice', voided.status === 'void');
  ok('void records when it happened', voided.voidedAt instanceof Date);

  const printable = invoice.buildInvoicePayload({
    booking,
    provider,
    invoiceNo: 'LS/2026-27/000006',
    at: new Date('2026-06-01T00:00:00Z'),
  });
  const html = invoicePdf.renderInvoiceHtml(printable);
  ok('print view shows the invoice number', html.includes('LS/2026-27/000006'));
  ok('print view shows the GSTIN', html.includes('27AAPFU0939F1ZV'));
  ok('print view shows both GST components', html.includes('CGST') && html.includes('SGST'));
  ok('print view renders the rupee total', html.includes('&#8377; 1,180.00'));

  const escaped = invoicePdf.renderInvoiceHtml({ ...printable, seller: { ...printable.seller, name: '<script>x</script>' } });
  ok('print view escapes party names', escaped.includes('&lt;script&gt;x&lt;/script&gt;') && !escaped.includes('<script>x</script>'));

  console.log(failures === 0 ? '\nAll local-services invoice units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
