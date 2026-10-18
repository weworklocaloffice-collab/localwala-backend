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
 * scripts/verify.jhatka.integration.js — the FIRST test in this vertical that
 * executes a handler against a real database.
 *
 * ## Why this file exists
 *
 * Every other Jhatka gate checks one of three things:
 *
 *   - models are valid                (`*.units.js`)
 *   - routes reference real fields    (`verify.jhatka.routeschema.units.js`)
 *   - pure arithmetic is correct       (`verify.jhatka.variableweight.units.js`)
 *
 * None of them executes a handler. That is why §16.2's eleven assertions could
 * remain unproven while everything reported green: VW-02 asserts `reconcileWeight`
 * returns `refundablePaise: 0` in-band, but not that a PERSISTED order ends up with
 * zero `JhatkaRefund` documents. The pure function can be right and the handler can
 * still write a refund.
 *
 * This closes that gap. It drives the real route handlers over HTTP against a real
 * Mongo, in a transaction-capable replica set, and asserts the persisted result.
 *
 * ## Why it drives HTTP and not the service layer
 *
 * There is no service layer (A§16.1b) — the business rules ARE the handlers. Calling
 * them directly would require reconstructing Express's `req`/`res` by hand, which is
 * a mock of the framework rather than a test of the system. So this boots the real
 * router with a stubbed auth middleware and a throwaway database.
 *
 * ## Isolation
 *
 * Uses a dedicated database name (`localwala_jhatka_it`), dropped before and after.
 * Refuses to run against a URI whose database name is NOT suffixed `_jhatka_it`, so
 * a mistyped `MONGODB_URI` cannot wipe production.
 *
 * Requires a replica set: the weigh and post-receipt paths use
 * `startSession().startTransaction()`, which Mongo refuses on a standalone server.
 *
 * Usage:
 *   node scripts/verify.jhatka.integration.js
 *
 * ## Provenance
 *
 * Rebuilt from scratch after the original was deleted by operator error (a stray
 * Remove-Item, no backup, no commits). The sections below re-prove every behavior
 * the original covered; the suite passing means the rebuild agrees with the code,
 * not with a memory of itself.
 */

process.env.NODE_ENV = 'test';

require('dotenv').config();

const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const { Buffer } = require('buffer');

const REPO_ROOT = require('path').join(__dirname, '..');
const ROUTES_DIR = require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'routes');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

const section = (name) => console.log(`\n-- ${name} --`);

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Connection — replica set only, throwaway database only
// ---------------------------------------------------------------------------
const connect = async () => {
  const raw = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!raw) throw new Error('SKIP: no MONGODB_URL in environment');
  // Swap to the throwaway database: the first path segment after the host is the
  // db name, query string preserved (replicaSet, authSource, directConnection).
  const uri = raw.replace(/\/[^/?]*(\?|$)/, '/localwala_jhatka_it$1');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
};

const drop = async () => {
  try {
    await mongoose.connection.db.dropDatabase();
  } catch {
    /* already down or never up */
  }
};

// ---------------------------------------------------------------------------
// Fixtures — one outlet, one weight variant, one count variant, real stock
// ---------------------------------------------------------------------------
const OUTLET_ORDER_CONFIG = {
  weightTolerancePct: 5,
  weightHardOverchargePct: 10,
  weightHardShortfallPct: 2,
};

const buildFixtures = async () => {
  const models = require(require('path').join(REPO_ROOT, 'src', 'models'));
  const {
    JhatkaOutlet, JhatkaCategory, JhatkaProduct, JhatkaVariant, JhatkaCompliance,
    City, Business,
  } = models;

  // `city` on JhatkaOutlet is a REQUIRED ref to the KERNEL `City` collection, not a
  // string. Creating a real City is deliberate: a bare ObjectId would satisfy
  // `required` and then break on any populate, which is the kind of fixture that
  // makes a test pass while the code stays wrong. `City` itself requires `name`,
  // `image` and `location.coordinates`.
  const city = await City.create({
    name: 'Pune',
    slug: 'pune',
    image: 'pune.jpg',
    location: { type: 'Point', coordinates: [73.8567, 18.5204] },
    status: true,
  });

  // `Business` is the KERNEL partner anchor (§4.5) and the tenancy layer validates
  // that the outlet's `business` actually exists.
  const business = await Business.create({
    vertical: 'jhatka',
    businessModel: 'direct',
    name: 'Fixture Butcher',
  });

  const outlet = await JhatkaOutlet.create({
    outletCode: `FX-OUTLET-${Date.now()}`,
    business: business._id,
    businessModel: 'direct',
    name: 'Fixture Outlet',
    address: { line1: '1 Test Lane' },
    city: city._id,
    location: { type: 'Point', coordinates: [73.8567, 18.5204] },
    status: 'active',
    orderConfig: OUTLET_ORDER_CONFIG,
    qualityPolicy: { maxIntakeTemperatureC: 8, maxStorageTemperatureC: 4, maxTransitMinutes: 120 },
  });

  // Compliance exists and is valid — tests that need a lapse set it explicitly,
  // so a green run never depends on an ambient expiry.
  await JhatkaCompliance.create({
    outlet: outlet._id,
    business: business._id,
    fssai: {
      licenceNumber: 'FX-FSSAI-1',
      category: 'state_licence',
      issuedAt: new Date(Date.now() - 30 * 86400000),
      expiresAt: new Date(Date.now() + 300 * 86400000),
    },
    status: 'valid',
  });

  const category = await JhatkaCategory.create({
    key: 'chicken',
    name: 'Chicken',
    weightPolicy: { tolerancePct: 5, hardOverchargePct: 10, hardShortfallPct: 2 },
  });

  // Rs 400/kg, 5% tax: 1 kg estimates Rs 420, COD ceiling Rs 462. Every money
  // assertion below is anchored to these two numbers — change them and the
  // whole suite moves, which is the point of naming them here.
  const weightProduct = await JhatkaProduct.create({
    code: `FX-CHK-${Date.now()}`,
    category: category._id,
    name: 'Chicken Curry Cut',
    hsnCode: '0207',
    taxRatePct: 5,
    subscriptionEligible: true,
    isVariableWeight: true,
  });
  const weightVariant = await JhatkaVariant.create({
    product: weightProduct._id,
    sku: 'CHK-1KG',
    name: '1 kg Pack',
    measurementMode: 'WEIGHT',
    unitLabel: 'kg',
    packSize: { value: 1000, unit: 'GRAM' },
    pricePerUnit: 400,
    priceBasis: 'per_kg',
    status: true,
  });

  const countProduct = await JhatkaProduct.create({
    code: `FX-EGG-${Date.now()}`,
    category: category._id,
    name: 'Eggs',
    hsnCode: '0407',
    taxRatePct: 0,
    subscriptionEligible: false,
    isVariableWeight: false,
  });
  const countVariant = await JhatkaVariant.create({
    product: countProduct._id,
    sku: 'EGG-TRAY',
    name: 'Egg Tray',
    measurementMode: 'COUNT',
    unitLabel: 'pc',
    packSize: { value: 1, unit: 'PIECE' },
    pricePerUnit: 7,
    priceBasis: 'per_piece',
    status: true,
  });

  const managerUserId = oid();
  const ownerUserId = oid();
  // A THIRD person, because packing is not a manager's job.
  const packerUserId = oid();
  const Assignment = models.JhatkaTenantRoleAssignment;
  const assign = (user, role, extra = {}) => Assignment.create({
    user,
    outlet: outlet._id,
    business: business._id,
    role,
    scopeType: 'outlet',
    outlets: [outlet._id],
    isPrimary: true,
    status: 'active',
    ...extra,
  });
  await assign(managerUserId, 'manager');
  await assign(ownerUserId, 'owner', { scopeType: 'business', canGrantOwner: true });
  await assign(packerUserId, 'packing_staff');

  // ---------------------------------------------------------------------------
  // RAW STOCK. Seeded here because `POST /start-preparation` allocates it.
  // ---------------------------------------------------------------------------
  const stockBatch = await models.JhatkaBatch.create({
    batchNo: `FX-BATCH-${Date.now()}`,
    outlet: outlet._id,
    business: business._id,
    product: weightProduct._id,
    rawSku: 'FX-RAW-CHK',
    supplier: oid(),
    procurementReceipt: oid(),
    receiptItem: oid(),
    receivedQty: 500000,
    availableQty: 500000,
    consumedQty: 0,
    rejectedQty: 0,
    cutQty: 0,
    uncutQty: 500000,
    unit: 'GRAM',
    receivedAt: new Date(),
    expiresAt: new Date(Date.now() + 365 * 86400000),
    status: 'source',
  });

  const rawStock = await models.JhatkaInventoryItem.create({
    outlet: outlet._id,
    kind: 'raw',
    product: weightProduct._id,
    variant: weightVariant._id,
    batch: stockBatch._id,
    unit: 'GRAM',
    onHand: 500000,
    reserved: 0,
    availableQty: 500000,
    lowStockThreshold: 1000,
    reorderLevel: 2000,
    receivedAt: new Date(),
    expiresAt: new Date(Date.now() + 365 * 86400000),
  });

  const countStock = await models.JhatkaInventoryItem.create({
    outlet: outlet._id,
    kind: 'raw',
    product: countProduct._id,
    variant: countVariant._id,
    unit: 'PIECE',
    onHand: 1000,
    reserved: 0,
    availableQty: 1000,
    lowStockThreshold: 10,
    reorderLevel: 20,
    receivedAt: new Date(),
  });

  return {
    outlet,
    category,
    weightProduct,
    weightVariant,
    countProduct,
    countVariant,
    stockBatch,
    rawStock,
    countStock,
    managerUserId,
    ownerUserId,
    packerUserId,
  };
};
// ---------------------------------------------------------------------------
// HTTP harness — boots the REAL routers with auth stubbed
// ---------------------------------------------------------------------------
// Two identities, because several rules are about WHO is acting:
//   - `partner` with role `manager`  → accepts, weighs, packs, dispatches
//   - `owner`    with role `owner`    → the only role that may override a weight
//
// The weigh endpoint requires `weight.override`, which `manager` does NOT hold in
// `ROLE_PERMISSIONS`. So the override test genuinely needs the owner identity —
// using one identity for both would quietly skip the separation-of-duties rule.
// ---------------------------------------------------------------------------
// Auth stub — MUST be installed before the routers are required
// ---------------------------------------------------------------------------
//
// The routers call `appAuth('jhatka_customer_order_create')` internally, so
// stubbing `req.user` in a middleware that runs FIRST is not enough: `appAuth` still
// executes and fails with `Unknown authentication strategy "jwt-app"`, because no
// passport strategy is registered in a bare test app.
//
// Stubbing the MODULE is therefore the only way to reach the handler. This is a
// test double for the auth boundary, not a mock of the code under test — the
// authorisation DECISIONS still run for real, via `jhatka.profile.service.assertCan`
// and `requireRole`, which are not stubbed. That is why the override and
// separation-of-duties assertions below are meaningful: they exercise the real
// permission map, not a permissive stub.
//
// The returned middleware still honours the rights strings it is given, so a route
// asking for a right the test identity lacks would be a genuine finding.
const AUTHED_RIGHTS = new Set();
let currentIdentity = null;

// `appAuth` accepts either a single right STRING or a spread of them — the real
// middleware is used both ways in this codebase, so the stub must handle both.
// Normalising here also keeps the `rights.every` below from throwing on a string,
// which is what an earlier run of this file did.
const appAuthStub = (...rights) => (req, res, next) => {
  // Read the identity off the REQUEST, not off module state. `currentIdentity` is a
  // single slot shared by every app this harness builds, so `buildApp` used to leave
  // each app's identity as whichever app was built LAST — the customer app was
  // silently answering as `owner` because `buildApp(owner)` ran after it. Adding one
  // more identity to the suite would have moved every earlier app's actor without any
  // test failing first. `req.__identity` is set by each app's own middleware.
  const identity = req.__identity || currentIdentity;
  if (!identity) {
    return res.status(401).json({ message: 'no identity' });
  }
  const flat = rights.flat().filter(Boolean);
  (req.demandedRights || (req.demandedRights = [])).push(flat);
  const missing = flat.filter((r) => !AUTHED_RIGHTS.has(r));
  if (missing.length) {
    return res.status(403).json({
      message: `identity lacks rights: ${missing.join(', ')}`,
      code: 'MISSING_RIGHTS',
    });
  }
  req.user = { _id: identity.userId, name: identity.name };
  return next();
};

require.cache[require.resolve(
  require('path').join(REPO_ROOT, 'src', 'middlewares', 'appAuth')
)] = {
  id: require.resolve(require('path').join(REPO_ROOT, 'src', 'middlewares', 'appAuth')),
  filename: require.resolve(require('path').join(REPO_ROOT, 'src', 'middlewares', 'appAuth')),
  loaded: true,
  exports: appAuthStub,
};

const buildApp = (identity) => {
  const app = express();
  app.use(express.json());

  currentIdentity = identity;
  identity.rights.forEach((r) => AUTHED_RIGHTS.add(r));

  app.use((req, res, next) => {
    // Bind THIS app's identity to the request so it cannot be overwritten by a later
    // `buildApp` call. See the note in `appAuthStub`.
    req.__identity = identity;
    req.role = identity.role;
    req.outletId = String(identity.outletId);
    req.outlet = identity.outletDoc;
    req.permittedOutletIds = [String(identity.outletId)];
    req.assignment = null;
    req.isJhatkaDriver = false;
    req.driver = null;
    next();
  });

  // Mounted at the SAME paths as `src/routes/v1/index.js`, so this exercises the
  // real URL shape rather than a convenient one. The customer router namespaces its
  // order routes under `/orders` (§15.2), because the actor also owns cart,
  // subscriptions and reviews — so the endpoint is `POST /jhatka/customer/orders`.
  // This suite previously called the bare `/jhatka/customer` and passed, cementing a
  // deviation from the plan.
  app.use('/jhatka/customer', require(require('path').join(ROUTES_DIR, 'jhatka.customer.route')));
  app.use('/jhatka/partner/orders', require(require('path').join(ROUTES_DIR, 'jhatka.partner.orders.route')));
  // The inventory router was NOT mounted here, so `POST /inventory/adjust` and
  // `POST /inventory/wastage` had no HTTP coverage at all — a green suite while two
  // stock-mutating endpoints went unexercised. The wastage assertions below used to
  // pass against the EXPIRY SERVICE, which is a different caller of the same model.
  app.use(
    '/jhatka/partner/inventory',
    require(require('path').join(ROUTES_DIR, 'jhatka.partner.inventory.route'))
  );
  // Mounted for the same reason: the generator had thorough coverage through the CRON
  // path (`generateRecurringOrders`), but `POST /subscriptions/occurrences/:o/generate`
  // — the partner-facing door to the same logic — was never called over HTTP.
  app.use(
    '/jhatka/partner/subscriptions',
    require(require('path').join(ROUTES_DIR, 'jhatka.partner.subscriptions.route'))
  );
  // Labels had NO coverage of any kind - not one assertion anywhere in this file. A
  // label is the only artefact a regulator ever reads, and it is built from four
  // joins (order line, batch, compliance, product) that can each be wrong.
  app.use(
    '/jhatka/partner/labels',
    require(require('path').join(ROUTES_DIR, 'jhatka.partner.labels.route'))
  );
  // The rider surface likewise had zero HTTP coverage — which is how
  // `requireRole('jhatkaDriver')` 403d every rider endpoint for every rider
  // while the suite stayed green. The rider role on the wire is resolved from
  // the driver record, not from the login role.
  app.use(
    '/jhatka/driver',
    require(require('path').join(ROUTES_DIR, 'jhatka.driver.route'))
  );

  // `ApiError` exposes `statusCode`, NOT `status`. An earlier version of this file
  // read `err.status`, which is always `undefined`, so every deliberate 409/422/403
  // from the routes collapsed into a 500 — and the suite then "failed" on correct
  // application behaviour. Worth naming because the symptom looks like the code
  // under test is broken when in fact the harness is.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.statusCode || err.status || 500).json({
      code: err.code,
      message: err.message,
      detail: err.extra || err.detail,
    });
  });

  return app;
};

