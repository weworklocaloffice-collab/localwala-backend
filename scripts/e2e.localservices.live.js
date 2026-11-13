/**
 * LocalWala — Local Services live-Mongo end-to-end check.
 *
 * Exercises the invoice and entitlement paths against a REAL MongoDB database
 * instead of mocks:
 *   - provider + customer + booking persisted through Mongoose
 *   - GST invoice issued once, deduplicated on replay, numbered consecutively
 *   - inter-state split (Telangana seller / Karnataka buyer) -> IGST
 *   - Playwright renders the invoice HTML to a real PDF buffer
 *   - soft entitlement: no subscription allows, active plan without a token
 *     blocks, active plan with the token (case-insensitive) allows
 *
 * Safety: only runs against a database whose name contains "e2e" or "test".
 * The default is a throwaway database on local MongoDB; it is dropped before
 * and after the run. Set LS_E2E_MONGO_URL to use a disposable test cluster.
 *
 * Run: node scripts/e2e.localservices.live.js
 */

const mongoose = require('mongoose');

const DEFAULT_DB = `localservices_e2e_${Date.now()}`;
const URI =
  process.env.LS_E2E_MONGO_URL ||
  `mongodb://127.0.0.1:27017/${DEFAULT_DB}?replicaSet=rs0`;

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const databaseName = () => {
  const withoutQuery = URI.split('?')[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
};

const seed = async () => {
  const User = require('../src/models/user.model');
  const Provider = require('../src/modules/local-services/models/localservice.provider.model');
  const Booking = require('../src/modules/local-services/models/localservice.booking.model');

  const [customer, owner] = await User.create([
    {
      firstName: 'E2E',
      lastName: 'Customer',
      email: `e2e.customer.${Date.now()}@example.test`,
      password: 'Passw0rd1',
      countryCode: 91,
      mobile: `90000${String(Date.now()).slice(-5)}`,
    },
    {
      firstName: 'E2E',
      lastName: 'Provider',
      email: `e2e.provider.${Date.now()}@example.test`,
      password: 'Passw0rd1',
      countryCode: 91,
      mobile: `91000${String(Date.now()).slice(-5)}`,
    },
  ]);

  const provider = await Provider.create({
    owner: owner._id,
    businessName: 'E2E FixIt Services',
    businessAddress: 'Industrial Area, Hyderabad',
    gstin: '36ABCDE1234F1Z5',
    stateCode: '36',
    status: 'ACTIVE',
    bookable: true,
  });

  const otherProvider = await Provider.create({
    owner: customer._id,
    businessName: 'E2E Other Services',
    status: 'ACTIVE',
    bookable: true,
  });

  const booking = await Booking.create({
    bookingCode: `LSE2E${String(Date.now()).slice(-6)}`,
    customer: customer._id,
    provider: provider._id,
    bookingMode: 'INSTANT',
    status: 'COMPLETED',
    paymentMode: 'gateway',
    paymentStatus: 'paid',
    labourAmount: 1000,
    partsAmount: 0,
    taxAmount: 180,
    items: [
      { kind: 'service', label: 'Labour', quantity: 1, unitPrice: 1000, lineTotal: 1000 },
      { kind: 'tax', label: 'GST 18%', quantity: 1, unitPrice: 180, lineTotal: 180 },
    ],
    addressSnapshot: {
      name: 'E2E Customer',
      address: 'MG Road, Bengaluru',
      stateCode: '29',
    },
  });

  return { customer, owner, provider, booking };
};

const checkInvoice = async (booking) => {
  const invoiceService = require('../src/modules/local-services/services/localservice.invoice.service');
  const invoicePdf = require('../src/modules/local-services/services/localservice.invoice.pdf.service');
  const { LocalServiceInvoiceCounter } = require('../src/modules/local-services/models/localservice.fulfilment.model');

  const first = await invoiceService.issueInvoiceForBooking({ bookingId: booking._id });
  const replay = await invoiceService.issueInvoiceForBooking({ bookingId: booking._id });

  ok('invoice issued on first call', first.deduped === false);
  ok('replay is deduplicated', replay.deduped === true);
  ok('replay returns the same invoice', String(replay.invoice._id) === String(first.invoice._id));
  ok('invoice number is generated', /^LS\/\d{4}-\d{2}\/000001$/.test(first.invoice.invoiceNo || ''), first.invoice.invoiceNo);

  const invoice = first.invoice.toObject({ getters: true });
  ok('seller state is Telangana (36)', invoice.seller.stateCode === '36');
  ok('buyer state is Karnataka (29)', invoice.buyer.stateCode === '29');
  ok('place of supply is the buyer state', invoice.placeOfSupply === '29');
  ok('inter-state invoice is flagged', invoice.isInterState === true);
  ok('inter-state uses IGST', invoice.igst === 180 && invoice.cgst === 0 && invoice.sgst === 0);
  ok('total includes tax', invoice.total === 1180);

  const counter = await LocalServiceInvoiceCounter.findOne({ fy: invoice.invoiceNo.split('/')[1] });
  ok('counter advanced once', counter && counter.seq === 1);

  const pdf = await invoicePdf.renderInvoicePdf(invoice);
  ok('PDF is a buffer', Buffer.isBuffer(pdf));
  ok('PDF has a %PDF header', Buffer.isBuffer(pdf) && pdf.slice(0, 4).toString() === '%PDF');
  ok('PDF is non-trivial', Buffer.isBuffer(pdf) && pdf.length > 1000, Buffer.isBuffer(pdf) ? `${pdf.length} bytes` : 'not a buffer');

  return invoice;
};

const callPartnerInvoice = (userId, bookingId) =>
  new Promise((resolve) => {
    const controller = require('../src/modules/local-services/controllers/ls.booking.controller');
    const headers = {};
    const res = {
      setHeader: (key, value) => {
        headers[key] = value;
      },
      status: (code) => {
        res.statusCode = code;
        return res;
      },
      send: (payload) => resolve({ statusCode: res.statusCode, headers, payload }),
    };
    const next = (error) => resolve({ error });
    controller.partnerInvoicePdf({ user: { _id: userId }, params: { id: String(bookingId) } }, res, next);
  });

const checkPartnerInvoice = async (booking, owner, customer) => {
  const own = await callPartnerInvoice(owner._id, booking._id);
  ok('partner can download their own invoice PDF', Buffer.isBuffer(own.payload) && own.payload.slice(0, 4).toString() === '%PDF');
  ok('partner download is an attachment', /attachment; filename=".+\.pdf"/.test(own.headers['Content-Disposition'] || ''));

  const foreign = await callPartnerInvoice(customer._id, booking._id);
  ok('partner cannot download another provider invoice', foreign.error && foreign.error.statusCode === 403);
};

const checkEntitlements = async (owner, provider) => {
  const entitlement = require('../src/modules/local-services/services/localservice.entitlement.service');
  const {
    LocalServiceSubscriptionPlan,
    LocalServiceSubscription,
  } = require('../src/modules/local-services/models/localservice.growth.model');

  ok('no active subscription allows (soft gate)', (await entitlement.providerHasEntitlement(owner._id, 'marketing')) === true);

  const plan = await LocalServiceSubscriptionPlan.create({
    code: `E2E${String(Date.now()).slice(-6)}`,
    name: 'E2E bookings only',
    price: 0,
    interval: 'monthly',
    entitlements: ['bookings'],
    status: 'active',
  });

  const subscription = await LocalServiceSubscription.create({
    provider: provider._id,
    plan: plan._id,
    status: 'active',
    startedAt: new Date(),
    renewAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    amount: 0,
    paymentStatus: 'paid',
    planSnapshot: { entitlements: ['Bookings'] },
  });

  ok('active plan without the token blocks', (await entitlement.providerHasEntitlement(owner._id, 'marketing')) === false);

  let rejected = false;
  try {
    await entitlement.requireEntitlement(owner._id, 'marketing');
  } catch (e) {
    rejected = e && e.statusCode === 403;
  }
  ok('requireEntitlement throws 403 for a missing token', rejected);

  subscription.planSnapshot = { entitlements: ['bookings', 'Marketing'] };
  await subscription.save();
  ok('token matching is case-insensitive', (await entitlement.providerHasEntitlement(owner._id, 'marketing')) === true);
};

const run = async () => {
  const dbName = databaseName();
  if (!/e2e|test/i.test(dbName)) {
    console.error(`Refusing to run against database "${dbName}": its name must contain "e2e" or "test".`);
    process.exit(1);
  }

  console.log(`Local Services live E2E against database: ${dbName}`);
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 8000 });
  await mongoose.connection.dropDatabase();

  try {
    const { customer, owner, provider, booking } = await seed();
    console.log('\nInvoice + PDF');
    await checkInvoice(booking);
    console.log('\nPartner invoice access');
    await checkPartnerInvoice(booking, owner, customer);
    console.log('\nEntitlement gate');
    await checkEntitlements(owner, provider);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${failures === 0 ? 'ALL LIVE E2E CHECKS PASSED' : `${failures} LIVE E2E CHECK(S) FAILED`}`);
  if (failures) process.exitCode = 1;
};

run().catch(async (e) => {
  console.error(`\nLIVE E2E ERROR: ${e && e.stack ? e.stack : e}`);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // already disconnected
  }
  process.exit(1);
});