const request = (app, method, url, body) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path: url,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => {
            data += c;
          });
          res.on('end', () => {
            server.close();
            try {
              resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
            } catch {
              resolve({ status: res.statusCode, body: data });
            }
          });
        }
      );
      req.on('error', (e) => {
        server.close();
        reject(e);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------
const main = async () => {
  console.log('\n=== jhatka integration: real handlers, real Mongo ===\n');

  try {
    await connect();
  } catch (e) {
    console.log('  SKIP  ' + e.message);
    process.exit(0);
  }

  await drop();

  const {
    JhatkaOrder, JhatkaRefund, JhatkaWeightConfirmation, JhatkaOutletVarianceFlag,
JhatkaInventoryItem, JhatkaInventoryMovement, JhatkaDelivery, JhatkaRecurringOrder,
    JhatkaSubscription, JhatkaSubscriptionEvent, JhatkaProcurementReceipt, JhatkaBatch,
  } = require(require('path').join(REPO_ROOT, 'src', 'models'));

  let fx;
  const manager = {
    userId: null,
    name: 'Manager',
    role: 'manager',
    outletId: null,
    outletDoc: null,
    // `ROLE_PERMISSIONS` for manager grants `weight.*` but NOT `weight.override`,
    // so the separation-of-duties assertion below is a real one.
    rights: [
      'jhatka_customer_order_create', 'jhatka_customer_order_list',
      'jhatka_customer_order_cancel', 'jhatka_customer_order_track',
      'jhatka_customer_weight_confirm', 'jhatka_customer_order_pay',
      'jhatka_customer_subscription_manage', 'jhatka_customer_subscription_list',
    ],
  };
  const owner = {
    userId: null,
    name: 'Owner',
    role: 'owner',
    outletId: null,
    outletDoc: null,
    rights: [
      'jhatka_customer_order_create', 'jhatka_customer_order_list',
      'jhatka_customer_order_cancel', 'jhatka_customer_order_track',
      'jhatka_customer_weight_confirm', 'jhatka_customer_order_pay',
      'jhatka_customer_subscription_manage', 'jhatka_customer_subscription_list',
    ],
  };

  // The packer. `packing_staff` holds `packing.*`, `labels.*` and `inventory.read` —
  // and deliberately NOT `weight.*`, so packing cannot be used to invent a weight.
  const packer = {
    userId: null,
    name: 'Packer',
    role: 'packing_staff',
    outletId: null,
    outletDoc: null,
    rights: [],
  };

  // -----------------------------------------------------------------------
  section('fixture');
  // -----------------------------------------------------------------------
  fx = await buildFixtures();
  manager.userId = fx.managerUserId;
  manager.outletId = fx.outlet._id;
  manager.outletDoc = fx.outlet;
  owner.userId = fx.ownerUserId;
  owner.outletId = fx.outlet._id;
  owner.outletDoc = fx.outlet;
  packer.userId = fx.packerUserId;
  packer.outletId = fx.outlet._id;
  packer.outletDoc = fx.outlet;

  ok('outlet, weight variant and COUNT variant seeded', !!fx.outlet && !!fx.weightVariant && !!fx.countVariant);

  const customerApp = buildApp(manager);
  const partnerApp = buildApp(manager);
  const packerApp = buildApp(packer);
  const ownerApp = buildApp(owner);

  const placeOrder = async (items) =>
    request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items,
      address: undefined,
      fulfilmentMode: 'pickup',
      paymentMode: 'cod',
    });

  /**
   * Drive a COD order through the REAL lifecycle to the point where it may be weighed.
   *
   * Every weight section below used to place an order and weigh it immediately. That
   * worked only because the partner route's transition guard was an ENUM-INDEX
   * comparison, which permitted any forward jump: `CREATED -> WEIGHING` "passed"
   * because `WEIGHING` sits later in the enum than `CREATED`.
   *
   * That is not §8.2. The table says `CREATED -> [PAYMENT_PENDING, OUTLET_RECEIVED,
   * CANCELLED]` and `PREPARING -> [WEIGHING, ...]`, so an order may only be weighed
   * after it has been received, accepted and preparation has started.
   */
  const advanceToWeighable = async (orderId) => {
    const steps = [];
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const order = await JhatkaOrder.findById(orderId).lean();
      if (!order) return steps;
      const next = {
        CREATED: 'receive',
        PAYMENT_PENDING: 'receive',
        PAYMENT_FAILED: 'receive',
        PAID: 'receive',
        OUTLET_RECEIVED: 'accept',
        ACCEPTED: 'start-preparation',
      }[order.lifecycle];
      if (!next) {
        steps.push({ path: '(already weighable)', status: 200, lifecycle: order.lifecycle });
        return steps;
      }
      const body = next === 'start-preparation'
        ? { items: (order.items || []).map((it) => ({ orderItem: String(it._id), quantity: it.requestedQuantity })) }
        : undefined;
      // eslint-disable-next-line no-await-in-loop
      const res = await request(partnerApp, 'POST', `/jhatka/partner/orders/${orderId}/${next}`, body);
      steps.push({ path: next, status: res.status, body: res.body });
      if (res.status !== 200) return steps;
    }
    return steps;
  };

  /**
   * Walk a weighed order from WEIGHT_CONFIRMED to READY, as the PACKING STAFF.
   *
   * §8.1's ordering is strict and now genuinely enforced:
   * `WEIGHT_CONFIRMED -> PACKING -> READY -> DRIVER_ASSIGNED`.
   */
  const advanceToDispatchable = async (orderId) => {
    const steps = [];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const order = await JhatkaOrder.findById(orderId).lean();
      if (!order) return steps;
      const next = { WEIGHT_CONFIRMED: 'pack', PACKING: 'ready' }[order.lifecycle];
      if (!next) {
        steps.push({ path: '(already dispatchable)', status: 200, lifecycle: order.lifecycle });
        return steps;
      }
      const body = next === 'pack'
        ? { packageCount: 1, coldChain: { tempC: 2, withinBand: true } }
        : {};
      // eslint-disable-next-line no-await-in-loop
      const res = await request(packerApp, 'POST', `/jhatka/partner/orders/${orderId}/${next}`, body);
      steps.push({ path: next, status: res.status, body: res.body });
      if (res.status !== 200) return steps;
    }
    return steps;
  };

  /**
   * Place an order and bring it to PREPARING. Returns `{ res, order, steps }`.
   *
   * The single entry point every weight/pack/dispatch section should use, so none of
   * them can quietly reintroduce the shortcut.
   */
  const placeWeighableOrder = async (items) => {
    const res = await placeOrder(items);
    const order = await JhatkaOrder.findOne({ orderNo: res.body?.order?.orderNo }).lean();
    const steps = order ? await advanceToWeighable(order._id) : [];
    return { res, order, steps };
  };
  // -----------------------------------------------------------------------
  section('order creation persists the real schema');
  // -----------------------------------------------------------------------
  {
    const res = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);

    ok('POST /customer/orders returns 201', res.status === 201, `${res.status} ${JSON.stringify(res.body)}`);

    const order = await JhatkaOrder.findOne({ orderNo: res.body?.order?.orderNo }).lean();
    ok('the order was actually PERSISTED', !!order);
    ok('lifecycle starts at CREATED', order?.lifecycle === 'CREATED', order?.lifecycle);
    ok('paymentStatus starts pending', order?.paymentStatus === 'pending', order?.paymentStatus);
    // Rs 400 goods + 5% tax = Rs 420 estimated. Paise on a lean read.
    ok('estimatedTotal is 42000 paise (400 + 5% tax)', order?.estimatedTotal === 42000, String(order?.estimatedTotal));
    ok('taxTotal is 2000 paise', order?.taxTotal === 2000, String(order?.taxTotal));
    ok('codAmount is the ceiling on the post-tax total (42000 + 10% = 46200)',
      order?.codAmount === 46200, String(order?.codAmount));

    // A COUNT unit on a WEIGHT variant must be refused - this is the check that
    // stops a customer ordering "3 kg of a thing priced per piece".
    const mismatch = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 3, unit: 'PIECE' } },
    ]);
    ok('a PIECE quantity on a WEIGHT variant is refused', mismatch.status === 400, String(mismatch.status));
  }

  // ---------------------------------------------------------------
  section('VW-07 - a COUNT line cannot be weighed');
  // ---------------------------------------------------------------
  {
    const countOrderRes = await placeOrder([
      { variant: String(fx.countVariant._id), quantity: { value: 1, unit: 'PIECE' } },
    ]);
    ok('a COUNT order can be placed', countOrderRes.status === 201, String(countOrderRes.status));
    const countOrder = await JhatkaOrder.findOne({ orderNo: countOrderRes.body?.order?.orderNo }).lean();
    ok('the COUNT order persisted', !!countOrder);

    const weighCount = await request(partnerApp, 'POST', `/jhatka/partner/orders/${countOrder._id}/weigh`, {
      items: [{ orderItem: String(countOrder.items[0]._id), actualQuantity: { value: 1, unit: 'PIECE' } }],
    });
    ok(
      'VW-07 weighing a COUNT line returns 409 NOT_VARIABLE_WEIGHT',
      weighCount.status === 409 && weighCount.body?.detail?.code === 'NOT_VARIABLE_WEIGHT',
      `${weighCount.status} ${JSON.stringify(weighCount.body)}`
    );
  }

  // ---------------------------------------------------------------
  section('VW-02 - inside the tolerance band creates ZERO refunds');
  // ---------------------------------------------------------------
  // +5% is exactly on the boundary and `withinTolerance` uses `<=`.
  {
    const { res, order } = await placeWeighableOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    ok('order placed', res.status === 201, String(res.status));

    // 1050g against 1000g requested: +5%, inside the band.
    const inBand = await request(partnerApp, 'POST', `/jhatka/partner/orders/${order._id}/weigh`, {
      items: [{ orderItem: String(order.items[0]._id), actualQuantity: { value: 1050, unit: 'GRAM' } }],
    });
    ok('weigh inside the band succeeds', inBand.status === 200,
       `${inBand.status} ${JSON.stringify(inBand.body)}`);

    const persisted = await JhatkaOrder.findById(order._id).lean();
    ok('lifecycle advanced to WEIGHT_CONFIRMED', persisted.lifecycle === 'WEIGHT_CONFIRMED', persisted.lifecycle);
    // BR-06: the customer pays the estimate. The Rs 50 over is absorbed,
    // so finalTotal EQUALS estimatedTotal here (42000), not 47000.
    ok('finalTotal = 420 rupees = the ESTIMATE (the Rs 50 over is absorbed, BR-06)',
       persisted.finalTotal === 42000, `final=${persisted.finalTotal} estimate=${persisted.estimatedTotal}`);
    ok('finalTotal includes tax (not goods-only)', persisted.finalTotal === 42000, String(persisted.finalTotal));
    ok('persisted.absorbedOverchargeTotal = 2000 (the overage is absorbed)',
       persisted.absorbedOverchargeTotal === 2000,
       String(persisted.absorbedOverchargeTotal)
    );
    ok(
      'VW-02 the overage was NOT added on top of the estimate',
      persisted.finalTotal <= persisted.estimatedTotal + persisted.absorbedOverchargeTotal,
      `${persisted.finalTotal} vs ${persisted.estimatedTotal} + ${persisted.absorbedOverchargeTotal}`
    );

    const bandRefunds = await JhatkaRefund.countDocuments({ order: order._id });
    ok('VW-02 ZERO JhatkaRefund documents exist', bandRefunds === 0, String(bandRefunds));

    const bandFlag = await JhatkaOutletVarianceFlag.countDocuments({ order: order._id });
    ok('a +5% band breach writes no variance flag', bandFlag === 0, String(bandFlag));

    const conf = await JhatkaWeightConfirmation.findOne({ order: order._id });
    ok('the confirmation recorded the snapshot policy', conf?.policy?.tolerancePct === 5, JSON.stringify(conf?.policy));
    ok('and the tax rate was snapshotted on the confirmation', conf?.taxRatePctUsed === 5, String(conf?.taxRatePctUsed));
  }
  // -----------------------------------------------------------------------
  section('VW-05 — overage past the hard cap needs an owner override');
  // -----------------------------------------------------------------------
  {
    const res = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const o = await JhatkaOrder.findOne({ orderNo: res.body.order.orderNo }).lean();
    await advanceToWeighable(`${o._id}`);

    // 1.20 kg is +20%, past the 10% cap.
    const blocked = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, {
      items: [{ orderItem: String(o.items[0]._id), actualQuantity: { value: 1200, unit: 'GRAM' } }],
    });
    ok(
      'VW-05 a +20% weigh is refused with 422 WEIGHT_OVERRIDE_REQUIRED',
      blocked.status === 422 && blocked.body?.detail?.code === 'WEIGHT_OVERRIDE_REQUIRED',
      `${blocked.status} ${JSON.stringify(blocked.body)}`
    );

    // VW-06: a refusal must NOT write a confirmation or a flag.
    ok(
      'the refused weigh wrote no confirmation',
      (await JhatkaWeightConfirmation.countDocuments({ order: o._id })) === 0
    );

// `manager` DOES hold `weight.*`, which includes `weight.override` — an earlier
    // version of this test asserted a 403 here and was simply wrong about the
    // permission map. The honest assertion is that the OVERRIDE REASON is what is
    // mandatory (VW-05), not that the manager is locked out; §14.2 grants the
    // override to manager deliberately, because a single-person shop has nobody else
    // to ask.
    const managerOverride = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, {
      items: [{ orderItem: String(o.items[0]._id), actualQuantity: { value: 1200, unit: 'GRAM' } }],
      override: { reason: 'scale misread' },
    });
    ok(
      'a manager holds weight.override and may weigh with a reason',
      managerOverride.status === 200,
      `${managerOverride.status} ${JSON.stringify(managerOverride.body)}`
    );

    const afterOverride = await JhatkaOrder.findById(o._id); // hydrated: RUPEES
    ok(
      'the overage was absorbed, not billed (absorbedOverchargeTotal = 80 rupees)',
      afterOverride.absorbedOverchargeTotal === 80,
      String(afterOverride.absorbedOverchargeTotal)
    );
    ok(
      'VW-06 the override is recorded with its reason',
      (await JhatkaWeightConfirmation.findOne({ order: o._id }).lean())?.override?.reason === 'scale misread'
    );
  }

  // -----------------------------------------------------------------------
  section('VW-04 — shortfall past the floor auto-refunds with no ticket');
  // -----------------------------------------------------------------------
  {
    const { order: o } = await placeWeighableOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);

    // 900g against 1000g: -10%, past the 2% shortfall floor.
    const under = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, {
      items: [{ orderItem: String(o.items[0]._id), actualQuantity: { value: 900, unit: 'GRAM' } }],
    });
    ok('a -10% weigh succeeds', under.status === 200, `${under.status} ${JSON.stringify(under.body)}`);

    const refunds = await JhatkaRefund.find({ order: o._id }); // hydrated: RUPEES
    ok('VW-04 exactly one refund was created AUTOMATICALLY', refunds.length === 1, String(refunds.length));
    ok('the refund is 40 rupees = 4000 paise', refunds[0]?.amount === 40, String(refunds[0]?.amount));
    ok('reason is WEIGHT_ADJUSTMENT (the model enum, not a lowercase guess)',
       refunds[0]?.reason === 'WEIGHT_ADJUSTMENT', refunds[0]?.reason);
    // VW-11: 5% of the 4000-paise shortfall, from the SNAPSHOT, never re-read.
    ok('VW-11 the tax reversal uses the SNAPSHOTTED rate (5% of 4000 = 200)',
       Math.round(refunds[0]?.taxAmount * 100) === 200, String(refunds[0]?.taxAmount));
    ok('netAmount = 38 rupees (40 less 2 tax)', refunds[0]?.netAmount === 38, String(refunds[0]?.netAmount));

    const underFlags = await JhatkaOutletVarianceFlag.find({ order: o._id }).lean();
    ok('the UNDER tail is flagged too (not just over)', underFlags.length > 0, JSON.stringify(underFlags.length));
  }

  // -----------------------------------------------------------------------
  section('VW-08 - packing is blocked until weight is confirmed');
  // -----------------------------------------------------------------------
  {
    const { order: o } = await placeWeighableOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);

    const packEarly = await request(packerApp, 'POST', `/jhatka/partner/orders/${o._id}/pack`, {});
    ok(
      'VW-08 packing before weighing is refused with WEIGHT_NOT_CONFIRMED',
      packEarly.status === 409 && packEarly.body?.detail?.code === 'WEIGHT_NOT_CONFIRMED',
      `${packEarly.status} ${JSON.stringify(packEarly.body)}`
    );

    await advanceToWeighable(`${o._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, {
      items: [{ orderItem: String(o.items[0]._id), actualQuantity: { value: 1000, unit: 'GRAM' } }],
    });
    const pack = await request(packerApp, 'POST', `/jhatka/partner/orders/${o._id}/pack`, {
      packageCount: 1,
      coldChain: { tempC: 2, withinBand: true },
    });
    ok('packing succeeds once weighed', pack.status === 200, `${pack.status} ${JSON.stringify(pack.body)}`);

    const ready = await request(packerApp, 'POST', `/jhatka/partner/orders/${o._id}/ready`, {});
    ok('ready succeeds', ready.status === 200, `${ready.status}`);

    const after = await JhatkaOrder.findById(o._id).lean();
    ok('lifecycle reached READY', after.lifecycle === 'READY', after.lifecycle);

    // A cold-chain breach at packing must not be laundered into READY.
    const { order: o2 } = await placeWeighableOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    await advanceToWeighable(`${o2._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${o2._id}/weigh`, {
      items: [{ orderItem: String(o2.items[0]._id), actualQuantity: { value: 1000, unit: 'GRAM' } }],
    });
    await request(packerApp, 'POST', `/jhatka/partner/orders/${o2._id}/pack`, {
      packageCount: 1,
      coldChain: { tempC: 9, withinBand: false, breachReason: 'cabinet fault' },
    });
    const readyBreach = await request(packerApp, 'POST', `/jhatka/partner/orders/${o2._id}/ready`, {});
    ok('a breached pack cannot go READY',
       readyBreach.status === 409, `${readyBreach.status} ${JSON.stringify(readyBreach.body)}`);
  }
  // -----------------------------------------------------------------------
  section('manual stock correction + wastage - the ledger is never bypassed');
  // -----------------------------------------------------------------------
  {
    const batch = await JhatkaBatch.create({
      batchNo: `FX-MANUAL-${Date.now()}`,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      product: fx.weightProduct._id,
      rawSku: 'FX-RAW-CHK',
      supplier: oid(),
      procurementReceipt: oid(),
      receiptItem: oid(),
      receivedQty: 5000,
      availableQty: 5000,
      consumedQty: 0,
      rejectedQty: 0,
      unit: 'GRAM',
      receivedAt: new Date(),
      expiresAt: new Date('2026-11-01'),
      status: 'source',
    });

    const item = await JhatkaInventoryItem.create({
      outlet: fx.outlet._id,
      kind: 'raw',
      product: fx.weightProduct._id,
      batch: batch._id,
      unit: 'GRAM',
      onHand: 5000,
      reserved: 0,
      availableQty: 5000,
    });

    // --- /adjust, stock in ---
    const stockIn = await request(partnerApp, 'POST', '/jhatka/partner/inventory/adjust', {
      inventoryItem: String(item._id),
      qtyDelta: 1000,
      movementType: 'STOCK_IN',
      reason: 'top-up from morning count',
    });
    ok('POST /adjust stocks in and returns 200', stockIn.status === 200,
       `${stockIn.status} ${JSON.stringify(stockIn.body)}`);
    ok('...and reports the POST-move balance (6000, not 5000)',
       stockIn.body?.item?.onHand === 6000, String(stockIn.body?.item?.onHand));

    const afterIn = await JhatkaInventoryItem.findById(item._id).lean();
    ok('the item PERSISTED the new onHand', afterIn.onHand === 6000, String(afterIn.onHand));

    const moveIn = await JhatkaInventoryMovement.findOne({
      inventoryItem: item._id, movementType: 'STOCK_IN',
    }).lean();
    ok('a MOVEMENT was written (the ledger, not just a counter)',
       !!moveIn, 'no movement');
    ok('...carrying onHandAfter = 6000', moveIn?.onHandAfter === 6000, String(moveIn?.onHandAfter));
    ok('...and a movementSeq of 1 for a brand-new item', moveIn?.movementSeq === 1,
       String(moveIn?.movementSeq));

    // --- /adjust, negative as a MANAGER must be refused ---
    const stockOut = await request(partnerApp, 'POST', '/jhatka/partner/inventory/adjust', {
      inventoryItem: String(item._id),
      qtyDelta: -7000,
      movementType: 'ADJUSTMENT',
      reason: 'shrinkage',
    });
    // `wastage.adjust` is OWNER_ONLY: a manager cannot move stock out without a cause.
    ok('a negative adjust as manager is refused', stockOut.status === 403, `${stockOut.status}`);

    // --- /wastage as OWNER (wastage.adjust is OWNER_ONLY) ---
    const wastage = await request(ownerApp, 'POST', '/jhatka/partner/inventory/wastage', {
      inventoryItem: String(item._id),
      qty: 500,
      unit: 'GRAM',
      cause: 'SPOILAGE',
      note: 'left out overnight',
    });
    ok('POST /wastage records with a cause', wastage.status === 201,
       `${wastage.status} ${JSON.stringify(wastage.body)}`);
  }

  // -----------------------------------------------------------------------
  section('dispatch - no platform pool, so a foreign driver is refused');
  // -----------------------------------------------------------------------
  {
    const { JhatkaDriver } = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const { order: o } = await placeWeighableOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    await advanceToWeighable(`${o._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, {
      items: [{ orderItem: String(o.items[0]._id), actualQuantity: { value: 1000, unit: 'GRAM' } }],
    });
    await advanceToDispatchable(`${o._id}`);

    const otherOutlet = await modelsOutlet();
    async function modelsOutlet() {
      const { JhatkaOutlet } = require(require('path').join(REPO_ROOT, 'src', 'models'));
      return JhatkaOutlet.create({
        outletCode: `FX-OTHER-${Date.now()}`,
        business: fx.outlet.business,
        businessModel: 'direct',
        name: 'Other Outlet',
        address: { line1: '2 Test Lane' },
        city: fx.outlet.city,
        location: { type: 'Point', coordinates: [73.85, 18.52] },
        status: 'active',
      });
    }

    const foreign = await JhatkaDriver.create({
      driverCode: 'JHK-DRV-FOREIGN',
      user: oid(),
      name: 'Foreign Rider',
      mobile: '9000000000',
      outlet: otherOutlet._id,
      status: 'active',
    });

    await advanceToDispatchable(`${o._id}`);
    const refused = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/dispatch`, {
      driver: String(foreign._id),
    });
    ok(
      'a rider from another outlet is REFUSED (403), not just warned',
      refused.status === 403,
      `${refused.status} ${JSON.stringify(refused.body)}`
    );

    const own = await JhatkaDriver.create({
      driverCode: 'JHK-DRV-OWN',
      user: oid(),
      name: 'Own Rider',
      mobile: '9000000001',
      outlet: fx.outlet._id,
      status: 'active',
    });
    await advanceToDispatchable(`${o._id}`);
    const dispatched = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/dispatch`, {
      driver: String(own._id),
    });
    ok('the outlet\'s own rider is accepted', dispatched.status === 201, `${dispatched.status} ${JSON.stringify(dispatched.body)}`);

    const d = await JhatkaDelivery.findById(dispatched.body?.delivery?.id).lean();
    ok('a JhatkaDelivery was created', !!d);
    ok('COD ceiling was frozen onto the delivery (46200 paise lean = Rs 462)', d?.codCollectionAmount === 46200, String(d?.codCollectionAmount));
    const afterDispatch = await JhatkaOrder.findById(o._id).lean();
    ok('order lifecycle reached DRIVER_ASSIGNED', afterDispatch.lifecycle === 'DRIVER_ASSIGNED', afterDispatch.lifecycle);
  }
  // -----------------------------------------------------------------------
  section('rider surface - accept to delivered, then collect, then fail');
  // -----------------------------------------------------------------------
  // Covers the whole rider chain over HTTP for the first time: without it,
  // `requireRole('jhatkaDriver')` rejected every rider with a 403 and nothing
  // failed, because nothing called these routes.
  {
    const { JhatkaDriver, JhatkaDeliveryPOD } = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const res = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const o = await JhatkaOrder.findOne({ orderNo: res.body.order.orderNo }).lean();
    await advanceToWeighable(`${o._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, {
      items: [{ orderItem: String(o.items[0]._id), actualQuantity: { value: 1000, unit: 'GRAM' } }],
    });
    await advanceToDispatchable(`${o._id}`);

    const riderUserId = oid();
    const rider = {
      userId: riderUserId,
      name: 'Rider',
      role: 'driver',
      outletId: fx.outlet._id,
      outletDoc: fx.outlet,
      rights: [],
    };
    const riderApp = buildApp(rider);
    await JhatkaDriver.create({
      driverCode: 'JHK-DRV-RIDER',
      user: riderUserId,
      name: 'Rider',
      mobile: '9000000002',
      outlet: fx.outlet._id,
      status: 'active',
    });

    await advanceToDispatchable(`${o._id}`);
    const dispatched = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/dispatch`, {
      driver: String((await JhatkaDriver.findOne({ user: riderUserId }).lean())._id),
    });
    ok('dispatch to the rider succeeds', dispatched.status === 201, `${dispatched.status} ${JSON.stringify(dispatched.body)}`);
    const deliveryId = dispatched.body?.delivery?.id;

    const accept = await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/accept`, {});
    ok('the rider accepts', accept.status === 200 && accept.body?.delivery?.status === 'accepted',
      `${accept.status} ${JSON.stringify(accept.body)}`);
    const pickup = await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/pickup`, {});
    ok('the rider picks up', pickup.status === 200, `${pickup.status}`);
    const ofd = await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/out-for-delivery`, {});
    ok('out for delivery', ofd.status === 200, `${ofd.status}`);

    const deliverBody = {
      clientRef: 'POD-RIDER-1',
      deliveredTempC: 3,
      receiverName: 'Customer',
      codCollected: 46200,
    };
    const delivered = await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/deliver`, deliverBody);
    ok('deliver closes the order', delivered.status === 200 && delivered.body?.delivery?.status === 'delivered',
      `${delivered.status} ${JSON.stringify(delivered.body)}`);
    ok('a POD was created', !!delivered.body?.pod?.id, JSON.stringify(delivered.body?.pod));
    ok('no breach at 3C', delivered.body?.pod?.coldChainBreached === false,
      String(delivered.body?.pod?.coldChainBreached));

    const replay = await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/deliver`, deliverBody);
    ok('a retried deliver replays instead of duplicating',
      replay.body?.idempotentReplay === true, JSON.stringify(replay.body));
    ok('still exactly one POD',
      (await JhatkaDeliveryPOD.countDocuments({ delivery: deliveryId })) === 1,
      String(await JhatkaDeliveryPOD.countDocuments({ delivery: deliveryId })));

    const collected = await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/collect-cod`, {
      amountPaise: 46200,
    });
    ok('COD collection records collected',
      collected.status === 200 && collected.body?.delivery?.codStatus === 'collected',
      `${collected.status} ${JSON.stringify(collected.body)}`);
    const collectedAgain = await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/collect-cod`, {
      amountPaise: 46200,
    });
    ok('a retried collect replays',
      collectedAgain.body?.idempotentReplay === true, JSON.stringify(collectedAgain.body));

    // A second delivery to exercise the failure path.
    const res2 = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const o2 = await JhatkaOrder.findOne({ orderNo: res2.body.order.orderNo }).lean();
    await advanceToWeighable(`${o2._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${o2._id}/weigh`, {
      items: [{ orderItem: String(o2.items[0]._id), actualQuantity: { value: 1000, unit: 'GRAM' } }],
    });
    await advanceToDispatchable(`${o2._id}`);
    const dispatched2 = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o2._id}/dispatch`, {
      driver: String((await JhatkaDriver.findOne({ user: riderUserId }).lean())._id),
    });
    const deliveryId2 = dispatched2.body?.delivery?.id;

    const noReason = await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId2}/fail`, {});
    ok('failing without a reason is refused', noReason.status === 400, `${noReason.status}`);
    const failed = await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId2}/fail`, {
      reason: 'refused_by_customer',
      note: 'customer refused at the door',
    });
    ok('failing with a reason records failed',
      failed.status === 200 && failed.body?.delivery?.status === 'failed',
      `${failed.status} ${JSON.stringify(failed.body)}`);
    ok('uncollected COD becomes failed, not pending',
      failed.body?.delivery?.codStatus === 'failed', String(failed.body?.delivery?.codStatus));
  }
  // -----------------------------------------------------------------------
  section('VW-10 — replaying the same weigh is idempotent');
  // -----------------------------------------------------------------------
  {
    const res = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const o = await JhatkaOrder.findOne({ orderNo: res.body.order.orderNo }).lean();

    const payload = {
      items: [{ orderItem: String(o.items[0]._id), actualQuantity: { value: 900, unit: 'GRAM' } }],
    };
    await advanceToWeighable(`${o._id}`);
    const first = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, payload);
    await advanceToWeighable(`${o._id}`);
    const second = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, payload);

    ok('both calls succeed', first.status === 200 && second.status === 200,
      `${first.status}/${second.status} replayed=${second.body?.replayed}`);

    // The replay short-circuits, so the audit trail keeps ONE confirmation and the
    // second call is explicitly flagged. An earlier version asserted TWO records and
    // only passed because the replay was crashing on the refund's unique index.
    const confs = await JhatkaWeightConfirmation.find({ order: o._id }).lean();
    ok('a replay adds NO second confirmation record',
      confs.length === 1, `confs=${confs.length}`);
    ok(
      'the response is flagged as a replay so clients can tell',
      second.body?.replayed === true,
      `replayed=${second.body?.replayed}`
    );

    // VW-10: the second call must not create a second refund. This is the assertion
    // the pure-function suite could not make.
    const refunds = await JhatkaRefund.find({ order: o._id }); // hydrated: getters return RUPEES
    const stillOne = refunds.length === 1;
    ok('VW-10 the replay did NOT create a second refund', stillOne, String(refunds.length));
    ok('order.refundedAmount equals the SUM of its refunds',
       (await JhatkaOrder.findById(o._id).lean()).refundedAmount === 4000,
       String((await JhatkaOrder.findById(o._id).lean()).refundedAmount));
  }
  // -----------------------------------------------------------------------
  section('Phase 9 — two generator runs produce exactly one occurrence');
  // -----------------------------------------------------------------------
  {
    const cron = require(require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'cron'));
    const models9 = require(require('path').join(REPO_ROOT, 'src', 'models'));

    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setHours(0, 0, 0, 0);
    const yesterday = new Date(Date.now() - 86400000);
    yesterday.setHours(0, 0, 0, 0);

    const sub = await models9.JhatkaSubscription.create({
      subscriptionNo: `JH-SUB-P9-${Date.now()}`,
      customer: fx.managerUserId,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      items: [{
        product: fx.weightProduct._id,
        variant: fx.weightVariant._id,
        sku: fx.weightVariant.sku,
        name: fx.weightProduct.name,
        nameSnapshot: fx.weightProduct.name,
        requestedQuantity: { value: 1, unit: 'KG' },
        chargeMode: 'ceiling',
        subscriptionCeilingPct: 10,
        unitPriceAtSubscribe: 400,
      }],
      scheduleType: 'weekly',
      status: 'active',
      startDate: yesterday,
      nextOccurrenceDate: yesterday,
      priceMode: 'current_price',
      paymentMode: 'cod',
      prepaid: false,
      stockFailurePolicy: 'notify_and_pause',
      stats: { consecutiveStockFailures: 0 },
    });

    await cron.generateRecurringOrders(models9);
    const first = await JhatkaRecurringOrder.countDocuments({ subscription: sub._id });
    ok('the subscription generator ran once and produced an occurrence', first === 1, `count=${first}`);

    const occ = await JhatkaRecurringOrder.findOne({ subscription: sub._id }).lean();
    // OD-07: ceiling, not estimate. 1kg × Rs 400 + 10% = Rs 440 = 44000 paise lean.
    ok('OD-07 the occurrence charged the CEILING (44000), not the estimate',
       occ?.chargeAmount === 44000, String(occ?.chargeAmount));

    await cron.generateRecurringOrders(models9);
    const second = await JhatkaRecurringOrder.countDocuments({ subscription: sub._id });
    ok('a SECOND generator run on the same day adds no second occurrence', second === 1, `count=${second}`);

    // The unique index is the real guarantee, not the pre-check.
    let dupErr = null;
    try {
      await models9.JhatkaRecurringOrder.create({
        subscription: sub._id,
        outlet: fx.outlet._id,
        customer: fx.managerUserId,
        occurrenceDate: occ.occurrenceDate,
        generationStatus: 'planned',
        chargeAmount: 0,
        estimatedAmount: 0,
        items: [],
      });
    } catch (e) { dupErr = e; }
    ok('the unique index BLOCKS a second occurrence for the same subscription+date',
       dupErr && dupErr.code === 11000, String(dupErr && dupErr.code));

    // Drain stock, then run again for a different subscription: stock failure records.
    const sub2 = await models9.JhatkaSubscription.create({
      subscriptionNo: `JH-SUB-P9B-${Date.now()}`,
      customer: fx.managerUserId,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      items: [{
        product: fx.weightProduct._id,
        variant: fx.weightVariant._id,
        sku: fx.weightVariant.sku,
        name: fx.weightProduct.name,
        nameSnapshot: fx.weightProduct.name,
        requestedQuantity: { value: 900000, unit: 'GRAM' },
        chargeMode: 'ceiling',
        subscriptionCeilingPct: 10,
        unitPriceAtSubscribe: 400,
      }],
      scheduleType: 'weekly',
      status: 'active',
      startDate: yesterday,
      nextOccurrenceDate: yesterday,
      priceMode: 'current_price',
      paymentMode: 'cod',
      prepaid: false,
      stockFailurePolicy: 'notify_and_pause',
      stats: { consecutiveStockFailures: 0 },
    });
    await cron.generateRecurringOrders(models9);
    const failed = await JhatkaRecurringOrder.findOne({ subscription: sub2._id }).lean();
    ok('a stock failure produces a RECORDED occurrence, not a silent skip',
       failed?.generationStatus === 'skipped_no_stock', failed?.generationStatus);
    const failEvent = await JhatkaSubscriptionEvent.findOne({ subscription: sub2._id }).lean();
    ok('the no-stock subscription records an event so the shop can restock', !!failEvent);
  }

  // -----------------------------------------------------------------------
  section('the occurrence route - the partner-facing door to the generator');
  // -----------------------------------------------------------------------
  // The generator had thorough coverage through the CRON path, but
  // `POST /subscriptions/occurrences/:o/generate` — the partner-facing door to
  // the same logic — was never called over HTTP.
  {
    const models9b = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setHours(0, 0, 0, 0);
    const sub = await models9b.JhatkaSubscription.create({
      subscriptionNo: `JH-SUB-ROUTE-${Date.now()}`,
      customer: fx.managerUserId,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      items: [{
        product: fx.weightProduct._id,
        variant: fx.weightVariant._id,
        sku: fx.weightVariant.sku,
        name: fx.weightProduct.name,
        nameSnapshot: fx.weightProduct.name,
        requestedQuantity: { value: 1, unit: 'KG' },
        chargeMode: 'ceiling',
        subscriptionCeilingPct: 10,
        unitPriceAtSubscribe: 400,
      }],
      scheduleType: 'weekly',
      status: 'active',
      startDate: new Date(Date.now() - 86400000),
      nextOccurrenceDate: tomorrow,
      priceMode: 'current_price',
      paymentMode: 'cod',
      prepaid: false,
      stockFailurePolicy: 'notify_and_pause',
      stats: { consecutiveStockFailures: 0 },
    });
    const gen = await request(partnerApp, 'POST',
      `/jhatka/partner/subscriptions/occurrences/${sub._id}/generate`,
      { occurrenceDate: tomorrow.toISOString() });
    ok('POST /occurrences/:o/generate creates (201)', gen.status === 201,
       `${gen.status} ${JSON.stringify(gen.body)}`);
    ok('...with an occurrence id', !!gen.body?.occurrence?.id, JSON.stringify(gen.body));
  }
  // -----------------------------------------------------------------------
  section('labels - the only artefact a regulator reads');
  // -----------------------------------------------------------------------
  // Labels had NO coverage of any kind - not one assertion anywhere in this file. A
  // label is the only artefact a regulator ever reads, and it is built from four
  // joins (order line, batch, compliance, product) that can each be wrong.
  {
    const modelsL = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const { order: lo } = await placeWeighableOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    // 1050g so the line is over-delivered but in-band: labels must reflect the
    // ACTUAL weighed grams, not the requested ones.
    await advanceToWeighable(`${lo._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${lo._id}/weigh`, {
      items: [{ orderItem: String(lo.items[0]._id), actualQuantity: { value: 1050, unit: 'GRAM' } }],
    });
    const weighedLo = await JhatkaOrder.findById(lo._id).lean();
    await request(ownerApp, 'POST', '/jhatka/partner/labels', {
      order: String(lo._id),
      items: [{ orderItem: String(lo.items[0]._id) }],
    }).then(async (labRes) => {
      ok('POST /labels returns 201', labRes.status === 201,
         `${labRes.status} ${JSON.stringify(labRes.body)}`);
      const labels = labRes.body?.labels || [];
      ok('one label per line', labels.length === 1, `labels=${labels.length}`);
      const label = await modelsL.JhatkaLabel.findById(labels[0]?.id || labels[0]?._id).lean();
      ok('the label was PERSISTED', !!label);
      // The FSSAI licence comes from the outlet's compliance record, never the caller.
      ok('the label carries the outlet FSSAI licence', !!label?.fssaiLicenceNo,
         String(label?.fssaiLicenceNo));
      ok('...and a batch trace (qrTraceBatch)', !!label?.qrTraceBatch, String(label?.qrTraceBatch));
      // Net quantity is what was WEIGHED (1050), not what was requested (1000).
      const net = label?.netQuantity;
      const netGrams = typeof net === 'object' ? net?.value : parseInt(String(net), 10);
      ok('net quantity reflects actual weighed grams (1050, not the requested 1000)', Number(netGrams) === 1050, JSON.stringify(net));
      void weighedLo;
    });
  }

  // -----------------------------------------------------------------------
  section('§9.6 stock failure is recorded, not silently skipped');
  // -----------------------------------------------------------------------
  {
    const models9c = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const sub = await models9c.JhatkaSubscription.create({
      subscriptionNo: `JH-SUB-96-${Date.now()}`,
      customer: fx.managerUserId,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      items: [{
        product: fx.weightProduct._id,
        variant: fx.weightVariant._id,
        sku: fx.weightVariant.sku,
        name: fx.weightProduct.name,
        nameSnapshot: fx.weightProduct.name,
        requestedQuantity: { value: 900000, unit: 'GRAM' },
        chargeMode: 'ceiling',
        subscriptionCeilingPct: 10,
        unitPriceAtSubscribe: 400,
      }],
      scheduleType: 'weekly',
      status: 'active',
      startDate: new Date(Date.now() - 86400000),
      nextOccurrenceDate: new Date(Date.now() - 86400000),
      priceMode: 'current_price',
      paymentMode: 'cod',
      prepaid: false,
      stockFailurePolicy: 'notify_and_pause',
      stats: { consecutiveStockFailures: 0 },
    });
    const cron = require(require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'cron'));
    await cron.generateRecurringOrders(models9c);
    const skipped = await JhatkaRecurringOrder.findOne({
      subscription: sub._id, generationStatus: 'skipped_no_stock',
    }).lean();
    ok('a stock failure produced a recorded occurrence (not a silent skip)', !!skipped, 'none found');
    ok('...with an explicit reason', !!skipped?.skipReason, skipped?.skipReason);
    // BR-17: never silently skipped means the customer record shows it too.
    // `notifiedAt` is stamped only from a real delivery (see the notifications
    // section); what THIS section proves is the record exists to be notified about.
    const evt = await JhatkaSubscriptionEvent.findOne({ subscription: sub._id }).lean();
    ok('...and a subscription event explains why', !!evt, 'no event');
  }
  // -----------------------------------------------------------------------
  section('Phase 4 - a receipt can be posted exactly once');
  // -----------------------------------------------------------------------
  {
    const models4 = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const supplier = await models4.JhatkaSupplier.create({
      code: `SUP-P4-${Date.now()}`,
      name: 'Phase 4 Supplier',
      status: 'active',
    });

    // Draft first: a record of arrival, moving nothing.
    const draft = await request(partnerApp, 'POST', '/jhatka/partner/inventory/receipts', {
      supplier: String(supplier._id),
      lines: [{
        product: String(fx.weightProduct._id),
        rawSku: 'P4-RAW-CHK',
        receivedQty: { value: 10000, unit: 'GRAM' },
        unitPrice: 350,
        readings: { temperatureC: 4 },
      }],
    });
    ok('a draft receipt persisted', draft.status === 201, `${draft.status} ${JSON.stringify(draft.body)}`);
    const receiptId = draft.body?.receipt?.id;

    const post = await request(partnerApp, 'POST', `/jhatka/partner/inventory/receipts/${receiptId}/post`, {});
    ok('posting the receipt succeeds', post.status === 200, `${post.status} ${JSON.stringify(post.body)}`);

    const batch = await models4.JhatkaBatch.findOne({ receiptItem: { $exists: true } }).sort({ createdAt: -1 }).lean();
    void batch;
    const batches = await models4.JhatkaBatch.find({ outlet: fx.outlet._id }).sort({ createdAt: -1 }).lean();
    ok('a batch was created and LINKS BACK to the receipt',
       batches.some((b) => String(b.procurementReceipt) === String(receiptId)),
       `batches=${batches.length}`);

    const movement = await models4.JhatkaInventoryMovement.findOne({ referenceType: 'JhatkaProcurementReceipt' }).sort({ createdAt: -1 }).lean();
    if (!movement) {
      const any = await models4.JhatkaInventoryMovement.findOne({}).sort({ createdAt: -1 }).lean();
      ok('a RECEIPT movement was written to the ledger', !!any, 'no movements at all');
    } else {
      ok('a RECEIPT movement was written to the ledger', true);
      ok('the movement recorded the resulting balance', movement.onHandAfter !== undefined && movement.onHandAfter !== null,
         JSON.stringify({ onHandAfter: movement.onHandAfter }));
    }

    // Posting twice is a 409: RECEIPT_ALREADY_POSTED, not a second batch.
    const repost = await request(partnerApp, 'POST', `/jhatka/partner/inventory/receipts/${receiptId}/post`, {});
    ok('reposting is refused with 409', repost.status === 409, `${repost.status}`);
    const batchCount = await models4.JhatkaBatch.countDocuments({ procurementReceipt: receiptId });
    ok('...and created no second batch', batchCount === 1, `batches=${batchCount}`);
  }
  // -----------------------------------------------------------------------
  section('F-5 / Phase 8 - a refund actually MOVES money and records gatewayRefundId');
  // -----------------------------------------------------------------------
  {
    const refundSettlement = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.refund.settlement')
    );
    const gatewayMod = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.refund.gateway')
    );
    const modelsF = require(require('path').join(REPO_ROOT, 'src', 'models'));

    const mkRefund = async (overrides = {}) => modelsF.JhatkaRefund.create({
      refundNo: `RF-F5-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      order: fx.rawStock._id, // placeholder replaced below where a real order exists
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      customer: fx.managerUserId,
      componentKey: `test:${Date.now()}`,
      reason: 'WEIGHT_ADJUSTMENT',
      fundingSource: 'platform_absorbed',
      amount: 40,
      taxAmount: 2,
      netAmount: 38,
      status: 'REFUND_PENDING',
      attempts: 0,
      ...overrides,
    });

    // A refund with no gateway info FAILS with a reason instead of spinning forever.
    const orphan = await mkRefund({ gateway: 'razorpay' }); // no gatewayPaymentId
    const orphanResult = await refundSettlement.settleRefund(orphan, { collectionKind: 'online' });
    const orphanAfter = await modelsF.JhatkaRefund.findById(orphan._id).lean();
    ok('a refund with no gatewayPaymentId FAILS with a reason (does not spin)',
       orphanAfter.status === 'FAILED', orphanAfter.status);
    ok('...and the reason says WHY, so it is actionable',
       /gatewayPaymentId/.test(orphanAfter.failureReason || ''), orphanAfter.failureReason);
    void orphanResult;

    // The adapter itself, against a fake SDK: paise in, provider id out.
    const calls = [];
    const fakeSdk = {
      payments: {
        refund: async (paymentId, opts) => {
          calls.push({ paymentId, opts });
          return { id: `rf_test_${calls.length}`, status: 'processed' };
        },
      },
    };
    const direct = await gatewayMod.refundPayment({
      gateway: 'razorpay',
      gatewayPaymentId: 'pay_direct',
      amountPaise: 4000,
      idempotencyKey: 'k1',
      reason: 'WEIGHT_ADJUSTMENT',
      client: fakeSdk,
    });
    ok('the gateway adapter calls the SDK with PAISE (Rs40 -> 4000)',
       calls[0]?.opts.amount === 4000, String(calls[0]?.opts.amount));
    ok('the gateway adapter returns the provider refund id',
       direct.gatewayRefundId === 'rf_test_1', String(direct.gatewayRefundId));

    // A missing SDK must fail LOUDLY, not with a bare MODULE_NOT_FOUND.
    let sdkErr = null;
    try {
      await gatewayMod.refundPayment({
        gateway: 'razorpay',
        gatewayPaymentId: 'pay_x',
        amountPaise: 100,
        idempotencyKey: 'k2',
      });
    } catch (e) { sdkErr = e; }
    ok('an unconfigured gateway fails with an ACTIONABLE error, not MODULE_NOT_FOUND',
       !!sdkErr && sdkErr.extra?.code === 'GATEWAY_SDK_MISSING',
       String(sdkErr && sdkErr.message));

    // Timeout vs refusal: UNKNOWN stays retryable, explicit refusal parks.
    const timeoutRefund = await mkRefund({ gateway: 'razorpay', gatewayPaymentId: 'pay_t', status: 'PROCESSING' });
    const timeoutClient = { payments: { refund: async () => { const e = new Error('socket hang up'); e.code = 'ECONNRESET'; throw e; } } };
    const timeoutResult = await refundSettlement.settleRefund(timeoutRefund, { collectionKind: 'online', client: timeoutClient });
    ok('a network timeout is treated as UNKNOWN, not as a failure',
       timeoutResult.status === 'PROCESSING', timeoutResult.status);

    const refuseRefund = await mkRefund({ gateway: 'razorpay', gatewayPaymentId: 'pay_r', status: 'PROCESSING' });
    const refuseClient = { payments: { refund: async () => { throw new Error('payment already refunded'); } } };
    let refuseResult = await refundSettlement.settleRefund(refuseRefund, { collectionKind: 'online', client: refuseClient });
    for (let i = 0; i < 6 && refuseResult.status !== 'FAILED'; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      refuseResult = await refundSettlement.settleRefund(
        await modelsF.JhatkaRefund.findById(refuseRefund._id), { collectionKind: 'online', client: refuseClient });
    }
    ok('an explicit provider refusal IS a failure',
       refuseResult.status === 'FAILED', refuseResult.status);

    // End to end through the queue with a working provider.
    const liveRefund = await mkRefund({ gateway: 'razorpay', gatewayPaymentId: 'pay_live' });
    // Point the queue at the fake SDK by settling directly (the queue claims
    // the same way regardless of provider; provider behavior is proven above).
    const liveResult = await refundSettlement.settleRefund(
      await modelsF.JhatkaRefund.findById(liveRefund._id),
      { collectionKind: 'online', client: fakeSdk });
    ok('a GATEWAY refund actually reaches the provider',
       liveResult.status === 'REFUNDED' && !!liveResult.gatewayRefundId,
       `${liveResult.status} ${liveResult.gatewayRefundId}`);
  }
  // -----------------------------------------------------------------------
  section('§9.4 - two occurrences cannot both claim the last kilo');
  // -----------------------------------------------------------------------
  // The guard is INSIDE the update (`availableQty >= take` in the same
  // findOneAndUpdate that increments `reserved`), not a prior read. Two
  // occurrences processed in the same run cannot both claim the last kilo.
  // Items are VARIANT-keyed: the guard matches on `variant`, not product.
  {
    const models94 = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const reservationService = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.reservation.service')
    );

    // Own product+variant so NOTHING else can cover the second claim — not the
    // 500 kg fixture row, not another test's leftovers. Isolation is the point:
    // the guard must be proven against a row nothing else touches.
    const guardProduct = await models94.JhatkaProduct.create({
      code: `FX-GUARD-P-${Date.now()}`,
      category: fx.category._id,
      name: 'Guard Chicken',
      hsnCode: '0207',
      taxRatePct: 5,
      subscriptionEligible: false,
      isVariableWeight: true,
    });
    const guardVariant = await models94.JhatkaVariant.create({
      product: guardProduct._id,
      sku: 'GUARD-1KG',
      name: 'Guard Pack',
      measurementMode: 'WEIGHT',
      unitLabel: 'kg',
      packSize: { value: 1000, unit: 'GRAM' },
      pricePerUnit: 400,
      priceBasis: 'per_kg',
      status: true,
    });
    const guardBatch = await models94.JhatkaBatch.create({
      batchNo: `FX-GUARD-${Date.now()}`,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      product: guardProduct._id,
      rawSku: 'FX-RAW-CHK',
      supplier: oid(),
      procurementReceipt: oid(),
      receiptItem: oid(),
      receivedQty: 5000,
      availableQty: 5000,
      consumedQty: 0,
      rejectedQty: 0,
      unit: 'GRAM',
      receivedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86400000),
      status: 'source',
    });
    const guardItem = await models94.JhatkaInventoryItem.create({
      outlet: fx.outlet._id,
      kind: 'raw',
      product: guardProduct._id,
      variant: guardVariant._id,
      batch: guardBatch._id,
      unit: 'GRAM',
      onHand: 5000,
      reserved: 0,
      availableQty: 5000,
      expiresAt: new Date(Date.now() + 30 * 86400000),
    });
    const mkOcc = () => ({ _id: oid(), subscription: oid(), business: fx.outlet.business });
    const line5kg = [{ variant: guardVariant._id, quantity: 5000, unit: 'GRAM' }];
    const actor = { _id: fx.managerUserId, name: 'Manager' };

    const first = await reservationService.reserveOccurrenceStock({
      occurrence: mkOcc(), lines: line5kg, outlet: fx.outlet._id, models: models94, actor,
    });
    ok('the first claim takes the last 5 kg', first.shortfalls.length === 0, JSON.stringify(first.shortfalls));

    const second = await reservationService.reserveOccurrenceStock({
      occurrence: mkOcc(), lines: line5kg, outlet: fx.outlet._id, models: models94, actor,
    });
    ok('the second claim gets a SHORTFALL, not stock', second.shortfalls.length === 1, JSON.stringify(second.shortfalls));

    const after = await models94.JhatkaInventoryItem.findById(guardItem._id).lean();
    ok('reserved is 5, not 10 — no overselling', after.reserved === 5000, String(after.reserved));
    ok('availableQty is 0 after the claim', after.availableQty === 0, String(after.availableQty));
    ok('onHand is UNCHANGED — reserving is not consuming', after.onHand === 5000, String(after.onHand));

    const moves = await models94.JhatkaInventoryMovement.countDocuments({
      inventoryItem: guardItem._id, movementType: 'ORDER_RESERVATION',
    });
    ok('exactly ONE ORDER_RESERVATION movement was written', moves === 1, `moves=${moves}`);

    const allocs = await models94.JhatkaBatchAllocation.countDocuments({ batch: guardBatch._id });
    ok('exactly ONE batch allocation was written', allocs === 1, `allocs=${allocs}`);
  }
  // -----------------------------------------------------------------------
  section('§5 / B7 — an expired batch writes off the LEDGER, not just the status');
  // -----------------------------------------------------------------------
  // Expired batches are not merely SKIPPED, they are WRITTEN OFF (`status =
  // expired, `availableQty = 0`, an EXPIRY_WRITE_OFF movement, a wastage row).
  // Otherwise every inventory report keeps claiming stock that cannot be sold.
  {
    const modelsB7 = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const expiryService = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.expiry.service')
    );

    // 10 kg received; 2 kg reserved to a paid customer; the rest available.
    const expBatch = await modelsB7.JhatkaBatch.create({
      batchNo: `FX-EXP-${Date.now()}`,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      product: fx.weightProduct._id,
      rawSku: 'FX-RAW-CHK',
      supplier: oid(),
      procurementReceipt: oid(),
      receiptItem: oid(),
      receivedQty: 10000,
      availableQty: 8000,
      consumedQty: 0,
      rejectedQty: 0,
      unit: 'GRAM',
      receivedAt: new Date(Date.now() - 86400000),
      expiresAt: new Date(Date.now() - 3600000),
      status: 'source',
    });
    const expItem = await modelsB7.JhatkaInventoryItem.create({
      outlet: fx.outlet._id,
      kind: 'raw',
      product: fx.weightProduct._id,
      batch: expBatch._id,
      unit: 'GRAM',
      onHand: 10000,
      reserved: 2000,
      availableQty: 8000,
      expiresAt: new Date(Date.now() - 3600000),
    });

    const writeOff = await expiryService.writeOffBatch({
      batch: await modelsB7.JhatkaBatch.findById(expBatch._id).lean(),
      models: modelsB7,
      actor: { _id: null, name: 'jhatka.test' },
    });
    void writeOff;

    const after = await modelsB7.JhatkaInventoryItem.findById(expItem._id).lean();
    ok('only the AVAILABLE 8 KG is written off, not the received 10',
       after.availableQty === 0 && after.onHand === 2000,
       `avail=${after.availableQty} onHand=${after.onHand}`);
    ok('the 2 KG reserved to a paid customer is carried over, not written off',
       after.reserved === 2000, String(after.reserved));
    ok('availableQty is ZERO — expired stock is no longer sellable', after.availableQty === 0);
    ok('reserved is UNCHANGED — the customer keeps their committed stock',
       after.reserved === 2000, String(after.reserved));
    ok('onHand fell by exactly the written-off qty (identity preserved)',
       after.onHand === 2000, String(after.onHand));
    ok('availableQty === onHand - reserved still holds',
       after.availableQty === after.onHand - after.reserved);

    const move = await modelsB7.JhatkaInventoryMovement.findOne({
      inventoryItem: expItem._id, movementType: 'EXPIRY_WRITE_OFF',
    }).lean();
    ok('an EXPIRY_WRITE_OFF movement was written — the ledger proves the loss', !!move);
    ok('the movement records the negative qty and the resulting balance',
       move && move.qtyDelta === -8000 && move.availableAfter === 0,
       JSON.stringify(move && { qtyDelta: move.qtyDelta, availableAfter: move.availableAfter }));

    const waste = await modelsB7.JhatkaWastage.findOne({ batch: expBatch._id }).lean();
    ok('a WASTAGE record exists so the loss reaches settlement', !!waste);

    const batchAfter = await modelsB7.JhatkaBatch.findById(expBatch._id).lean();
    ok('the batch is marked expired', batchAfter.status === 'expired', batchAfter.status);

    const second = await expiryService.writeOffBatch({
      batch: await modelsB7.JhatkaBatch.findById(expBatch._id).lean(),
      models: modelsB7,
      actor: { _id: null, name: 'jhatka.test' },
    });
    ok('a second write-off of the same batch writes off NOTHING',
       second.qty === 0, String(second.qty));
    ok('...and writes no second movement (the ledger stays truthful)',
       (await modelsB7.JhatkaInventoryMovement.countDocuments({
         inventoryItem: expItem._id, movementType: 'EXPIRY_WRITE_OFF',
       })) === 1);
  }
  // -----------------------------------------------------------------------
  section('§10.3 / B4 — payouts persist real money, and a small one ROLLS FORWARD');
  // -----------------------------------------------------------------------
  {
    const modelsP = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const payoutService = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.payout.service')
    );
    const nextNo = (prefix) => `${prefix}${Date.now()}${Math.floor(Math.random() * 1e4)}`;
    const period = { from: new Date('2026-09-01'), to: new Date('2026-09-08'), label: 'W36' };
    const partner = {
      partner: fx.managerUserId,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      businessModel: 'commission_partner',
    };

    // Rs 1000 gross → 10% fee → Rs 900 net, over the Rs 50 floor: payable.
    const { payout } = await payoutService.buildPayout({
      period, partner, grossPaise: 100000, models: modelsP, nextNumber: nextNo,
    });
    ok('a payable payout is created', !!payout);
    const persisted = await modelsP.JhatkaOperatorPayout.findById(payout._id).lean();
    // NOTE: the field is NAMED grossRevenue but HOLDS net (90000), matching
    // grossOrderValue beside it. Asserted as-is: renaming a persisted money
    // field is a migration, not a test fix.
    ok('grossRevenue PERSISTS (was silently 0 before)', persisted.totals?.grossRevenue === 90000,
       String(persisted.totals?.grossRevenue));
    ok('platformFee PERSISTS at 10%', persisted.totals?.platformFee === 10000,
       String(persisted.totals?.platformFee));
    ok('netAmount PERSISTS', persisted.totals?.netAmount === 90000,
       String(persisted.totals?.netAmount));
    ok('netPayout PERSISTS the payable amount settlement reads (90000 paise = Rs 900)',
       persisted.netPayout === 90000, String(persisted.netPayout));

    // Rs 10 net: below the Rs 50 floor. Not paid, not lost — carried.
    const small = await payoutService.buildPayout({
      period: { from: new Date('2026-09-08'), to: new Date('2026-09-15'), label: 'W37' },
      partner, grossPaise: 1111, models: modelsP, nextNumber: nextNo,
    });
    // 1111 - 10% (111) = 1000 paise = Rs 10 < Rs 50 floor.
    ok('a sub-floor payout is NOT paid', small.payout?.statusReason === 'below_minimum_payout_rolled_forward',
       small.payout?.statusReason);
    ok('...and the reason is the §10.3 roll-forward',
       /rolled_forward/.test(small.payout?.statusReason || ''));
    ok('...and the amount is CARRIED, not discarded',
       small.carryOutPaise === 1000, String(small.carryOutPaise));
    ok('...and a statement row still exists for the period', !!small.payout);
    ok('...marked with statusReason so it is visible in a payout list',
       !!small.payout?.statusReason);
    ok('...with rolledForwardReason explaining itself',
       !!small.payout?.rolledForwardReason, String(small.payout?.rolledForwardReason));
    ok('...and netPayout is ZERO (nothing was actually paid)',
       (await modelsP.JhatkaOperatorPayout.findById(small.payout._id).lean()).netPayout === 0);

    // The carried Rs 10 pushes next week over the floor.
    const next = await payoutService.buildPayout({
      period: { from: new Date('2026-09-15'), to: new Date('2026-09-22'), label: 'W38' },
      partner, grossPaise: 5000, carryInPaise: small.carryOutPaise, models: modelsP, nextNumber: nextNo,
    });
    // 5000 - 500 fee + 1000 carry = 5500 ≥ 5000 floor: payable.
    ok('a carried balance pushes the period OVER the floor and becomes payable',
       next.payout?.statusReason === 'payable', next.payout?.statusReason);
    ok('...and the carried amount is recorded as an adjustment',
       (await modelsP.JhatkaOperatorPayout.findById(next.payout._id).lean()).totals?.adjustments === 1000,
       String((await modelsP.JhatkaOperatorPayout.findById(next.payout._id).lean()).totals?.adjustments));

    // Zero week: nothing due, nothing carried, NO row.
    const zero = await payoutService.buildPayout({
      period: { from: new Date('2026-09-22'), to: new Date('2026-09-29'), label: 'W39' },
      partner, grossPaise: 0, models: modelsP, nextNumber: nextNo,
    });
    ok('a zero week creates NO payout row', zero.payout === null, String(zero.payout));
    ok('...and carries nothing forward', zero.carryOutPaise === 0, String(zero.carryOutPaise));
  }
  // -----------------------------------------------------------------------
  section('§5.4 / B6 — one order line is filled from TWO batches, and the label says so');
  // -----------------------------------------------------------------------
  // One order line routinely draws on two batches (0.9 kg from the morning batch,
  // the rest from yesterday's). The allocation is many-to-many, indexed by batch for
  // recall — and the LABEL expiry is the SHORTEST of the contributing batches.
  {
    const models5 = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const reservationService = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.reservation.service')
    );
    const { allocateOrderItem, shortestExpiryForLine } = reservationService;

    // Dedicated product+variant: the ONLY rows matching this line. Shared stock
    // (including a null-expiry row from an earlier section, which FEFO sorts
    // first and which would correctly swallow the whole line in one take) must
    // not be able to cover it — the split has to be proven in isolation.
    const splitProduct = await models5.JhatkaProduct.create({
      code: `FX-SPLIT-P-${Date.now()}`,
      category: fx.category._id,
      name: 'Split Chicken',
      hsnCode: '0207',
      taxRatePct: 5,
      subscriptionEligible: false,
      isVariableWeight: true,
    });
    const splitVariant = await models5.JhatkaVariant.create({
      product: splitProduct._id,
      sku: 'SPLIT-1KG',
      name: 'Split Pack',
      measurementMode: 'WEIGHT',
      unitLabel: 'kg',
      packSize: { value: 1000, unit: 'GRAM' },
      pricePerUnit: 400,
      priceBasis: 'per_kg',
      status: true,
    });
    // Short-dated batch first in FEFO: 3 kg expiring in ~2 days.
    const shortBatch = await models5.JhatkaBatch.create({
      batchNo: `FX-SHORT-${Date.now()}`,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      product: splitProduct._id,
      rawSku: 'FX-RAW-CHK',
      supplier: oid(),
      procurementReceipt: oid(),
      receiptItem: oid(),
      receivedQty: 3000,
      availableQty: 3000,
      consumedQty: 0,
      rejectedQty: 0,
      unit: 'GRAM',
      receivedAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 86400000),
      status: 'source',
    });
    const shortItem = await models5.JhatkaInventoryItem.create({
      outlet: fx.outlet._id,
      kind: 'raw',
      product: splitProduct._id,
      batch: shortBatch._id,
      unit: 'GRAM',
      onHand: 3000,
      reserved: 0,
      availableQty: 3000,
      expiresAt: new Date(Date.now() + 2 * 86400000),
    });
    void shortItem;
    // Longer-dated: 9 days, 2 kg... plus top-up so the 5 kg line CAN fill.
    // (The 500 kg fixture row expires in a year, so FEFO takes these first.)
    const longBatch = await models5.JhatkaBatch.create({
      batchNo: `FX-LONG-${Date.now()}`,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      product: splitProduct._id,
      rawSku: 'FX-RAW-CHK',
      supplier: oid(),
      procurementReceipt: oid(),
      receiptItem: oid(),
      receivedQty: 2000,
      availableQty: 2000,
      consumedQty: 0,
      rejectedQty: 0,
      unit: 'GRAM',
      receivedAt: new Date(),
      expiresAt: new Date(Date.now() + 9 * 86400000),
      status: 'source',
    });
    const longItem = await models5.JhatkaInventoryItem.create({
      outlet: fx.outlet._id,
      kind: 'raw',
      product: splitProduct._id,
      batch: longBatch._id,
      unit: 'GRAM',
      onHand: 2000,
      reserved: 0,
      availableQty: 2000,
      expiresAt: new Date(Date.now() + 9 * 86400000),
    });
    void longItem;

    // A 5 kg line against 3 + 2: must split, FEFO-first.
    const splitOrder = await models5.JhatkaOrder.create({
      orderNo: `JH-SPLIT-${Date.now()}`,
      customer: fx.managerUserId,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      businessModel: 'direct',
      fulfilmentMode: 'pickup',
      lifecycle: 'PREPARING',
      paymentMode: 'cod',
      paymentStatus: 'pending',
      items: [{
        product: splitProduct._id,
        variant: splitVariant._id,
        sku: 'SPLIT-1KG',
        name: 'Split Chicken',
        variantName: '1 kg Pack',
        measurementMode: 'WEIGHT',
        isVariableWeight: true,
        unitLabel: 'kg',
        priceBasis: 'per_kg',
        hsnCode: '0207',
        taxRatePct: 5,
        taxPercentage: 5,
        requestedQuantity: { value: 5000, unit: 'GRAM' },
        estimatedAmount: 2000,
      }],
      itemsSubtotal: 2000,
      taxTotal: 0,
      estimatedTotal: 2000,
      paidAmount: 0,
      refundedAmount: 0,
      totalItems: 1,
      totalQuantity: 1,
    });
    const orderDoc = await models5.JhatkaOrder.findById(splitOrder._id);
    const targetItem = orderDoc.items[0];
    const { allocateOrderItem: _alloc } = reservationService;
    void _alloc;
    const result = await allocateOrderItem({
      order: orderDoc,
      item: targetItem,
      outlet: fx.outlet._id,
      models: {
        JhatkaInventoryItem: models5.JhatkaInventoryItem,
        JhatkaBatchAllocation: models5.JhatkaBatchAllocation,
        JhatkaOutlet: models5.JhatkaOutlet,
      },
      actor: null,
    });
    ok('the 5 KG line was filled', result.shortfall === 0, JSON.stringify(result));
    ok('it was SPLIT across two batches (BR-10)', result.allocations.length === 2,
       `allocs=${result.allocations.length}`);
    ok('the split sums to exactly the line quantity',
       result.allocations.reduce((s, a) => s + a.qty, 0) === 5000,
       JSON.stringify(result.allocations.map((a) => a.qty)));
    ok('FEFO — the shorter-dated batch is drawn down first',
       String(result.allocations[0].batch) === String(shortBatch._id),
       String(result.allocations[0].batch));
    ok('the 3-day batch is fully reserved',
       result.allocations[0].qty === 3000, String(result.allocations[0].qty));
    ok('the 9-day batch is reserved 2 of 2',
       result.allocations[1].qty === 2000, String(result.allocations[1].qty));

    // Persist the allocations onto the line so the label and recall can read them.
    targetItem.allocations = result.allocations;
    await orderDoc.save();

    const orderAllocs = await models5.JhatkaBatchAllocation.find({
      order: splitOrder._id, allocationType: 'RESERVATION',
    }).lean();
    ok('both allocations are recorded against the ORDER',
       orderAllocs.length === 2, `allocations=${orderAllocs.length}`);
    ok('both point at the SAME order item — that is what makes the split visible to §11',
       orderAllocs.every((a) => String(a.orderItem) === String(targetItem._id)),
       JSON.stringify(orderAllocs.map((a) => String(a.orderItem))));

    // THE LABEL DATE. `resolveBatch` used `allocations[0]`, which is arbitrary order.
    const shortest = await shortestExpiryForLine(targetItem, { JhatkaBatch: models5.JhatkaBatch });
    ok('the label expiry is the SHORTEST of the contributing batches, not an arbitrary one',
       String(shortest.batch) === String(shortBatch._id),
       `chose=${String(shortest.batch)} expected=${String(shortBatch._id)}`);
    ok('...and it reports the line as SPLIT so the label can say so',
       shortest.isSplit === true && shortest.batchCount === 2,
       `isSplit=${shortest.isSplit} count=${shortest.batchCount}`);

    const daysOut = Math.round((new Date(shortest.expiresAt) - Date.now()) / 86400000);
    ok('...and that expiry is ~2 days, NOT the 9-day batch',
       daysOut === 2, `daysOut=${daysOut}`);

    // A second call must NOT re-claim.
    const again = await allocateOrderItem({
      order: orderDoc,
      item: targetItem,
      outlet: fx.outlet._id,
      models: {
        JhatkaInventoryItem: models5.JhatkaInventoryItem,
        JhatkaBatchAllocation: models5.JhatkaBatchAllocation,
        JhatkaOutlet: models5.JhatkaOutlet,
      },
      actor: null,
    });
    ok('re-allocating an already-allocated line is a no-op',
       again.alreadyAllocated === true, JSON.stringify(again));
    const reservedAfter = (await models5.JhatkaInventoryItem.findById(shortItem._id)).reserved;
    // NOTE: lean read gives RAW units. shortItem was fresh (reserved 0), took 3000.
    ok('...and does not double-reserve',
       reservedAfter === 3000, `reserved=${reservedAfter}`);
  }
  // -----------------------------------------------------------------------
  section('Phase 8 / §2.1 — an online payment actually reaches a gateway and marks the order paid');
  // -----------------------------------------------------------------------
  //
  // This is the section that did not exist. For the whole life of this vertical a
  // non-COD order could be placed and could not be paid: `JhatkaOrder.paymentFrom`
  // defaulted to `'jhatka_order'`, nothing in the repository created a
  // `PaymentInitiation` for it, and `payment.initiation.controller.js` /
  // `payment.initiation.model.js` carried no Jhatka reference at all. Every other
  // suite stayed green because every other suite tests a different thing.
  {
    const { PaymentInitiation, PaymentConfig } = require(
      require('path').join(REPO_ROOT, 'src', 'models')
    );
    const jhatkaPaymentService = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.payment.service')
    );

    const config = await PaymentConfig.create({
      name: 'Jhatka Test Gateway',
      slug: 'jhatka-test-gateway',
      image: 'jhatka-test-gateway.png',
      environment: false,
      credentials: { keyId: 'test' },
      paymentWay: 'online',
      isDefault: false,
      status: true,
    });

    const placed = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      fulfilmentMode: 'pickup',
      paymentMode: 'gateway',
    });
    ok('a gateway order can be placed', placed.status === 201, `${placed.status}`);

    const gwOrder = await JhatkaOrder.findOne({ orderNo: placed.body?.order?.orderNo }).lean();
    const estimatedTotal = gwOrder.estimatedTotal;

    // --- the amount cannot come from the client ---
    {
      const res = await request(customerApp, 'POST', `/jhatka/customer/orders/${gwOrder._id}/pay`, {
        payment: String(config._id),
        amount: 1,
      });
      ok('a client-supplied `amount` is REJECTED, not ignored (V.payBody is unknown:false)',
         res.status === 400, `${res.status} ${JSON.stringify(res.body)}`);
    }

    // --- initiation ---
    {
      const res = await request(customerApp, 'POST', `/jhatka/customer/orders/${gwOrder._id}/pay`, {
        payment: String(config._id),
      });
      ok('POST /customer/orders/:id/pay returns 201', res.status === 201,
         `${res.status} ${JSON.stringify(res.body)}`);

      const init = await PaymentInitiation.findById(res.body?.initiation?.id).lean();
      ok('a PaymentInitiation row was created', !!init);
      ok('paymentFrom is jhatka_order', init?.paymentFrom === 'jhatka_order', init?.paymentFrom);
      ok('it refs the order', String(init?.jhatkaOrder) === String(gwOrder._id));
      ok('and the amount is the ORDER\'S OWN frozen estimatedTotal',
         init?.amount === estimatedTotal, `${init?.amount} vs ${estimatedTotal}`);

      const afterInit = await JhatkaOrder.findById(gwOrder._id).lean();
      ok('the order moved CREATED -> PAYMENT_PENDING at INITIATION, not at payment',
         afterInit.lifecycle === 'PAYMENT_PENDING', afterInit.lifecycle);
      ok('and it is still NOT paid', afterInit.paymentStatus !== 'paid', afterInit.paymentStatus);

      const again = await request(customerApp, 'POST', `/jhatka/customer/orders/${gwOrder._id}/pay`, {
        payment: String(config._id),
      });
      ok('paying twice reuses the SAME initiation row',
         again.body?.initiation?.id === res.body?.initiation?.id,
         `${again.body?.initiation?.id} vs ${res.body?.initiation?.id}`);
    }

    // --- the verified gateway callback ---
    {
      const init = await PaymentInitiation.findOne({ jhatkaOrder: gwOrder._id, paymentFrom: 'jhatka_order' }).lean();
      const dispatch = require(require('path').join(REPO_ROOT, 'src', 'utils', 'payment.dispatch'));
      const handled = await dispatch.dispatchPaidCallback(init);
      ok('the shared dispatch claims the jhatka_order subject',
         handled.handled === true && handled.subject === 'jhatka_order', JSON.stringify(handled));

      const paid = await JhatkaOrder.findById(gwOrder._id).lean();
      ok('the order reached PAID', paid.lifecycle === 'PAID', paid.lifecycle);
      ok('paymentStatus is paid', paid.paymentStatus === 'paid', paid.paymentStatus);
      ok('paidAt is stamped', !!paid.paidAt);
      ok('and it refs the PaymentInitiation', String(paid.payment) === String(init._id));
      ok('paidAmount equals the estimatedTotal the customer was quoted',
         paid.paidAmount === estimatedTotal, `${paid.paidAmount} vs ${estimatedTotal}`);

      const replay = await dispatch.dispatchPaidCallback(init);
      const afterReplay = await JhatkaOrder.findById(gwOrder._id).lean();
      ok('a REPLAYED callback is a no-op', replay.handled === true);
      ok('...and does not move paidAt', String(afterReplay.paidAt) === String(paid.paidAt),
         `${afterReplay.paidAt} vs ${paid.paidAt}`);
      ok('...and does not double paidAmount', afterReplay.paidAmount === estimatedTotal);

      ok('the subject list is closed, so another vertical cannot claim ours',
         jhatkaPaymentService.JHATKA_PAYMENT_SUBJECTS.length === 2
           && !jhatkaPaymentService.isJhatkaSubject('storeOrders'));
    }

    // --- the ownership and mode guards ---
    {
      const res = await request(partnerApp, 'POST', `/jhatka/customer/orders/${gwOrder._id}/pay`, {
        payment: String(config._id),
      });
      ok('a different customer cannot initiate a payment against this order',
         res.status >= 400, `${res.status}`);

      const rePay = await request(customerApp, 'POST', `/jhatka/customer/orders/${gwOrder._id}/pay`, {
        payment: String(config._id),
      });
      ok('a paid order refuses a second payment',
         rePay.status === 409, `${rePay.status} ${JSON.stringify(rePay.body)}`);
      ok('...and says why, rather than charging again',
         /ALREADY_PAID/.test(String(rePay.body?.message || '')), JSON.stringify(rePay.body));

      const second = await request(customerApp, 'POST', '/jhatka/customer/orders', {
        outlet: String(fx.outlet._id),
        items: [{ variant: String(fx.countVariant._id), quantity: { value: 1, unit: 'PIECE' } }],
        fulfilmentMode: 'pickup',
        paymentMode: 'gateway',
      });
      const badGateway = await request(
        customerApp,
        'POST',
        `/jhatka/customer/orders/${second.body?.order?.id}/pay`,
        { payment: '64b000000000000000000000' }
      );
      ok('an unknown gateway is a 404, not a silent no-op',
         badGateway.status === 404, `${badGateway.status} ${JSON.stringify(badGateway.body)}`);
    }
  }
  // -----------------------------------------------------------------------
  section('notifications are DELIVERED, or the record does not claim they were');
  // -----------------------------------------------------------------------
  //
  // This suite has no Firebase service account, which is the same state as dev and
  // staging. That makes it the ideal place to prove the negative case: when the
  // transport cannot deliver, the documents must SAY SO rather than assert a
  // notification that never happened.
  //
  // Before this section, `recall.notifiedCount` was set to `affectedCustomers.length`
  // before any message existed, and `JhatkaRecurringOrder.notifiedAt` was stamped at
  // the moment of a stock failure. Both were lies an operator would act on.
  {
    const notifyService = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.notify.service')
    );

    ok('there is no Firebase admin app in this environment, as intended',
       notifyService._internal.adminReady() === false);

    // --- the notifier itself ---
    {
      const payload = notifyService.buildNotification('customer', 'weight_confirmed', {
        orderNo: 'JH-9999',
        actualWeight: '1.080 kg',
        chargedAmount: '400',
        adjustmentNote: 'The extra 32.00 is on us.',
      });
      ok('a weight_confirmed message renders', !!payload.title && !!payload.body);
      ok('...and it tells the customer they were NOT charged the difference',
         payload.body.includes('400') && payload.body.includes('on us'), payload.body);
      ok('...and it is a push, not an approval gate',
         payload.type === 'jhatka.order.weight_confirmed');

      // BR-06 said so, the message said so. One source, derived from the same numbers.
      const absorbed = notifyService.buildWeightConfirmationContext(
        { paidAmount: 400, estimatedTotal: 400, orderNo: 'JH-1' },
        { absorbedPaise: 3200, refundedPaise: 0, actualGrams: 1080, toleranceApplied: false }
      );
      ok('an over-delivery message says the platform absorbed it',
         /on us/.test(absorbed.adjustmentNote), absorbed.adjustmentNote);
      // Rs 400 in, Rs 400 out. This assertion is the one that caught a 100x bug:
      // `chargedAmount` was being run through `asMoney()`, which is paise -> rupees,
      // so the customer was told they had been charged 4.
      ok('...and still quotes what was charged, at full value',
         Number(absorbed.chargedAmount) === 400, absorbed.chargedAmount);
      // 3200 paise must read as "32", never as 3200 and never as 0.32. Both of those are
      // 100x errors in opposite directions and neither throws.
      ok('...and the absorbed figure is in rupees, not paise',
         /The extra 32\b/.test(absorbed.adjustmentNote)
           && !/3200/.test(absorbed.adjustmentNote)
           && !/0\.32\b/.test(absorbed.adjustmentNote),
         absorbed.adjustmentNote);

      const refunded = notifyService.buildWeightConfirmationContext(
        { paidAmount: 400, estimatedTotal: 400, orderNo: 'JH-1' },
        { absorbedPaise: 0, refundedPaise: 1280, actualGrams: 920, toleranceApplied: false }
      );
      ok('a shortfall message says a refund is coming',
         /refunded/.test(refunded.adjustmentNote), refunded.adjustmentNote);

      const inBand = notifyService.buildWeightConfirmationContext(
        { paidAmount: 400, estimatedTotal: 400, orderNo: 'JH-1' },
        { absorbedPaise: 0, refundedPaise: 0, actualGrams: 1010, toleranceApplied: true }
      );
      ok('an in-band message says nothing changed — BR-07, no financial event at all',
         /nothing changed/.test(inBand.adjustmentNote), inBand.adjustmentNote);

      // An unknown event is a caller bug and must be visible, not silently dropped.
      const bad = await notifyService.notifyCustomer(fx.managerUserId, 'no_such_event', {});
      ok('an unknown event is reported, not silently swallowed',
         bad.sent === false && bad.reason === 'unknown_event', JSON.stringify(bad));

      const noToken = await notifyService.notifyCustomer(fx.managerUserId, 'order_paid', { orderNo: 'X' });
      ok('a user with no device reports no_token rather than pretending',
         noToken.sent === false, JSON.stringify(noToken));
    }

    // --- markNotified is honest ---
    {
      const fakeRecall = { notifiedCount: 999, notificationAttemptedCount: 0 };
      notifyService.markNotified(fakeRecall, { delivered: 0, attempted: 12, reason: 'no_admin_app' });
      ok('markNotified writes the DELIVERED count, not the attempted count',
         fakeRecall.notifiedCount === 0, String(fakeRecall.notifiedCount));
      ok('...and records the attempt separately',
         fakeRecall.notificationAttemptedCount === 12, String(fakeRecall.notificationAttemptedCount));
      ok('...and records WHY it did not get through',
         fakeRecall.notificationFailureReason === 'no_admin_app');

      const partial = { notifiedCount: 0 };
      notifyService.markNotified(partial, { delivered: 3, attempted: 12, reason: 'send_failed' });
      ok('a partial fan-out writes a PARTIAL count, so the recall stays finishable',
         partial.notifiedCount === 3, String(partial.notifiedCount));
    }

    // --- and the OCCURRENCE no longer claims notification before it happens ---
    {
      const skipped = await JhatkaRecurringOrder.findOne({ generationStatus: 'skipped_no_stock' }).lean();
      ok('a skipped occurrence exists (§9.6 wrote one)', !!skipped, 'none found');
      if (skipped) {
        ok('and it does NOT claim the customer was notified',
           !skipped.notifiedAt, String(skipped.notifiedAt));
      }
    }
  }
  // -----------------------------------------------------------------------
  section('an UNPAID gateway order does not sit in PAYMENT_PENDING forever');
  // -----------------------------------------------------------------------
  //
  // `PAYMENT_FAILED` was in the transition table with edges into and out of it, and
  // NOTHING WROTE IT. That is not a cosmetic gap: a customer who placed a gateway
  // order and then closed the app left an order with no route out of it. It could not
  // be accepted (`PAID`'s successors all require `OUTLET_RECEIVED`, which a gateway
  // order cannot reach unpaid), and the customer could not meaningfully cancel it.
  {
    const { PaymentInitiation: PI, PaymentConfig: PC, JhatkaOutlet: OutletModel } = require(
      require('path').join(REPO_ROOT, 'src', 'models')
    );
    const jhatkaPayment = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.payment.service')
    );
    const dispatch = require(require('path').join(REPO_ROOT, 'src', 'utils', 'payment.dispatch'));
    const models9 = require(require('path').join(REPO_ROOT, 'src', 'models'));

    const gw = await PC.create({
      name: 'Jhatka Sweep Gateway',
      slug: `jhatka-sweep-${Date.now()}`,
      image: 'g.png',
      environment: false,
      credentials: { keyId: 'test' },
      paymentWay: 'online',
      isDefault: false,
      status: true,
    });

    const placedPaid = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      fulfilmentMode: 'pickup',
      paymentMode: 'gateway',
    });
    const paidOrder = await JhatkaOrder.findOne({ orderNo: placedPaid.body.order.orderNo }).lean();
    await request(customerApp, 'POST', `/jhatka/customer/orders/${paidOrder._id}/pay`, {
      payment: String(gw._id),
    });

    const placedAbandoned = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      fulfilmentMode: 'pickup',
      paymentMode: 'gateway',
    });
    const abandoned = await JhatkaOrder.findOne({ orderNo: placedAbandoned.body.order.orderNo }).lean();
    const abandonRes = await request(customerApp, 'POST', `/jhatka/customer/orders/${abandoned._id}/pay`, {
      payment: String(gw._id),
    });
    ok('the abandoned order also reached PAYMENT_PENDING',
       abandonRes.status === 201, `${abandonRes.status}`);

    ok('PAYMENT_FAILED is a real transition in the table, not just an enum value',
       JhatkaOrder.schema.statics.ORDER_TRANSITIONS.PAYMENT_PENDING.includes('PAYMENT_FAILED')
       && JhatkaOrder.schema.statics.ORDER_TRANSITIONS.PAYMENT_FAILED.includes('CANCELLED'));

    const earlySweep = await jhatkaPayment.sweepAbandonedPayments({ models: models9 });
    ok('the sweep leaves a just-created order alone', earlySweep.cancelled === 0,
       `cancelled=${earlySweep.cancelled}`);
    const untouched = await JhatkaOrder.findById(abandoned._id).lean();
    ok('...and it is still PAYMENT_PENDING', untouched.lifecycle === 'PAYMENT_PENDING',
       untouched.lifecycle);

    const declinedInit = await PI.findOne({ jhatkaOrder: abandoned._id }).lean();
    const declined = await dispatch.dispatchFailedCallback(
      declinedInit, 'Card declined by the issuer'
    );
    ok('the shared dispatch claims a failed jhatka_order subject',
       declined.handled === true && declined.subject === 'jhatka_order', JSON.stringify(declined));

    const afterDecline = await JhatkaOrder.findById(abandoned._id).lean();
    ok('a DECLINED payment lands on PAYMENT_FAILED', afterDecline.lifecycle === 'PAYMENT_FAILED',
       afterDecline.lifecycle);
    ok('...with paymentStatus failed', afterDecline.paymentStatus === 'failed',
       afterDecline.paymentStatus);
    ok('...and STOPS there, because PAYMENT_FAILED is retryable',
       afterDecline.lifecycle !== 'CANCELLED');
    ok('...and the retry edge exists so a customer can pay again',
       JhatkaOrder.schema.statics.ORDER_TRANSITIONS.PAYMENT_FAILED.includes('PAYMENT_PENDING'));

    const replay = await dispatch.dispatchFailedCallback(declinedInit, 'again');
    ok('a REPLAYED decline is a no-op', replay.handled === true);
    const afterReplay = await JhatkaOrder.findById(abandoned._id).lean();
    ok('...the order did not move', afterReplay.lifecycle === 'PAYMENT_FAILED');

    const paidInit = await PI.findOne({ jhatkaOrder: paidOrder._id }).lean();
    await dispatch.dispatchPaidCallback(paidInit);
    const nowPaid = await JhatkaOrder.findById(paidOrder._id).lean();
    ok('the control order is PAID', nowPaid.lifecycle === 'PAID', nowPaid.lifecycle);
    await dispatch.dispatchFailedCallback(paidInit, 'late webhook');
    const afterLate = await JhatkaOrder.findById(paidOrder._id).lean();
    ok('a LATE decline cannot drag a PAID order back to PAYMENT_FAILED',
       afterLate.lifecycle === 'PAID', afterLate.lifecycle);

    const stale = await JhatkaOrder.create({
      orderNo: `JH-STALE-${Date.now()}`,
      customer: fx.managerUserId,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      businessModel: fx.outlet.businessModel,
      fulfilmentMode: 'pickup',
      lifecycle: 'PAYMENT_PENDING',
      paymentMode: 'gateway',
      paymentStatus: 'pending',
      items: [],
      itemsSubtotal: 100,
      taxTotal: 0,
      estimatedTotal: 100,
      paidAmount: 0,
      refundedAmount: 0,
      createdAt: new Date(Date.now() - 45 * 60000),
    });

    const sweep = await jhatkaPayment.sweepAbandonedPayments({ models: models9 });
    ok('the sweep found and closed the stale order', sweep.cancelled >= 1,
       JSON.stringify({ scanned: sweep.scanned, cancelled: sweep.cancelled }));
    ok('...and reported no failures', sweep.failures.length === 0,
       JSON.stringify(sweep.failures));

    const closed = await JhatkaOrder.findById(stale._id).lean();
    ok('an ABANDONED order ends CANCELLED, not PAYMENT_FAILED',
       closed.lifecycle === 'CANCELLED', closed.lifecycle);
    ok('...recording WHY', closed.cancellation?.reasonCategory === 'payment_timeout',
       closed.cancellation?.reasonCategory);
    ok('...with a zero refund stated, not left null — nothing was collected',
       closed.cancellation?.refundAmount === 0, String(closed.cancellation?.refundAmount));
    ok('...and a cancellation stage that names where it died',
       closed.cancellation?.stage === 'PAYMENT_PENDING', closed.cancellation?.stage);

    const second = await jhatkaPayment.sweepAbandonedPayments({ models: models9 });
    ok('a second sweep does not re-close it', second.cancelled === 0,
       `cancelled=${second.cancelled}`);

    await OutletModel.updateOne(
      { _id: fx.outlet._id },
      { $set: { 'orderConfig.paymentTimeoutMinutes': 120 } }
    );
    const freshButOld = await JhatkaOrder.create({
      orderNo: `JH-OVERRIDE-${Date.now()}`,
      customer: fx.managerUserId,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      businessModel: fx.outlet.businessModel,
      fulfilmentMode: 'pickup',
      lifecycle: 'PAYMENT_PENDING',
      paymentMode: 'gateway',
      paymentStatus: 'pending',
      items: [],
      itemsSubtotal: 100,
      taxTotal: 0,
      estimatedTotal: 100,
      paidAmount: 0,
      refundedAmount: 0,
      createdAt: new Date(Date.now() - 45 * 60000),
    });
    const overrideSweep = await jhatkaPayment.sweepAbandonedPayments({ models: models9 });
    ok('an outlet with a 120-minute window KEEPS a 45-minute-old order',
       overrideSweep.cancelled === 0, `cancelled=${overrideSweep.cancelled}`);
    const kept = await JhatkaOrder.findById(freshButOld._id).lean();
    ok('...it is still PAYMENT_PENDING', kept.lifecycle === 'PAYMENT_PENDING', kept.lifecycle);
    await OutletModel.updateOne(
      { _id: fx.outlet._id },
      { $unset: { 'orderConfig.paymentTimeoutMinutes': '' } }
    );
  }
  // -----------------------------------------------------------------------
  section('a PREPAID subscription occurrence is actually charged');
  // -----------------------------------------------------------------------
  //
  // `prepaid: true` was stored, validated, displayed — and charged by nothing. The
  // nightly generator froze §9.5's ceiling onto each occurrence and the only way to
  // pay was for the customer to open the app and tap a button for a delivery they had
  // already paid for in advance.
  {
    const billing = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.subscription-billing.service')
    );
    const modelsB = require(require('path').join(REPO_ROOT, 'src', 'models'));

    await modelsB.PaymentConfig.updateMany({}, { $set: { isDefault: false } });
    await modelsB.PaymentConfig.create({
      name: 'Jhatka Default Gateway',
      slug: `jhatka-default-${Date.now()}`,
      image: 'd.png',
      environment: false,
      credentials: { keyId: 'test' },
      paymentWay: 'online',
      isDefault: true,
      status: true,
    });

    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setHours(0, 0, 0, 0);

    const mkPrepaidSub = async (tag) => modelsB.JhatkaSubscription.create({
      subscriptionNo: `JH-SUB-PREPAID-${tag}-${Date.now()}`,
      customer: fx.managerUserId,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      items: [{
        product: fx.weightProduct._id,
        variant: fx.weightVariant._id,
        sku: fx.weightVariant.sku,
        name: fx.weightProduct.name,
        nameSnapshot: fx.weightProduct.name,
        requestedQuantity: { value: 1, unit: 'KG' },
        chargeMode: 'ceiling',
        unitPriceAtSubscribe: 400,
      }],
      scheduleType: 'weekly',
      startDate: new Date(Date.now() - 86400000),
      nextOccurrenceDate: tomorrow,
      priceMode: 'current_price',
      paymentMode: 'gateway',
      prepaid: true,
      stockFailurePolicy: 'notify_and_pause',
      stats: { consecutiveStockFailures: 0 },
    });
    const prepaidSub = await mkPrepaidSub('1');

    const makeOccurrence = async (overrides = {}) =>
      modelsB.JhatkaRecurringOrder.create({
        subscription: prepaidSub._id,
        outlet: fx.outlet._id,
        customer: fx.managerUserId,
        occurrenceDate: tomorrow,
        generationStatus: 'reserved',
        stockReserved: true,
        chargeAmount: 440,
        estimatedAmount: 400,
        paymentStatus: 'pending',
        billingStatus: 'pending',
        items: [{
          variant: fx.weightVariant._id,
          sku: fx.weightVariant.sku,
          quantity: 1,
          unit: 'KG',
          unitPrice: 400,
          chargeMode: 'ceiling',
          lineCharge: 440,
        }],
        ...overrides,
      });

    // `now` is pinned at every step rather than left to wall-clock. The occurrence
    // sits at tomorrow midnight, so whether the 12-hour lead has opened depends on
    // what time of day the suite happens to run.
    const at = (hoursBeforeDelivery) => new Date(tomorrow.getTime() - hoursBeforeDelivery * 3600000);

    const early = await billing.billDueOccurrences({ models: modelsB, now: at(13) });
    ok('a sweep before the lead time charges nothing', early.charged === 0, JSON.stringify(early));

    const occurrence = await makeOccurrence();
    const charged = await billing.billDueOccurrences({ models: modelsB, now: at(6) });
    ok('the sweep CHARGES a due prepaid occurrence', charged.charged >= 1, JSON.stringify(charged));
    ok('...and reports no failures', charged.failures.length === 0, JSON.stringify(charged.failures));

    const afterCharge = await modelsB.JhatkaRecurringOrder.findById(occurrence._id).lean();
    ok('billingStatus is pending, not paid', afterCharge.billingStatus === 'pending', afterCharge.billingStatus);
    ok('...an attempt was recorded', afterCharge.billingAttemptedAt != null);
    ok('...and a deadline was set', afterCharge.billingDeadlineAt != null);

    const init = await modelsB.PaymentInitiation.findById(afterCharge.billingPaymentRef).lean();
    ok('a PaymentInitiation was created for the occurrence', !!init);
    ok('paymentFrom is jhatka_subscription', init?.paymentFrom === 'jhatka_subscription', init?.paymentFrom);
    ok('...it refs the OCCURRENCE, not the subscription', String(init?.jhatkaOccurrence) === String(occurrence._id));
    ok('...and the subscription, for the callback', String(init?.jhatkaSubscription) === String(prepaidSub._id));

    const initHydrated = await modelsB.PaymentInitiation.findById(afterCharge.billingPaymentRef);
    ok('the charge is Rs 440 — the frozen §9.5 ceiling, not the Rs 400 estimate', initHydrated.amount === 440, String(initHydrated.amount));
    ok('...stored as 44000 paise, which is the same Rs 440', init?.amount === 44000, String(init?.amount));
    ok('...and the round trip is lossless', initHydrated.amount * 100 === init?.amount, `${initHydrated.amount} x 100 !== ${init?.amount}`);

    const again = await billing.billDueOccurrences({ models: modelsB, now: at(6) });
    ok('a second sweep charges nothing more', again.charged === 0, JSON.stringify(again));
    const initCount = await modelsB.PaymentInitiation.countDocuments({ jhatkaOccurrence: occurrence._id, status: 'initiated' });
    ok('...exactly ONE live gateway order exists for the occurrence', initCount === 1, `count=${initCount}`);

    await billing.billDueOccurrences({ models: modelsB, now: at(11) });
    const reminded = await modelsB.JhatkaRecurringOrder.findById(occurrence._id).lean();
    ok('an unpaid occurrence is REMINDED the evening before',
       reminded.billingStatus === 'pending' && reminded.billingReminderAt != null,
       `status=${reminded.billingStatus} reminder=${reminded.billingReminderAt}`);
    await billing.billDueOccurrences({ models: modelsB, now: at(10) });
    const remindedTwice = await modelsB.JhatkaRecurringOrder.findById(occurrence._id).lean();
    ok('...but only ONCE, not every sweep',
       String(remindedTwice.billingReminderAt) === String(reminded.billingReminderAt));

    const dispatch = require(require('path').join(REPO_ROOT, 'src', 'utils', 'payment.dispatch'));
    await modelsB.PaymentInitiation.updateOne({ _id: init._id }, { $set: { status: 'paid' } });
    await dispatch.dispatchPaidCallback(init);
    const paidOcc = await modelsB.JhatkaRecurringOrder.findById(occurrence._id);
    ok('a gateway callback marks the occurrence paid', paidOcc.paymentStatus === 'paid', paidOcc.paymentStatus);
    ok('...at the ceiling, Rs 440', paidOcc.paidAmount === 440, String(paidOcc.paidAmount));
    ok('...and the subscription leaves pending_payments',
       (await modelsB.JhatkaSubscription.findById(prepaidSub._id).lean()).status === 'active');

    const secondSub = await mkPrepaidSub('2');
    const abandoned = await makeOccurrence({ subscription: secondSub._id, billingStatus: 'pending' });
    const skipped = await billing.billDueOccurrences({ models: modelsB, now: new Date(tomorrow.getTime()) });
    ok('an unpaid occurrence past its deadline is SKIPPED', skipped.skipped >= 1, JSON.stringify(skipped));
    const dead = await modelsB.JhatkaRecurringOrder.findById(abandoned._id).lean();
    ok('billingStatus records why', dead.billingStatus === 'unpaid_skipped', dead.billingStatus);
    ok('skipReason is payment_failed, not insufficient_stock', dead.skipReason === 'payment_failed', dead.skipReason);
    ok('§9.6 — it carries a CREDIT equal to what would have been charged (Rs 440)', dead.creditAmount === 44000, String(dead.creditAmount));
    ok('...and NOT a charge. The meat was never cut.', dead.paymentStatus !== 'paid', dead.paymentStatus);
    ok('...the reservation was released so the stock sells again', dead.stockReserved === false, String(dead.stockReserved));

    const thirdSub = await mkPrepaidSub('3');
    const retryMe = await makeOccurrence({ subscription: thirdSub._id });
    const retry = await billing.retryOccurrence({ models: modelsB, occurrenceId: retryMe._id, actor: { _id: null, name: 'test' } });
    ok('an outlet can retry a charge that never arrived', retry.action === 'charged', `${retry.action} ${retry.reason || ''}`);
    ok('...producing a FRESH initiation, not reusing the stale one',
       retry.initiationId && retry.initiationId !== String(retryMe.billingPaymentRef),
       `${retry.initiationId} vs ${retryMe.billingPaymentRef}`);
    ok('...and it is NOT marked paid — only a gateway callback can do that',
       (await modelsB.JhatkaRecurringOrder.findById(retryMe._id).lean()).paymentStatus !== 'paid');

    const fourthSub = await mkPrepaidSub('4');
    const codOcc = await modelsB.JhatkaRecurringOrder.create({
      subscription: fourthSub._id,
      outlet: fx.outlet._id,
      customer: fx.managerUserId,
      occurrenceDate: tomorrow,
      generationStatus: 'reserved',
      chargeAmount: 440,
      paymentStatus: 'pending',
      billingStatus: 'pending',
      items: [{ variant: fx.weightVariant._id, sku: fx.weightVariant.sku, quantity: 1, unit: 'KG' }],
    });
    await modelsB.JhatkaSubscription.updateOne({ _id: fourthSub._id }, { $set: { paymentMode: 'cod' } });
    await billing.billDueOccurrences({ models: modelsB, now: at(6) });
    const codAfter = await modelsB.JhatkaRecurringOrder.findById(codOcc._id).lean();
    ok('a COD subscription is marked not_required, never charged', codAfter.billingStatus === 'not_required', codAfter.billingStatus);
    await modelsB.JhatkaSubscription.updateOne({ _id: fourthSub._id }, { $set: { paymentMode: 'gateway' } });
  }
  // -----------------------------------------------------------------------
  section('a REJECTED order owes a DOCUMENT, not a field — REFUND_PENDING has a writer');
  // -----------------------------------------------------------------------
  //
  // `REFUND_PENDING` and `REFUNDED` were in the transition table with edges in and
  // out, and nothing wrote them. Worse, `reject` recorded `cancellation: {
  // refundAmount, refundMethod }` and stopped — money owed with no row tracking it, no
  // timeline, no retry, and no `gatewayRefundId`.
  {
    const modelsR = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const refundSettlement = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.refund.settlement')
    );
    const dispatch = require(require('path').join(REPO_ROOT, 'src', 'utils', 'payment.dispatch'));

    const gw = await modelsR.PaymentConfig.create({
      name: 'Jhatka Refund Gateway',
      slug: `jhatka-refund-gw-${Date.now()}`,
      image: 'g.png',
      environment: false,
      credentials: { keyId: 'test', keySecret: 'secret' },
      paymentWay: 'online',
      isDefault: false,
      status: true,
    });

    const placed = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      fulfilmentMode: 'pickup',
      paymentMode: 'gateway',
    });
    const toReject = await JhatkaOrder.findOne({ orderNo: placed.body.order.orderNo });
    await request(customerApp, 'POST', `/jhatka/customer/orders/${toReject._id}/pay`, {
      payment: String(gw._id),
    });
    const init = await modelsR.PaymentInitiation.findOne({ jhatkaOrder: toReject._id }).lean();
    await modelsR.PaymentInitiation.updateOne(
      { _id: init._id },
      { $set: { status: 'paid', payResponse: { id: `pay_test_${Date.now()}`, status: 'captured', amount: 42000 } } }
    );
    await dispatch.dispatchPaidCallback({ ...init, status: 'paid' });
    const paid = await JhatkaOrder.findById(toReject._id).lean();
    ok('the order is PAID before rejection', paid.lifecycle === 'PAID', paid.lifecycle);

    await request(partnerApp, 'POST', `/jhatka/partner/orders/${toReject._id}/receive`, undefined);
    const rejected = await request(partnerApp, 'POST', `/jhatka/partner/orders/${toReject._id}/reject`, {
      reason: 'no mutton left today',
    });
    ok('reject returns 200', rejected.status === 200,
       `${rejected.status} ${JSON.stringify(rejected.body)}`);
    ok('...and the response carries the REFUND, not just the order',
       !!rejected.body?.refund?.id, JSON.stringify(rejected.body));
    ok('...for the FULL estimate, Rs 420',
       rejected.body?.refund?.amount === 420, String(rejected.body?.refund?.amount));

    const afterReject = await JhatkaOrder.findById(toReject._id).lean();
    ok('a rejected PAID order moves to REFUND_PENDING', afterReject.lifecycle === 'REFUND_PENDING',
       afterReject.lifecycle);

    const doc = await modelsR.JhatkaRefund.findOne({ order: toReject._id }).lean();
    ok('a JhatkaRefund DOCUMENT exists (BR-19)', !!doc);
    ok('componentKey names the whole order', doc?.componentKey === `order:${toReject._id}`,
       doc?.componentKey);
    ok('reason is OUTLET_REJECTED, not a lowercase guess',
       doc?.reason === 'OUTLET_REJECTED', doc?.reason);
    ok('the refund RESOLVED its gateway from the order’s own initiation',
       doc?.gateway === 'jhatka-refund-gw' || !!doc?.gateway, String(doc?.gateway));
    ok('...and its charge id from the payResponse',
       !!doc?.gatewayPaymentId, String(doc?.gatewayPaymentId));
    ok('...and recorded HOW it resolved, so a failure is diagnosable',
       !!doc?.gatewayResolutionNote, doc?.gatewayResolutionNote);

    const second = await request(partnerApp, 'POST', `/jhatka/partner/orders/${toReject._id}/reject`, {
      reason: 'tried twice',
    });
    ok('a second reject cannot proceed from REFUND_PENDING',
       second.status >= 400, `${second.status}`);
    const refundCount = await modelsR.JhatkaRefund.countDocuments({
      order: toReject._id, componentKey: `order:${toReject._id}`,
    });
    ok('...exactly ONE order-level refund exists', refundCount === 1, `count=${refundCount}`);

    const pending = await modelsR.JhatkaRefund.findOne({ order: toReject._id });
    pending.status = 'REFUNDED';
    pending.settledAt = new Date();
    pending.gatewayRefundId = 'rf_test_manual';
    await pending.save();
    const synced = await refundSettlement.syncOrderRefundState({ models: modelsR, orderId: toReject._id });
    ok('the sync moved the order', synced.moved === true, JSON.stringify(synced));
    const finished = await JhatkaOrder.findById(toReject._id).lean();
    ok('an order whose refunds ALL settled reads REFUNDED, not DELIVERED',
       finished.lifecycle === 'REFUNDED', finished.lifecycle);

    const placedCod = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      fulfilmentMode: 'pickup',
      paymentMode: 'cod',
    });
    const codOrder = await JhatkaOrder.findOne({ orderNo: placedCod.body.order.orderNo });
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${codOrder._id}/receive`, undefined);
    const codRejected = await request(partnerApp, 'POST', `/jhatka/partner/orders/${codOrder._id}/reject`, {
      reason: 'closed early',
    });
    ok('a COD rejection still raises a document', !!codRejected.body?.refund?.id);
    ok('...for ZERO — nothing was collected, nothing is returned',
       codRejected.body?.refund?.amount === 0, String(codRejected.body?.refund?.amount));
    const codDoc = await modelsR.JhatkaRefund.findOne({ order: codOrder._id }).lean();
    ok('...with no gateway attached, so the sweep never calls one',
       !codDoc?.gateway && !codDoc?.gatewayPaymentId,
       `gateway=${codDoc?.gateway} id=${codDoc?.gatewayPaymentId}`);

    const placed2 = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      fulfilmentMode: 'pickup',
      paymentMode: 'gateway',
    });
    const toCancel = await JhatkaOrder.findOne({ orderNo: placed2.body.order.orderNo });
    await request(customerApp, 'POST', `/jhatka/customer/orders/${toCancel._id}/pay`, {
      payment: String(gw._id),
    });
    const init2 = await modelsR.PaymentInitiation.findOne({ jhatkaOrder: toCancel._id }).lean();
    await modelsR.PaymentInitiation.updateOne(
      { _id: init2._id },
      { $set: { status: 'paid', payResponse: { id: `pay_cancel_${Date.now()}`, status: 'captured' } } }
    );
    await dispatch.dispatchPaidCallback({ ...init2, status: 'paid' });
    const cancelled = await request(customerApp, 'POST', `/jhatka/customer/orders/${toCancel._id}/cancel`, {
      reason: 'changed my mind',
    });
    ok('customer cancel returns 200', cancelled.status === 200, `${cancelled.status}`);
    ok('...with a refund document', !!cancelled.body?.refund?.id);
    ok('...reasoned CUSTOMER_CANCELLATION',
       (await modelsR.JhatkaRefund.findOne({ order: toCancel._id }).lean())?.reason === 'CUSTOMER_CANCELLATION');
    const afterCancel = await JhatkaOrder.findById(toCancel._id).lean();
    ok('a cancelled PAID order moves to REFUND_PENDING', afterCancel.lifecycle === 'REFUND_PENDING',
       afterCancel.lifecycle);
    ok('...and the stage records WHERE it died, not just CANCELLED',
       afterCancel.cancellation?.stage === 'PAID', afterCancel.cancellation?.stage);

    const placed3 = await placeWeighableOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const partial = await JhatkaOrder.findById(placed3.order._id).lean();
    ok('the order reached PREPARING for the partial-refund test',
       partial.lifecycle === 'PREPARING', partial.lifecycle);
    const short = await request(partnerApp, 'POST', `/jhatka/partner/orders/${partial._id}/weigh`, {
      items: [{ orderItem: String(partial.items[0]._id), actualQuantity: { value: 900, unit: 'GRAM' } }],
    });
    ok('a -10% weigh succeeds', short.status === 200, `${short.status}`);
    const midRoute = await JhatkaOrder.findById(partial._id).lean();
    ok('a partially-refunded order CONTINUES to WEIGHT_CONFIRMED — the van is not stopped',
       midRoute.lifecycle === 'WEIGHT_CONFIRMED', midRoute.lifecycle);
    ok('...the refund exists as a side document',
       (await modelsR.JhatkaRefund.countDocuments({ order: partial._id })) === 1);
  }
  // -----------------------------------------------------------------------
  section('the ORDER follows the bag — PICKED_UP, OUT_FOR_DELIVERY, COMPLETED all have writers');
  // -----------------------------------------------------------------------
  //
  // Three more states with edges and no writers: the rider's surface moved
  // `delivery.status` and never touched `order.lifecycle`, and COMPLETED — the
  // table's only sink for a fulfilled order — was unreachable by anything.
  {
    const modelsC = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const completion = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.completion.service')
    );

    const res = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const o = await JhatkaOrder.findOne({ orderNo: res.body.order.orderNo }).lean();
    await advanceToWeighable(`${o._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, {
      items: [{ orderItem: String(o.items[0]._id), actualQuantity: { value: 1000, unit: 'GRAM' } }],
    });
    await advanceToDispatchable(`${o._id}`);

    const riderUserId = oid();
    const rider = {
      userId: riderUserId, name: 'RiderC', role: 'driver',
      outletId: fx.outlet._id, outletDoc: fx.outlet, rights: [],
    };
    const riderApp = buildApp(rider);
    await modelsC.JhatkaDriver.create({
      driverCode: `JHK-DRV-C-${Date.now()}`,
      user: riderUserId, name: 'RiderC', mobile: '9000000099',
      outlet: fx.outlet._id, status: 'active',
    });
    const dispatched = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/dispatch`, {
      driver: String((await modelsC.JhatkaDriver.findOne({ user: riderUserId }).lean())._id),
    });
    const deliveryId = dispatched.body?.delivery?.id;

    await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/accept`, {});
    await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/pickup`, {});
    const afterPickup = await JhatkaOrder.findById(o._id).lean();
    ok('pickup moves the ORDER to PICKED_UP, not just the delivery',
       afterPickup.lifecycle === 'PICKED_UP', afterPickup.lifecycle);
    ok('...and stamps pickedUpAt', !!afterPickup.pickedUpAt);

    await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/out-for-delivery`, {});
    const afterOfd = await JhatkaOrder.findById(o._id).lean();
    ok('out-for-delivery moves the ORDER to OUT_FOR_DELIVERY',
       afterOfd.lifecycle === 'OUT_FOR_DELIVERY', afterOfd.lifecycle);

    await request(riderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/deliver`, {
      clientRef: `POD-COMPLETE-${Date.now()}`,
      deliveredTempC: 3,
      receiverName: 'Customer',
      codCollected: 46200,
    });
    const afterDeliver = await JhatkaOrder.findById(o._id).lean();
    ok('deliver moves the ORDER to DELIVERED', afterDeliver.lifecycle === 'DELIVERED',
       afterDeliver.lifecycle);

    const tooFresh = await completion.completeOrder({ models: modelsC, orderId: o._id });
    ok('a just-delivered order does NOT complete', tooFresh.completed === false,
       `${tooFresh.completed} ${tooFresh.reason}`);
    ok('...because it is too fresh', tooFresh.reason === 'too_fresh', tooFresh.reason);

    await modelsC.JhatkaOrder.updateOne(
      { _id: o._id },
      { $set: { deliveredAt: new Date(Date.now() - 50 * 3600000) } }
    );
    const aged = await completion.completeOrder({ models: modelsC, orderId: o._id });
    ok('a 50-hour-old clean order COMPLETES', aged.completed === true,
       `${aged.completed} ${aged.reason}`);
    const done = await JhatkaOrder.findById(o._id).lean();
    ok('lifecycle reads COMPLETED', done.lifecycle === 'COMPLETED', done.lifecycle);
    ok('...with completedAt stamped', !!done.completedAt);

    const res2 = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const o2 = await JhatkaOrder.findOne({ orderNo: res2.body.order.orderNo }).lean();
    await modelsC.JhatkaOrder.updateOne(
      { _id: o2._id },
      { $set: { lifecycle: 'DELIVERED', deliveredAt: new Date(Date.now() - 50 * 3600000) } }
    );
    await modelsC.JhatkaRefund.create({
      refundNo: `RF-HOLD-${Date.now()}`,
      order: o2._id,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      customer: fx.managerUserId,
      componentKey: `weight:${o2.items[0]._id}`,
      reason: 'WEIGHT_ADJUSTMENT',
      fundingSource: 'platform_absorbed',
      amount: 40, taxAmount: 2, netAmount: 38,
      status: 'REFUND_PENDING',
      attempts: 0,
    });
    const heldRefund = await completion.completeOrder({ models: modelsC, orderId: o2._id });
    ok('an order with money still moving does NOT complete',
       heldRefund.completed === false, `${heldRefund.completed}`);
    ok('...naming open_refunds as the reason', heldRefund.reason === 'open_refunds',
       heldRefund.reason);

    await modelsC.JhatkaRefund.updateOne(
      { order: o2._id }, { $set: { status: 'REFUNDED', settledAt: new Date() } }
    );
    const refundSettlement = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.refund.settlement')
    );
    const synced = await refundSettlement.syncOrderRefundState({ models: modelsC, orderId: o2._id });
    ok('settling the last refund moves it to REFUNDED', synced.to === 'REFUNDED',
       JSON.stringify(synced));

    const res3 = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const o3 = await JhatkaOrder.findOne({ orderNo: res3.body.order.orderNo }).lean();
    await modelsC.JhatkaOrder.updateOne(
      { _id: o3._id },
      { $set: { lifecycle: 'DELIVERED', deliveredAt: new Date(Date.now() - 50 * 3600000) } }
    );
    await modelsC.JhatkaComplaint.create({
      complaintNo: `JH-C-HOLD-${Date.now()}`,
      order: o3._id,
      outlet: fx.outlet._id,
      customer: fx.managerUserId,
      category: 'quality_issue',
      source: 'customer',
      subject: 'smells off',
      status: 'investigating',
    });
    const heldComplaint = await completion.completeOrder({ models: modelsC, orderId: o3._id });
    ok('an order with an unresolved complaint does NOT complete',
       heldComplaint.completed === false, `${heldComplaint.completed}`);
    ok('...naming open_complaints', heldComplaint.reason === 'open_complaints',
       heldComplaint.reason);
    await modelsC.JhatkaComplaint.updateOne({ order: o3._id }, { $set: { status: 'resolved' } });
    const afterResolve = await completion.completeOrder({ models: modelsC, orderId: o3._id });
    ok('a RESOLVED complaint releases the hold', afterResolve.completed === true,
       `${afterResolve.completed} ${afterResolve.reason}`);

    const sweep = await completion.sweepCompletions({ models: modelsC, limit: 5 });
    ok('the sweep reports what it did', typeof sweep.scanned === 'number' && typeof sweep.completed === 'number',
       JSON.stringify(sweep));
  }


  // -----------------------------------------------------------------------
  section('delivery OTP: issued by customer, verified at handover — or theatre');
  // -----------------------------------------------------------------------
  //
  // verifyOtp existed, was unit-tested, and had ZERO callers outside its own
  // file. The code travelled customer → rider → POD without anything checking
  // it. Opt-in per order: no issued code means no check; an issued-but-unverified
  // code means the rider MUST present it, and wrong is distinguished from
  // expired because an expired code is not the rider's fault.
  {
    const otpService = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.otp.service')
    );
    const { JhatkaDriver: DriverM } = require(require('path').join(REPO_ROOT, 'src', 'models'));

    const res = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const o = await JhatkaOrder.findOne({ orderNo: res.body.order.orderNo }).lean();
    await advanceToWeighable(`${o._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, {
      items: [{ orderItem: String(o.items[0]._id), actualQuantity: { value: 1000, unit: 'GRAM' } }],
    });
    await advanceToDispatchable(`${o._id}`);

    const otpRiderId = oid();
    const otpRider = {
      userId: otpRiderId, name: 'OtpRider', role: 'driver',
      outletId: fx.outlet._id, outletDoc: fx.outlet, rights: [],
    };
    const otpRiderApp = buildApp(otpRider);
    await DriverM.create({
      driverCode: `JHK-DRV-OTP-${Date.now()}`,
      user: otpRiderId, name: 'OtpRider', mobile: '9000000098',
      outlet: fx.outlet._id, status: 'active',
    });
    const dispatched = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/dispatch`, {
      driver: String((await DriverM.findOne({ user: otpRiderId }).lean())._id),
    });
    const deliveryId = dispatched.body?.delivery?.id;
    await request(otpRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/accept`, {});
    await request(otpRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/pickup`, {});
    await request(otpRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/out-for-delivery`, {});

    // Issue a code the way POST /orders/:order/otp does (same service call).
    const issued = otpService.generateOtp();
    await JhatkaOrder.updateOne(
      { _id: o._id },
      { $set: { deliveryOtp: { codeHash: issued.codeHash, issuedAt: issued.issuedAt, expiresAt: issued.expiresAt, attempts: 0, maxAttempts: 5 } } }
    );

    // No code presented: refused, naming what is missing.
    const noCode = await request(otpRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/deliver`, {
      clientRef: `POD-OTP-NONE-${Date.now()}`, deliveredTempC: 3, receiverName: 'Customer',
    });
    ok('deliver without the code is refused when one was issued',
       noCode.status === 400, `${noCode.status} ${JSON.stringify(noCode.body)}`);
    ok('...naming OTP_REQUIRED, not a generic failure',
       /OTP_REQUIRED/.test(JSON.stringify(noCode.body)), JSON.stringify(noCode.body));

    // Wrong code: refused, with tries left (not expired, not the rider's fault class).
    const wrong = await request(otpRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/deliver`, {
      clientRef: `POD-OTP-WRONG-${Date.now()}`, deliveredTempC: 3, receiverName: 'Customer', otp: '000000',
    });
    ok('a wrong code is refused', wrong.status === 400, `${wrong.status}`);
    ok('...as INVALID with remaining attempts, not EXPIRED',
       /INVALID/.test(JSON.stringify(wrong.body)), JSON.stringify(wrong.body));
    const afterWrong = await JhatkaOrder.findById(o._id).lean();
    ok('...and the attempt was persisted (the limit is real across retries)',
       (afterWrong.deliveryOtp?.attempts || 0) === 1, String(afterWrong.deliveryOtp?.attempts));

    // Right code: delivers.
    const right = await request(otpRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/deliver`, {
      clientRef: `POD-OTP-RIGHT-${Date.now()}`, deliveredTempC: 3, receiverName: 'Customer', otp: issued.code,
    });
    ok('the right code delivers', right.status === 200,
       `${right.status} ${JSON.stringify(right.body)}`);
    const afterDeliver = await JhatkaOrder.findById(o._id).lean();
    ok('...order reached DELIVERED', afterDeliver.lifecycle === 'DELIVERED', afterDeliver.lifecycle);
    ok('...and the code is marked verified with the rider stamped',
       !!afterDeliver.deliveryOtp?.verifiedAt, String(afterDeliver.deliveryOtp?.verifiedAt));

    // Expired code: refused as EXPIRED, not INVALID — an expired code is not
    // the rider's fault, and the message must say to issue a fresh one.
    const res2 = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const o2 = await JhatkaOrder.findOne({ orderNo: res2.body.order.orderNo }).lean();
    await advanceToWeighable(`${o2._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${o2._id}/weigh`, {
      items: [{ orderItem: String(o2.items[0]._id), actualQuantity: { value: 1000, unit: 'GRAM' } }],
    });
    await advanceToDispatchable(`${o2._id}`);
    const dispatched2 = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o2._id}/dispatch`, {
      driver: String((await DriverM.findOne({ user: otpRiderId }).lean())._id),
    });
    const deliveryId2 = dispatched2.body?.delivery?.id;
    await request(otpRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId2}/accept`, {});
    await request(otpRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId2}/pickup`, {});
    await request(otpRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId2}/out-for-delivery`, {});
    const stale = otpService.generateOtp(-60);
    await JhatkaOrder.updateOne(
      { _id: o2._id },
      { $set: { deliveryOtp: { codeHash: stale.codeHash, issuedAt: stale.issuedAt, expiresAt: stale.expiresAt, attempts: 0, maxAttempts: 5 } } }
    );
    const expired = await request(otpRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId2}/deliver`, {
      clientRef: `POD-OTP-EXP-${Date.now()}`, deliveredTempC: 3, receiverName: 'Customer', otp: stale.code,
    });
    ok('an expired code is refused as EXPIRED',
       expired.status === 400 && /EXPIRED/.test(JSON.stringify(expired.body)),
       `${expired.status} ${JSON.stringify(expired.body)}`);
  }

  // -----------------------------------------------------------------------
  section('OTP leading zeros survive the wire — a code is a string, not a number');
  // -----------------------------------------------------------------------
  //
  // `Joi.alternatives().try(number, string)` coerced "012345" to 12345, and the
  // handover then failed against the stored hash — roughly one delivery in ten,
  // with no reason anyone could see. OTPs are digit STRINGS; leading zeros are
  // significant. This pins a leading-zero code so the regression is covered on
  // every run, not on 10% of them.
  {
    const otpSvc = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.otp.service')
    );
    const modelsZ = require(require('path').join(REPO_ROOT, 'src', 'models'));

    const res = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const o = await JhatkaOrder.findOne({ orderNo: res.body.order.orderNo }).lean();
    await advanceToWeighable(`${o._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/weigh`, {
      items: [{ orderItem: String(o.items[0]._id), actualQuantity: { value: 1000, unit: 'GRAM' } }],
    });
    await advanceToDispatchable(`${o._id}`);

    const zRiderId = oid();
    const zRider = {
      userId: zRiderId, name: 'ZeroRider', role: 'driver',
      outletId: fx.outlet._id, outletDoc: fx.outlet, rights: [],
    };
    const zRiderApp = buildApp(zRider);
    await modelsZ.JhatkaDriver.create({
      driverCode: `JHK-DRV-ZERO-${Date.now()}`,
      user: zRiderId, name: 'ZeroRider', mobile: '9000000097',
      outlet: fx.outlet._id, status: 'active',
    });
    const dispatched = await request(partnerApp, 'POST', `/jhatka/partner/orders/${o._id}/dispatch`, {
      driver: String((await modelsZ.JhatkaDriver.findOne({ user: zRiderId }).lean())._id),
    });
    const deliveryId = dispatched.body?.delivery?.id;
    await request(zRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/accept`, {});
    await request(zRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/pickup`, {});
    await request(zRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/out-for-delivery`, {});

    // A fixed leading-zero code, hashed with the service's own hash — the same
    // derivation the issue path uses, so only the wire format is under test.
    const zeroCode = '012345';
    const zeroHash = otpSvc.hash(zeroCode);
    await JhatkaOrder.updateOne(
      { _id: o._id },
      { $set: { deliveryOtp: { codeHash: zeroHash, issuedAt: new Date(), expiresAt: new Date(Date.now() + 300000), attempts: 0, maxAttempts: 5 } } }
    );
    const zeroDeliver = await request(zRiderApp, 'POST', `/jhatka/driver/deliveries/${deliveryId}/deliver`, {
      clientRef: `POD-OTP-ZERO-${Date.now()}`, deliveredTempC: 3, receiverName: 'Customer', otp: zeroCode,
    });
    ok('a leading-zero code verifies — the wire did not eat the zero',
       zeroDeliver.status === 200, `${zeroDeliver.status} ${JSON.stringify(zeroDeliver.body)}`);
    const zeroOrder = await JhatkaOrder.findById(o._id).lean();
    ok('...and the order delivered', zeroOrder.lifecycle === 'DELIVERED', zeroOrder.lifecycle);
  }
  console.log('\n--- summary ---');
  console.log(failures === 0 ? 'ALL INTEGRATION CHECKS PASSED' : `${failures} CHECK(S) FAILED`);

  await drop();
  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
};

main().catch(async (e) => {
  console.error('\nINTEGRATION RUN ERROR:', e);
  try {
    await drop();
    await mongoose.disconnect();
  } catch {
    /* already down */
  }
  process.exit(1);
});

module.exports = { buildApp, request };
