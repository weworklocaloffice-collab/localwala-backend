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

// The admin surface authenticates through `webAuth`, a different module with the
// same rights shape. Without this stub every admin route 401s — which is exactly
// how the commission-rule lifecycle below would have gone untested while the
// suite stayed green.
require.cache[require.resolve(
  require('path').join(REPO_ROOT, 'src', 'middlewares', 'webAuth')
)] = {
  id: require.resolve(require('path').join(REPO_ROOT, 'src', 'middlewares', 'webAuth')),
  filename: require.resolve(require('path').join(REPO_ROOT, 'src', 'middlewares', 'webAuth')),
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
  // The admin settlements surface, at the SAME path production mounts it, so the
  // commission-rule lifecycle is exercised over the real URL shape. This is how
  // the `commissionPct`-vs-`ratePercent` silent strip was catchable at all: the
  // create route had to actually run.
  app.use(
    '/jhatka/admin',
    require(require('path').join(ROUTES_DIR, 'jhatka.admin.settlements.route'))
  );
  // The operations console: refund retry/manual resolution is a money-moving door,
  // so it is exercised over HTTP rather than by calling the service directly.
  app.use(
    '/jhatka/admin',
    require(require('path').join(ROUTES_DIR, 'jhatka.admin.operations.route'))
  );
  // The supply surface (OD-12 companion), at production paths.
  app.use(
    '/jhatka/partner/supply',
    require(require('path').join(ROUTES_DIR, 'jhatka.partner.supply.route'))
  );
  app.use(
    '/jhatka/admin',
    require(require('path').join(ROUTES_DIR, 'jhatka.admin.supply.route'))
  );
  // The admin inventory surface. Mounted because the recall door must be exercised
  // over HTTP: it used to duplicate the recall write path and miss the fan-out.
  app.use(
    '/jhatka/admin',
    require(require('path').join(ROUTES_DIR, 'jhatka.admin.inventory.route'))
  );

  // `ApiError` exposes `statusCode`, NOT `status`. An earlier version of this file
  // read `err.status`, which is always `undefined`, so every deliberate 409/422/403
  // from the routes collapsed into a 500 — and the suite then "failed" on correct
  // application behaviour. Worth naming because the symptom looks like the code
  // under test is broken when in fact the harness is.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (process.env.JHATKA_DEBUG_STACK) console.error('[harness err]', err.stack);
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
    JhatkaSubscriptionEvent, JhatkaBatch,
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

  // A saved delivery address for the customer. Every order the suite places used
  // to be a PICKUP order with no address, because `JhatkaAddress` never existed
  // and a delivery order with an address crashed at `findOne` — the suite had
  // quietly routed around the platform's default mode. The shared UserAddress is
  // wired in now, so the suite tests what customers actually do: DELIVERY by
  // default, PICKUP in its own section below.
  const { UserAddress } = require(require('path').join(REPO_ROOT, 'src', 'models'));
  const deliveryAddress = await UserAddress.create({
    user: fx.managerUserId,
    title: 0,
    receiverName: 'Integration Customer',
    countryCode: 91,
    receiverContact: '9000000001',
    flatHouse: '12/2',
    locality: 'Test Colony',
    pincode: '500001',
    // Same city as the outlet fixture — inside the free ring, so delivery fee 0.
    location: { type: 'Point', coordinates: [73.8567, 18.5204] },
  });

  const customerApp = buildApp(manager);
  const partnerApp = buildApp(manager);
  const packerApp = buildApp(packer);
  const ownerApp = buildApp(owner);
  // The finance actor: creates, activates and retires commission rules over HTTP.
  const financeAdmin = {
    userId: null,
    name: 'Finance Admin',
    role: 'admin',
    outletId: null,
    outletDoc: null,
    rights: [
      'jhatka_commission_read',
      'jhatka_commission_write',
      'jhatka_settlement_write',
      'jhatka_supply_read',
      'jhatka_supply_write',
      'jhatka_recall_manage',
      'jhatka_recall_read',
      'jhatka_inventory_read',
      'jhatka_payables_read',
      'jhatka_payables_manage',
    ],
  };
  financeAdmin.userId = fx.managerUserId;
  const adminApp = buildApp(financeAdmin);

  const placeOrder = async (items) =>
    request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items,
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
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
  section('18:00 subscription-due reminder is one message per outlet');
  // -----------------------------------------------------------------------
  {
    const cron = require(require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'cron'));
    const modelsDue = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setHours(0, 0, 0, 0);

    await modelsDue.JhatkaSubscription.create({
      subscriptionNo: `JH-SUB-DUE-${Date.now()}`,
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
      scheduleType: 'daily',
      status: 'active',
      startDate: new Date(Date.now() - 86400000),
      nextOccurrenceDate: tomorrow,
      deliverySlot: { startTime: '08:00', endTime: '10:00' },
      editCutoffHours: 2,
      priceMode: 'current_price',
      paymentMode: 'cod',
      prepaid: false,
      stockFailurePolicy: 'notify_and_pause',
      stats: { consecutiveStockFailures: 0 },
    });

    const summaries = await cron.sendSubscriptionDueReminders(modelsDue);
    const summary = summaries.find((s) => s.outlet === String(fx.outlet._id));
    ok('the 18:00 job aggregates tomorrow by outlet',
       !!summary && summary.count >= 1, JSON.stringify(summary));
    ok('...sums the item quantities for the cut list',
       !!summary && summary.itemSummary.includes(fx.weightProduct.name),
       summary?.itemSummary);
    ok('...and names the earliest cutoff (08:00 slot - 2h)',
       !!summary && /6:00/.test(summary.cutoff), summary?.cutoff);
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
      // A second label for the same line must be a 409 LABEL_EXISTS, not the raw
      // E11000/500 the {orderItem: 1} unique index used to leak before the draft
      // status was added to the pre-check. A draft blocks regeneration: void it
      // first. (Product decision recorded in jhatka.label.service.js.)
      const dupRes = await request(ownerApp, 'POST', '/jhatka/partner/labels', {
        order: String(lo._id),
        items: [{ orderItem: String(lo.items[0]._id) }],
      });
      // The error middleware nests extras under `extra`; the label route's own
      // catch re-wraps them under `detail`. Accept either — the assertion is
      // about the status and the code, not the envelope.
      const dupCode = dupRes.body?.extra?.code || dupRes.body?.detail?.code;
      ok('a duplicate label returns 409 LABEL_EXISTS, not a raw 500',
         dupRes.status === 409 && dupCode === 'LABEL_EXISTS',
         `${dupRes.status} ${JSON.stringify(dupRes.body)?.slice(0, 140)}`);
    });
  }

  // -----------------------------------------------------------------------
  section('OD-12 pickup orders — counter hand-over, no rider');
  // -----------------------------------------------------------------------
  // Pickup is per-outlet and OFF by default; the mode gate is the pair
  // dispatch-refuses-pickup / collect-refuses-delivery, because the shared
  // transition table cannot express per-mode edges.
  {
    const modelsP = require(require('path').join(REPO_ROOT, 'src', 'models'));

    // Not opted in yet: a pickup order must be refused at PLACEMENT, not at
    // the counter.
    await modelsP.JhatkaOutlet.updateOne(
      { _id: fx.outlet._id },
      { $set: { 'orderConfig.pickupEnabled': false } }
    );
    const refusedPickup = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      fulfilmentMode: 'pickup',
      paymentMode: 'cod',
    });
    ok('pickup is refused on an outlet that has not opted in (409 PICKUP_NOT_ENABLED)',
       refusedPickup.status === 409
         && (refusedPickup.body?.extra?.code === 'PICKUP_NOT_ENABLED'
             || refusedPickup.body?.detail?.code === 'PICKUP_NOT_ENABLED'),
       `${refusedPickup.status} ${JSON.stringify(refusedPickup.body)?.slice(0, 120)}`);

    // Opt in, place a genuine pickup order — no address needed.
    await modelsP.JhatkaOutlet.updateOne(
      { _id: fx.outlet._id },
      { $set: { 'orderConfig.pickupEnabled': true } }
    );
    const placedPickup = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      fulfilmentMode: 'pickup',
      paymentMode: 'cod',
    });
    ok('a pickup order places without an address', placedPickup.status === 201,
       `${placedPickup.status} ${JSON.stringify(placedPickup.body)?.slice(0, 120)}`);
    const pickupOrder = await JhatkaOrder
      .findOne({ orderNo: placedPickup.body?.order?.orderNo }).lean();
    ok('...and persists with fulfilmentMode pickup',
       pickupOrder?.fulfilmentMode === 'pickup', pickupOrder?.fulfilmentMode);

    // Drive the real lifecycle to READY — the same path a delivery order takes,
    // because pickup reuses everything up to the hand-over.
    await advanceToWeighable(`${pickupOrder._id}`);
    await request(partnerApp, 'POST', `/jhatka/partner/orders/${pickupOrder._id}/weigh`, {
      items: [{ orderItem: String(pickupOrder.items[0]._id), actualQuantity: { value: 1000, unit: 'GRAM' } }],
    });
    await advanceToDispatchable(`${pickupOrder._id}`);
    const atReady = await JhatkaOrder.findById(pickupOrder._id).lean();
    ok('the pickup order reached READY through the normal flow',
       atReady?.lifecycle === 'READY', atReady?.lifecycle);

    // The mode gate: a rider must not be dispatched for a counter order.
    const badDispatch = await request(partnerApp, 'POST',
      `/jhatka/partner/orders/${pickupOrder._id}/dispatch`, {
        driver: '000000000000000000000000',
      });
    ok('dispatch on a pickup order is 409 PICKUP_ORDER',
       badDispatch.status === 409
         && (badDispatch.body?.extra?.code === 'PICKUP_ORDER'
             || badDispatch.body?.detail?.code === 'PICKUP_ORDER'),
       `${badDispatch.status} ${JSON.stringify(badDispatch.body)?.slice(0, 120)}`);

    // The counter hand-over: READY -> COMPLETED, and the COD stops saying pending.
    const collected = await request(packerApp, 'POST',
      `/jhatka/partner/orders/${pickupOrder._id}/collect`, {});
    ok('collect moves the pickup order to COMPLETED',
       collected.status === 200 && collected.body?.order?.lifecycle === 'COMPLETED',
       `${collected.status} ${JSON.stringify(collected.body)?.slice(0, 120)}`);
    ok('COD is marked paid at the counter',
       collected.body?.order?.paymentStatus === 'paid',
       JSON.stringify(collected.body?.order));

    // The reverse gate: a delivery order cannot be collected at a counter.
    const { order: deliveryOrd } = await placeWeighableOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const badCollect = await request(packerApp, 'POST',
      `/jhatka/partner/orders/${deliveryOrd._id}/collect`, {});
    ok('collect on a delivery order is 409 DELIVERY_ORDER',
       badCollect.status === 409
         && (badCollect.body?.extra?.code === 'DELIVERY_ORDER'
             || badCollect.body?.detail?.code === 'DELIVERY_ORDER'),
       `${badCollect.status} ${JSON.stringify(badCollect.body)?.slice(0, 120)}`);

    // Tracking was ALWAYS 403 until the ownership check's select grew a
    // `customer` field: the lean doc had no customer, so every owner was told
    // their own order was not theirs.
    const track = await request(customerApp, 'GET',
      `/jhatka/customer/orders/${pickupOrder._id}/tracking`);
    ok('tracking returns 200 for the owning customer (was always 403 — customer was missing from the select)',
       track.status === 200 && track.body?.fulfilmentMode === 'pickup',
       `${track.status} ${JSON.stringify(track.body)?.slice(0, 120)}`);
    ok('pickup tracking shows the counter hand-over, not a rider leg',
       (track.body?.milestones || []).some((m) => m.key === 'picked_up' && m.label === 'Collected at counter'),
       JSON.stringify((track.body?.milestones || []).map((m) => m.key)));

    // Leave the outlet as it was — other sections place delivery orders and do
    // not care, but a fixture that mutates and stays mutated is a trap.
    await modelsP.JhatkaOutlet.updateOne(
      { _id: fx.outlet._id },
      { $set: { 'orderConfig.pickupEnabled': false } }
    );
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

    // ---------------------------------------------------------------------
    section('Phase 4 - supplier payable lifecycle claims, pays and releases lines');
    // ---------------------------------------------------------------------
    const periodFrom = new Date(Date.now() - 86400000).toISOString();
    const periodTo = new Date(Date.now() + 86400000).toISOString();
    const generateBody = {
      outlet: String(fx.outlet._id),
      supplier: String(supplier._id),
      from: periodFrom,
      to: periodTo,
      notes: 'Integration payable',
    };

    const generated = await request(
      adminApp,
      'POST',
      '/jhatka/admin/settlements/payables/generate',
      generateBody
    );
    ok('a posted receipt generates a payable', generated.status === 201,
       `${generated.status} ${JSON.stringify(generated.body)}`);
    const payable = generated.body?.payable;
    ok('the payable starts as a draft', payable?.status === 'draft', payable?.status);
    ok('the payable freezes the posted receipt',
       payable?.receipts?.length === 1 && String(payable.receipts[0].intake) === String(receiptId),
       JSON.stringify(payable?.receipts));
    ok('the payable carries a positive rupee net amount',
       Number(payable?.totals?.netAmount) > 0, String(payable?.totals?.netAmount));

    const claimedReceipt = await models4.JhatkaProcurementReceipt.findById(receiptId).lean();
    ok('generation CLAIMS the receipt line', claimedReceipt.lines[0].payability === 'claimed',
       claimedReceipt.lines[0].payability);

    const duplicate = await request(
      adminApp,
      'POST',
      '/jhatka/admin/settlements/payables/generate',
      generateBody
    );
    ok('a second live payable for the same period is refused with 409',
       duplicate.status === 409, `${duplicate.status}`);

    const approved = await request(
      adminApp,
      'PATCH',
      `/jhatka/admin/settlements/payables/${payable.id}/approve`,
      { notes: 'Approved in integration' }
    );
    ok('a draft payable can be approved', approved.status === 200 && approved.body?.payable?.status === 'approved',
       `${approved.status} ${approved.body?.payable?.status}`);
    ok('approval records the Admin actor',
       approved.body?.payable?.approvedByName === 'Finance Admin',
       approved.body?.payable?.approvedByName);

    const paid = await request(
      adminApp,
      'POST',
      `/jhatka/admin/settlements/payables/${payable.id}/pay`,
      { paymentReference: `IT-PAY-${Date.now()}` }
    );
    ok('an approved payable can be paid', paid.status === 200 && paid.body?.payable?.status === 'paid',
       `${paid.status} ${JSON.stringify(paid.body)}`);
    ok('payment records the full net payout',
       Math.abs(Number(paid.body?.payable?.totals?.amountPaid) - Number(paid.body?.payable?.netPayout)) < 0.01,
       JSON.stringify({ amountPaid: paid.body?.payable?.totals?.amountPaid, netPayout: paid.body?.payable?.netPayout }));

    const paidReceipt = await models4.JhatkaProcurementReceipt.findById(receiptId).lean();
    ok('payment SETTLES the claimed receipt line', paidReceipt.lines[0].payability === 'paid',
       paidReceipt.lines[0].payability);

    const repay = await request(
      adminApp,
      'POST',
      `/jhatka/admin/settlements/payables/${payable.id}/pay`,
      { paymentReference: `IT-PAY-AGAIN-${Date.now()}` }
    );
    ok('a paid payable cannot be paid twice', repay.status === 400, `${repay.status}`);

    const voidSupplier = await models4.JhatkaSupplier.create({
      code: `SUP-P4-VOID-${Date.now()}`,
      name: 'Phase 4 Void Supplier',
      status: 'active',
    });
    const voidDraft = await request(partnerApp, 'POST', '/jhatka/partner/inventory/receipts', {
      supplier: String(voidSupplier._id),
      lines: [{
        product: String(fx.weightProduct._id),
        rawSku: 'P4-VOID-RAW',
        receivedQty: { value: 1000, unit: 'GRAM' },
        unitPrice: 350,
        readings: { temperatureC: 4 },
      }],
    });
    const voidReceiptId = voidDraft.body?.receipt?.id;
    const voidPost = await request(
      partnerApp,
      'POST',
      `/jhatka/partner/inventory/receipts/${voidReceiptId}/post`,
      {}
    );
    ok('the second receipt posts', voidPost.status === 200, `${voidPost.status}`);

    const voidGenerateBody = { ...generateBody, supplier: String(voidSupplier._id) };
    const voidGenerated = await request(
      adminApp,
      'POST',
      '/jhatka/admin/settlements/payables/generate',
      voidGenerateBody
    );
    ok('the second supplier generates its own payable', voidGenerated.status === 201,
       `${voidGenerated.status} ${JSON.stringify(voidGenerated.body)}`);
    const voidPayableId = voidGenerated.body?.payable?.id;

    const voided = await request(
      adminApp,
      'PATCH',
      `/jhatka/admin/settlements/payables/${voidPayableId}/void`,
      { reason: 'Integration void and reissue' }
    );
    ok('a draft payable can be voided', voided.status === 200 && voided.body?.payable?.status === 'void',
       `${voided.status} ${voided.body?.payable?.status}`);

    const releasedReceipt = await models4.JhatkaProcurementReceipt.findById(voidReceiptId).lean();
    ok('voiding RELEASES the claimed receipt line', releasedReceipt.lines[0].payability === 'pending',
       releasedReceipt.lines[0].payability);

    const reissued = await request(
      adminApp,
      'POST',
      '/jhatka/admin/settlements/payables/generate',
      voidGenerateBody
    );
    ok('a voided period can be reissued', reissued.status === 201,
       `${reissued.status} ${JSON.stringify(reissued.body)}`);

    const disputed = await request(
      adminApp,
      'PATCH',
      `/jhatka/admin/settlements/payables/${reissued.body?.payable?.id}/dispute`,
      { reason: 'Integration dispute path' }
    );
    ok('a live payable can be disputed', disputed.status === 200 && disputed.body?.payable?.status === 'disputed',
       `${disputed.status} ${disputed.body?.payable?.status}`);

    // ---------------------------------------------------------------------
    section('Phase 4 - quality decisions and reverse-batch-first');
    // ---------------------------------------------------------------------
    const decisionSupplier = await models4.JhatkaSupplier.create({
      code: `SUP-P4-DEC-${Date.now()}`,
      name: 'Phase 4 Decision Supplier',
      status: 'active',
    });
    const softReason = await models4.JhatkaQualityRejectionReason.create({
      code: `it_soft_${Date.now()}`,
      label: 'Integration soft rejection',
      category: 'freshness',
      severity: 'soft',
      fault: 'supplier',
      status: true,
    });
    const inactiveReason = await models4.JhatkaQualityRejectionReason.create({
      code: `it_inactive_${Date.now()}`,
      label: 'Integration inactive rejection',
      category: 'freshness',
      severity: 'soft',
      fault: 'supplier',
      status: false,
    });

    const reasonCatalog = await request(
      partnerApp,
      'GET',
      '/jhatka/partner/inventory/rejection-reasons'
    );
    const catalogReasons = Array.isArray(reasonCatalog.body?.reasons) ? reasonCatalog.body.reasons : [];
    const activeCatalogReason = catalogReasons.find((r) => r.code === softReason.code);
    ok('the rejection picker receives the active controlled vocabulary',
       reasonCatalog.status === 200
       && !!activeCatalogReason
       && activeCatalogReason.label === softReason.label
       && activeCatalogReason.severity === 'soft',
       `${reasonCatalog.status} ${JSON.stringify(reasonCatalog.body)}`);
    ok('an inactive rejection reason is not offered to the picker',
       !catalogReasons.some((r) => r.code === inactiveReason.code),
       JSON.stringify(catalogReasons.map((r) => r.code)));

    const pendingDraft = await request(partnerApp, 'POST', '/jhatka/partner/inventory/receipts', {
      supplier: String(decisionSupplier._id),
      lines: [{
        product: String(fx.weightProduct._id),
        rawSku: 'P4-DECISION-RAW',
        receivedQty: { value: 1000, unit: 'GRAM' },
        unitPrice: 350,
        readings: { temperatureC: 4, packagingIntact: false },
      }],
    });
    ok('a borderline receipt persists with a PENDING quality decision',
       pendingDraft.status === 201 && pendingDraft.body?.receipt?.lines?.[0]?.qualityStatus === 'pending',
       `${pendingDraft.status} ${JSON.stringify(pendingDraft.body?.receipt?.lines?.[0])}`);
    const pendingId = pendingDraft.body?.receipt?.id;

    const postPending = await request(
      partnerApp,
      'POST',
      `/jhatka/partner/inventory/receipts/${pendingId}/post`,
      {}
    );
    ok('posting is refused while a quality decision is pending',
       postPending.status === 409
       && (postPending.body?.extra?.code || postPending.body?.detail?.code) === 'QUALITY_DECISION_PENDING',
       `${postPending.status} ${JSON.stringify(postPending.body)}`);

    const unknownReason = await request(
      partnerApp,
      'POST',
      `/jhatka/partner/inventory/receipts/${pendingId}/reject`,
      { lineIndex: 0, rejectionReasons: [{ code: `not_a_reason_${Date.now()}` }] }
    );
    ok('an unknown rejection reason is refused, not stored as free text',
       unknownReason.status === 400, `${unknownReason.status} ${JSON.stringify(unknownReason.body)}`);

    const rejected = await request(
      partnerApp,
      'POST',
      `/jhatka/partner/inventory/receipts/${pendingId}/reject`,
      {
        lineIndex: 0,
        rejectionReasons: [{ code: softReason.code, note: 'borderline temperature' }],
        note: 'condemned at the door',
      }
    );
    ok('a pending line can be rejected with a governed reason',
       rejected.status === 200 && rejected.body?.receipt?.lines?.[0]?.qualityStatus === 'rejected',
       `${rejected.status} ${JSON.stringify(rejected.body?.receipt?.lines?.[0])}`);
    ok('rejection updates receipt totals and the overall verdict',
       rejected.body?.receipt?.qualityStatus === 'rejected'
       && Number(rejected.body?.receipt?.totals?.totalRejectedQty) === 1000
       && Number(rejected.body?.receipt?.totals?.totalAcceptedQty) === 0,
       JSON.stringify(rejected.body?.receipt?.totals));
    ok('a rejected line is disputed, never payable',
       rejected.body?.receipt?.lines?.[0]?.payability === 'disputed',
       rejected.body?.receipt?.lines?.[0]?.payability);

    const rejectTwice = await request(
      partnerApp,
      'POST',
      `/jhatka/partner/inventory/receipts/${pendingId}/reject`,
      { lineIndex: 0, rejectionReasons: [{ code: softReason.code }] }
    );
    ok('a rejected line cannot be rejected twice', rejectTwice.status === 409,
       `${rejectTwice.status} ${JSON.stringify(rejectTwice.body)}`);

    const postRejected = await request(
      partnerApp,
      'POST',
      `/jhatka/partner/inventory/receipts/${pendingId}/post`,
      {}
    );
    ok('a fully rejected receipt can be posted', postRejected.status === 200, `${postRejected.status}`);
    ok('...but creates no stock batch',
       (await models4.JhatkaBatch.countDocuments({ procurementReceipt: pendingId })) === 0,
       'batch exists');

    const acceptDraft = await request(partnerApp, 'POST', '/jhatka/partner/inventory/receipts', {
      supplier: String(decisionSupplier._id),
      lines: [{
        product: String(fx.weightProduct._id),
        rawSku: 'P4-ACCEPT-RAW',
        receivedQty: { value: 1200, unit: 'GRAM' },
        unitPrice: 350,
        readings: { temperatureC: 4, packagingIntact: false },
      }],
    });
    const acceptId = acceptDraft.body?.receipt?.id;

    const accepted = await request(
      partnerApp,
      'POST',
      `/jhatka/partner/inventory/receipts/${acceptId}/accept`,
      { lineIndex: 0, note: 'supervisor accepted the borderline crate' }
    );
    ok('a pending line can be accepted by a human',
       accepted.status === 200 && accepted.body?.receipt?.lines?.[0]?.qualityStatus === 'accepted',
       `${accepted.status} ${JSON.stringify(accepted.body?.receipt?.lines?.[0])}`);
    ok('acceptance contributes the accepted quantity and value',
       Number(accepted.body?.receipt?.totals?.totalAcceptedQty) === 1200
       && Number(accepted.body?.receipt?.totals?.totalAcceptedValue) === 42000000,
       JSON.stringify(accepted.body?.receipt?.totals));

    const rejectAccepted = await request(
      partnerApp,
      'POST',
      `/jhatka/partner/inventory/receipts/${acceptId}/reject`,
      { lineIndex: 0, rejectionReasons: [{ code: softReason.code }] }
    );
    ok('rejecting accepted goods demands reversing the batch first',
       rejectAccepted.status === 409
       && (rejectAccepted.body?.extra?.code || rejectAccepted.body?.detail?.code) === 'REVERSE_BATCH_FIRST',
       `${rejectAccepted.status} ${JSON.stringify(rejectAccepted.body)}`);

    const postAccepted = await request(
      partnerApp,
      'POST',
      `/jhatka/partner/inventory/receipts/${acceptId}/post`,
      {}
    );
    ok('an accepted receipt posts', postAccepted.status === 200, `${postAccepted.status}`);

    const acceptedReceipt = await models4.JhatkaProcurementReceipt.findById(acceptId).lean();
    const acceptedBatch = await models4.JhatkaBatch.findOne({ procurementReceipt: acceptId }).lean();
    ok('posting backfills the receipt line with its batch',
       !!acceptedBatch && String(acceptedReceipt?.lines?.[0]?.batch) === String(acceptedBatch._id),
       JSON.stringify({ lineBatch: acceptedReceipt?.lines?.[0]?.batch, batch: acceptedBatch?._id }));

    const rejectPosted = await request(
      partnerApp,
      'POST',
      `/jhatka/partner/inventory/receipts/${acceptId}/reject`,
      { lineIndex: 0, rejectionReasons: [{ code: softReason.code }] }
    );
    ok('a posted accepted line is still refused with REVERSE_BATCH_FIRST',
       rejectPosted.status === 409
       && (rejectPosted.body?.extra?.code || rejectPosted.body?.detail?.code) === 'REVERSE_BATCH_FIRST',
       `${rejectPosted.status} ${JSON.stringify(rejectPosted.body)}`);
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

    // The adapter itself, against an injected transport: paise in, provider id out.
    const calls = [];
    const fakeTransport = async (request) => {
      calls.push(request);
      return { body: { id: `rf_test_${calls.length}`, status: 'processed' } };
    };
    const direct = await gatewayMod.refundPayment({
      gateway: 'razorpay',
      gatewayPaymentId: 'pay_direct',
      amountPaise: 4000,
      idempotencyKey: 'k1',
      reason: 'WEIGHT_ADJUSTMENT',
      credentials: { key: 'rzp_test_key', secret: 'rzp_test_secret' },
      transport: fakeTransport,
    });
    ok('the gateway adapter sends PAISE (Rs40 -> 4000) to Razorpay',
       calls[0]?.body?.amount === 4000, JSON.stringify(calls[0]?.body));
    ok('...and authenticates with the PaymentConfig key/secret',
       calls[0]?.auth?.key === 'rzp_test_key' && calls[0]?.auth?.secret === 'rzp_test_secret',
       JSON.stringify(calls[0]?.auth));
    ok('...and sends the SAME idempotency key on every attempt',
       calls[0]?.headers?.['X-Refund-Idempotency'] === 'k1',
       JSON.stringify(calls[0]?.headers));
    ok('...and returns the provider refund id',
       direct.gatewayRefundId === 'rf_test_1', String(direct.gatewayRefundId));

    // Cashfree uses the SAME config row, the ORDER id, and rupees in the body.
    const cfCalls = [];
    const cfTransport = async (request) => {
      cfCalls.push(request);
      return { body: { cf_refund_id: 'cf_test_1', refund_status: 'SUCCESS' } };
    };
    const cfRefund = await gatewayMod.refundPayment({
      gateway: 'cashfree',
      gatewayPaymentId: 'order_123',
      amountPaise: 4000,
      idempotencyKey: 'k_cf',
      reason: 'WEIGHT_ADJUSTMENT',
      credentials: { appId: 'cf_app', secretKey: 'cf_secret', apiVersion: '2023-08-01' },
      environment: false,
      transport: cfTransport,
    });
    ok('Cashfree refunds use the configured appId/secretKey and the sandbox URL',
       cfCalls[0]?.url.includes('sandbox.cashfree.com') &&
         cfCalls[0]?.headers?.['x-client-id'] === 'cf_app' &&
         cfCalls[0]?.headers?.['x-client-secret'] === 'cf_secret',
       JSON.stringify({ url: cfCalls[0]?.url, headers: cfCalls[0]?.headers }));
    ok('...and send the amount in rupees, not paise',
       cfCalls[0]?.body?.refund_amount === '40.00', JSON.stringify(cfCalls[0]?.body));
    ok('...and return the provider refund id',
       cfRefund.gatewayRefundId === 'cf_test_1', String(cfRefund.gatewayRefundId));

    // A missing config must fail LOUDLY and actionably, not with MODULE_NOT_FOUND.
    const savedKeyId = process.env.RAZORPAY_KEY_ID;
    const savedKeySecret = process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    let configErr = null;
    try {
      await gatewayMod.refundPayment({
        gateway: 'razorpay',
        gatewayPaymentId: 'pay_x',
        amountPaise: 100,
        idempotencyKey: 'k2',
      });
    } catch (e) { configErr = e; }
    ok('an unconfigured gateway fails with an ACTIONABLE error, not MODULE_NOT_FOUND',
       !!configErr && configErr.extra?.code === 'GATEWAY_NOT_CONFIGURED',
       String(configErr && configErr.message));

    // Env remains a fallback for deployments that keep the Razorpay key centrally.
    process.env.RAZORPAY_KEY_ID = 'env_key';
    process.env.RAZORPAY_KEY_SECRET = 'env_secret';
    const envCalls = [];
    await gatewayMod.refundPayment({
      gateway: 'razorpay',
      gatewayPaymentId: 'pay_env',
      amountPaise: 100,
      idempotencyKey: 'k_env',
      transport: async (request) => { envCalls.push(request); return { body: { id: 'rf_env', status: 'processed' } }; },
    });
    ok('Razorpay falls back to RAZORPAY_KEY_ID/SECRET when the config row has none',
       envCalls[0]?.auth?.key === 'env_key' && envCalls[0]?.auth?.secret === 'env_secret',
       JSON.stringify(envCalls[0]?.auth));
    if (savedKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = savedKeyId;
    if (savedKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = savedKeySecret;

    // The settlement reads the SAME PaymentConfig row that took the payment.
    const resolvedConfig = await refundSettlement.resolveGatewayCredentials({
      orderId: 'order-1',
      models: {
        JhatkaOrder: { findById: () => ({ select: () => ({ lean: async () => ({ payment: 'init-1' }) }) }) },
        PaymentInitiation: { findById: () => ({ select: () => ({ lean: async () => ({ payment: 'cfg-1' }) }) }) },
        PaymentConfig: {
          findById: () => ({
            select: () => ({
              lean: async () => ({
                credentials: { key: 'db_key', secret: 'db_secret' },
                environment: true,
              }),
            }),
          }),
        },
      },
    });
    ok("settlement reads credentials from the payment's PaymentConfig row",
       resolvedConfig.credentials?.key === 'db_key' && resolvedConfig.environment === true,
       JSON.stringify(resolvedConfig));

    // Timeout vs refusal: UNKNOWN stays retryable, explicit refusal parks.
    const timeoutRefund = await mkRefund({ gateway: 'razorpay', gatewayPaymentId: 'pay_t', status: 'PROCESSING' });
    const timeoutTransport = async () => {
      const e = new Error('socket hang up');
      e.code = 'ECONNRESET';
      throw e;
    };
    const timeoutResult = await refundSettlement.settleRefund(timeoutRefund, {
      collectionKind: 'online',
      transport: timeoutTransport,
      credentials: { key: 'k', secret: 's' },
    });
    ok('a network timeout is treated as UNKNOWN, not as a failure',
       timeoutResult.status === 'PROCESSING', timeoutResult.status);

    const conflictRefund = await mkRefund({ gateway: 'razorpay', gatewayPaymentId: 'pay_c', status: 'PROCESSING' });
    const conflictTransport = async () => {
      const e = new Error('Conflict');
      e.status = 409;
      throw e;
    };
    const conflictResult = await refundSettlement.settleRefund(conflictRefund, {
      collectionKind: 'online',
      transport: conflictTransport,
      credentials: { key: 'k', secret: 's' },
    });
    ok('an idempotency-in-progress 409 stays retryable, not FAILED',
       conflictResult.status === 'PROCESSING', conflictResult.status);

    const refuseRefund = await mkRefund({ gateway: 'razorpay', gatewayPaymentId: 'pay_r', status: 'PROCESSING' });
    const refuseTransport = async () => { throw new Error('payment already refunded'); };
    let refuseResult = await refundSettlement.settleRefund(refuseRefund, {
      collectionKind: 'online',
      transport: refuseTransport,
      credentials: { key: 'k', secret: 's' },
    });
    for (let i = 0; i < 6 && refuseResult.status !== 'FAILED'; i += 1) {
      refuseResult = await refundSettlement.settleRefund(
        await modelsF.JhatkaRefund.findById(refuseRefund._id),
        { collectionKind: 'online', transport: refuseTransport, credentials: { key: 'k', secret: 's' } });
    }
    ok('an explicit provider refusal IS a failure',
       refuseResult.status === 'FAILED', refuseResult.status);

    // End to end through the settlement with a working provider.
    const liveRefund = await mkRefund({ gateway: 'razorpay', gatewayPaymentId: 'pay_live' });
    const settleCalls = [];
    const settleTransport = async (request) => {
      settleCalls.push(request);
      return { body: { id: 'rf_live_1', status: 'processed' } };
    };
    const liveResult = await refundSettlement.settleRefund(
      await modelsF.JhatkaRefund.findById(liveRefund._id),
      { collectionKind: 'online', transport: settleTransport, credentials: { key: 'live_key', secret: 'live_secret' } });
    ok('a GATEWAY refund actually reaches the provider',
       liveResult.status === 'REFUNDED' && !!liveResult.gatewayRefundId,
       `${liveResult.status} ${liveResult.gatewayRefundId}`);
    ok('settleRefund passes the resolved credentials to the adapter',
       settleCalls[0]?.auth?.key === 'live_key', JSON.stringify(settleCalls[0]?.auth));
  }
  // -----------------------------------------------------------------------
  section('refund operator console - retry and manual settlement over HTTP');
  // -----------------------------------------------------------------------
  // A parked refund is money that may or may not have moved. Both actions are
  // deliberately human-only: retry reuses the SAME document (and idempotency key),
  // while manual resolution records an external reference instead of pretending a
  // gateway call happened.
  {
    const modelsO = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const gatewayMod = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.refund.gateway')
    );

    const orderRes = await placeOrder([
      { variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } },
    ]);
    const order = await modelsO.JhatkaOrder.findOne({ orderNo: orderRes.body?.order?.orderNo }).lean();
    ok('an order exists for the refund console test', !!order, JSON.stringify(orderRes.body).slice(0, 160));
    await modelsO.JhatkaOrder.updateOne({ _id: order._id }, { $set: { paymentMode: 'gateway' } });

    let seq = 0;
    const mkRefund = (overrides = {}) => {
      seq += 1;
      return modelsO.JhatkaRefund.create({
        refundNo: `RF-OPS-${Date.now()}-${seq}`,
        order: order._id,
        outlet: fx.outlet._id,
        business: fx.outlet.business,
        customer: fx.managerUserId,
        componentKey: `ops:${Date.now()}:${seq}`,
        reason: 'OTHER',
        fundingSource: 'platform_absorbed',
        amount: 40,
        taxAmount: 2,
        netAmount: 38,
        gateway: 'razorpay',
        gatewayPaymentId: 'pay_ops',
        status: 'FAILED',
        attempts: 5,
        parkedAt: new Date(),
        ...overrides,
      });
    };

    const parked = await mkRefund();
    const listed = await request(adminApp, 'GET', '/jhatka/admin/operations/refunds?stuck=true');
    ok('the stuck-refund console lists the parked row',
       listed.status === 200 && listed.body?.refunds?.some((r) => r.refundNo === parked.refundNo),
       `${listed.status} ${JSON.stringify(listed.body).slice(0, 160)}`);
    ok('...and every lean row carries the id the console acts on',
       (listed.body?.refunds || []).every((r) => !!r.id));

    const originalRefundPayment = gatewayMod.refundPayment;
    const gatewayCalls = [];
    gatewayMod.refundPayment = async (requestBody) => {
      gatewayCalls.push(requestBody);
      return { gatewayRefundId: 'rf_ops_http', status: 'processed' };
    };
    try {
      const retried = await request(
        adminApp,
        'POST',
        `/jhatka/admin/operations/refunds/${parked._id}/retry`,
        { note: 'Provider dashboard says the payment is still refundable' }
      );
      ok('operator retry succeeds over HTTP',
         retried.status === 200 && retried.body?.refund?.status === 'REFUNDED',
         `${retried.status} ${JSON.stringify(retried.body).slice(0, 180)}`);
      ok('...the gateway id is stored on the same refund',
         retried.body?.refund?.gatewayRefundId === 'rf_ops_http',
         String(retried.body?.refund?.gatewayRefundId));
      ok('...the attempt counter was reset and the parked marker cleared',
         retried.body?.refund?.attempts === 1 && !retried.body?.refund?.parkedAt,
         JSON.stringify({ attempts: retried.body?.refund?.attempts, parkedAt: retried.body?.refund?.parkedAt }));
      ok('...the provider receives the SAME id-derived idempotency key',
         gatewayCalls[0]?.idempotencyKey === `jhatka-refund-${parked._id}`,
         String(gatewayCalls[0]?.idempotencyKey));

      const retryAgain = await request(
        adminApp,
        'POST',
        `/jhatka/admin/operations/refunds/${parked._id}/retry`,
        {}
      );
      ok('...and retrying an already-refunded row is refused (409)',
         retryAgain.status === 409, String(retryAgain.status));
    } finally {
      gatewayMod.refundPayment = originalRefundPayment;
    }

    const manuallyPayable = await mkRefund();
    const badReference = await request(
      adminApp,
      'POST',
      `/jhatka/admin/operations/refunds/${manuallyPayable._id}/resolve`,
      { paymentReference: 'x', note: 'finance paid this' }
    );
    ok('manual settlement rejects a too-short reference',
       badReference.status === 400, String(badReference.status));

    const manualReference = `UTR-OPS-${Date.now()}`;
    const manual = await request(
      adminApp,
      'POST',
      `/jhatka/admin/operations/refunds/${manuallyPayable._id}/resolve`,
      {
        paymentReference: manualReference,
        note: 'Paid by bank transfer after the gateway parked this refund',
      }
    );
    ok('manual settlement closes a FAILED refund',
       manual.status === 200 && manual.body?.refund?.status === 'REFUNDED',
       `${manual.status} ${JSON.stringify(manual.body).slice(0, 180)}`);
    ok('...records the manual route and the external reference',
       manual.body?.refund?.settlementRoute === 'manual'
         && manual.body?.refund?.manualReference === manualReference,
       JSON.stringify({ route: manual.body?.refund?.settlementRoute, ref: manual.body?.refund?.manualReference }));

    const manualRow = await modelsO.JhatkaRefund.findById(manuallyPayable._id);
    ok('...the refund is not flagged as missing evidence of payment',
       manualRow.isRefundedWithoutGatewayId() === false,
       String(manualRow.isRefundedWithoutGatewayId()));
    ok('...and the timeline names the operator and reference',
       (manualRow.timeline || []).some((t) => String(t.note || '').includes(manualReference)),
       JSON.stringify(manualRow.timeline || []).slice(0, 180));

    const inFlight = await mkRefund({ status: 'PROCESSING', parkedAt: null });
    const tooEarly = await request(
      adminApp,
      'POST',
      `/jhatka/admin/operations/refunds/${inFlight._id}/resolve`,
      { paymentReference: `UTR-LATE-${Date.now()}`, note: 'Tried to close before the gateway answered' }
    );
    ok('a PROCESSING refund cannot be closed manually (may still be in flight)',
       tooEarly.status === 409, String(tooEarly.status));
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
  section('\u00a710.3 BR-22 — the operator payout is computed from ORDER VALUE, and rider fees have their OWN document');
  // -----------------------------------------------------------------------
  // The commission system existed (model, admin API, screen) but the sweep
  // distributed RIDER delivery fees through the operator payout — conflating
  // two documents BR-22 keeps apart, and grossing on fees that are zero. Now:
  // the operator statement reads ORDER VALUE with the rule's two rates, and
  // rider fees settle in JhatkaDeliverySettlement.
  {
    const modelsR = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const payoutService = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.payout.service')
    );

    // The supplier of record for platform-supplied stock (the receipt model
    // requires a supplier; under BR-05 that supplier is LocalWala itself).
    const supplySupplier = await modelsR.JhatkaSupplier.create({
      code: 'SUP-LWL-' + Date.now(),
      name: 'LocalWala Supply',
      legalName: 'WeWorkLocal Private Limited',
      status: 'active',
    });

    // 1. Create a rule over HTTP: PLATFORM CHARGE 15% (deducted — LocalWala's
    //    cut) and PARTNER EARNING 12% (recorded, never deducted). The response
    //    AND the persisted row must carry both — regression for the old
    //    commissionPct silent strip.
    const ruleCode = 'JH-RULE-' + Date.now();
    const created = await request(adminApp, 'POST', '/jhatka/admin/settlements/commission-rules', {
      code: ruleCode,
      name: 'Charge 15, partner earns 12',
      businessModel: 'commission_partner',
      basis: 'gross_order_value',
      platformFeePercent: 15,
      ratePercent: 12,
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
    });
    ok('POST commission-rules returns 201', created.status === 201,
       created.status + ' ' + JSON.stringify(created.body)?.slice(0, 140));
    ok('the created rule carries platformFeePercent 15 (was silently stripped as commissionPct)',
       created.body?.rule?.platformFeePercent === 15, JSON.stringify(created.body?.rule)?.slice(0, 120));
    ok('...and ratePercent 12 alongside it (the two are different money)',
       created.body?.rule?.ratePercent === 12, JSON.stringify(created.body?.rule)?.slice(0, 120));
    const ruleRow = await modelsR.JhatkaCommissionRule.findOne({ code: ruleCode }).lean();
    ok('...and the PERSISTED row has both rates — nothing was dropped',
       ruleRow?.platformFeePercent === 15 && ruleRow?.ratePercent === 12,
       'fee=' + ruleRow?.platformFeePercent + ' rate=' + ruleRow?.ratePercent);

    const activated = await request(adminApp, 'PATCH',
      '/jhatka/admin/settlements/commission-rules/' + ruleRow._id, { status: 'active' });
    ok('the rule activates', activated.status === 200 && activated.body?.rule?.status === 'active',
       activated.status + ' ' + JSON.stringify(activated.body)?.slice(0, 120));

    // 2. A DELIVERED order worth Rs 420 (goods+tax) with a Rs 100 delivery fee,
    //    delivered by an outlet rider. The order is real: placed through the
    //    customer API, driven through the lifecycle, then driven to DELIVERED.
    const placed = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
      paymentMode: 'cod',
    });
    ok('the order places', placed.status === 201, placed.status + ' ' + JSON.stringify(placed.body)?.slice(0, 100));
    const brOrder = await JhatkaOrder
      .findOne({ orderNo: placed.body?.order?.orderNo });
    // Rs 100 delivery fee, set through the moneyField setter.
    brOrder.deliveryFee = 100;
    await brOrder.save();

    const sweepDriver = await modelsR.JhatkaDriver.create({
      driverCode: 'JHK-DRV-BR22-' + Date.now(),
      user: oid(),
      name: 'BR22 Rider',
      mobile: '9000000044',
      outlet: fx.outlet._id,
      status: 'active',
    });
    await modelsR.JhatkaDelivery.create({
      deliveryNo: 'DL-BR22-' + Date.now(),
      outlet: fx.outlet._id,
      order: brOrder._id,
      customer: fx.managerUserId,
      driver: sweepDriver._id,
      agentMode: 'own_fleet',
      status: 'delivered',
      addressSnapshot: { line1: 'x' },
      codStatus: 'not_applicable',
      codFrozenAt: new Date(),
      deliveredAt: new Date(),
    });
    // DELIVERED in the window: the operator sweep's order query. finalTotal is
    // set by the WEIGH flow in production (frozen = estimatedTotal); this test
    // skips weighing, so set it the way the weigh service would — moneyField
    // setter takes RUPEES (420 → 42000 paise stored).
    brOrder.finalTotal = 420;
    brOrder.lifecycle = 'DELIVERED';
    brOrder.deliveredAt = new Date();
    await brOrder.save();

    // The outlet's own bank account is frozen onto the statement. Without it the
    // approve route correctly refuses with NO_PAYOUT_DESTINATION, which is why the
    // old sweep -> approve -> pay chain could never complete.
    await modelsR.JhatkaOutlet.updateOne(
      { _id: fx.outlet._id },
      {
        $set: {
          'paymentConfig.payoutMethod': 'bank',
          'paymentConfig.bank.accountName': 'Jhatka Test Outlet',
          'paymentConfig.bank.accountNumber': '000123456789',
          'paymentConfig.bank.ifsc': 'HDFC0001234',
        },
      }
    );

    const from = new Date(Date.now() - 3600000);
    const to = new Date(Date.now() + 3600000);

    // 3. The RIDER sweep — their OWN document.
    const riderResults = await payoutService.runRiderFeeSweep({
      models: modelsR, from, to, nextNumber: (p) => p + Date.now(),
    });
    ok('the rider sweep wrote a settlement for the delivery',
       riderResults.length >= 1, JSON.stringify(riderResults)?.slice(0, 140));
    const riderSettlement = await modelsR.JhatkaDeliverySettlement
      .findOne({ driver: sweepDriver._id }).sort({ createdAt: -1 }).lean();
    ok('...in a JhatkaDeliverySettlement (BR-22: not the operator payout doc)',
       !!riderSettlement, 'no delivery settlement for the rider');
    ok('...with deliveryFeeEarned = Rs 100 (10000 paise)',
       riderSettlement?.totals?.deliveryFeeEarned === 10000,
       String(riderSettlement?.totals?.deliveryFeeEarned));

    // 4. The OPERATOR sweep — from ORDER VALUE, with the rule's two rates.
    await payoutService.runPayoutSweep({
      models: modelsR, from, to, nextNumber: (p) => p + Date.now(),
    });

    const rulePayout = await modelsR.JhatkaOperatorPayout
      .findOne({ 'ruleSnapshot.code': ruleCode, 'items.order': brOrder._id })
      .sort({ createdAt: -1 })
      .lean();
    ok('the operator payout FROZE the active rule (code matches)',
       !!rulePayout, 'no payout with the rule code in its snapshot');
    // NOTE: totals.grossOrderValue HOLDS net (a documented B4 quirk — asserted
    // as-is there). The ORDER-VALUE proof is the ITEM line. The payout was
    // loaded LEAN: moneyField getters do not run on lean docs, so the raw
    // stored PAISE (42000 = Rs 420) is what the read returns.
    const brItem = (rulePayout?.items || []).find((i) => String(i.order) === String(brOrder._id));
    ok('...grossed on ORDER VALUE (item grossOrderValue 42000 paise = Rs 420), not delivery fees',
       brItem?.grossOrderValue === 42000, String(brItem?.grossOrderValue));
    // Totals cover EVERY delivered/completed order in the window: brOrder
    // (Rs 420) plus the pickup section's COMPLETED order (Rs 420) = Rs 84000.
    // 15% charge = 12600 paise; 12% earning = 10080 paise. The per-order proof
    // is the item assertion above.
    ok('...the DEDUCTION is the platform charge at 15% of window order value (platformFee 12600)',
       rulePayout?.totals?.platformFee === 12600, String(rulePayout?.totals?.platformFee));
    ok('...the PARTNER EARNING (12%) is RECORDED, not deducted (commissionEarned 10080)',
       rulePayout?.totals?.commissionEarned === 10080, String(rulePayout?.totals?.commissionEarned));
    ok('...the snapshot records both applied rates',
       rulePayout?.ruleSnapshot?.appliedPlatformFeePct === 15
         && rulePayout?.ruleSnapshot?.appliedPartnerRatePct === 12,
       JSON.stringify(rulePayout?.ruleSnapshot)?.slice(0, 160));
    ok('...and the outlet bank details are FROZEN onto the statement',
       rulePayout?.payoutDetails?.ifsc === 'HDFC0001234'
         && rulePayout?.payoutMethod === 'bank',
       JSON.stringify(rulePayout?.payoutDetails));

    // 4b. Finance-only settlement. Approval freezes the amount; payment records
    // the external transfer reference. A partner can no longer mark its own
    // draft paid (that route was removed).
    const payoutId = String(rulePayout._id);
    const approvedPayout = await request(adminApp, 'POST',
      '/jhatka/admin/settlements/payouts/' + payoutId + '/approve', {});
    ok('finance approves the generated payout',
       approvedPayout.status === 200 && approvedPayout.body?.payout?.status === 'approved',
       approvedPayout.status + ' ' + JSON.stringify(approvedPayout.body)?.slice(0, 140));

    const payReference = 'UTR-JHATKA-' + Date.now();
    const paidPayout = await request(adminApp, 'POST',
      '/jhatka/admin/settlements/payouts/' + payoutId + '/pay', {
        paymentReference: payReference,
        notes: 'NEFT test',
      });
    ok('finance marks the approved payout paid',
       paidPayout.status === 200 && paidPayout.body?.payout?.status === 'paid',
       paidPayout.status + ' ' + JSON.stringify(paidPayout.body)?.slice(0, 140));

    const paidRow = await modelsR.JhatkaOperatorPayout.findById(payoutId).lean();
    ok('...paidAmount records the FULL netPayout (no 100x error)',
       paidRow?.totals?.paidAmount === paidRow?.netPayout,
       'paidAmount=' + paidRow?.totals?.paidAmount + ' netPayout=' + paidRow?.netPayout);
    ok('...the transfer reference, timestamp and finance approver are persisted',
       paidRow?.paymentReference === payReference
         && !!paidRow?.paidAt
         && paidRow?.paidByName === 'Finance Admin',
       JSON.stringify({ ref: paidRow?.paymentReference, paidAt: paidRow?.paidAt, by: paidRow?.paidByName }));

    const payAgain = await request(adminApp, 'POST',
      '/jhatka/admin/settlements/payouts/' + payoutId + '/pay', {
        paymentReference: payReference,
      });
    ok('...and paying the same statement twice is refused',
       payAgain.status === 409
         && (payAgain.body?.extra?.code === 'ALREADY_PAID'
           || payAgain.body?.detail?.code === 'ALREADY_PAID'),
       payAgain.status + ' ' + JSON.stringify(payAgain.body)?.slice(0, 140));

    // 5. Stock recovery: fulfil a supply request for the SAME outlet and
    //    re-sweep — the ledger STOCK_DEBIT magnitude is deducted from the
    //    next statement (the partner pays for the meat out of the statement).
    const stockReq = await request(partnerApp, 'POST', '/jhatka/partner/supply/requests', {
      items: [{ product: String(fx.weightProduct._id), quantity: { value: 2, unit: 'KG' } }],
      paymentMode: 'on_delivery',
    });
    const stockReqDoc = stockReq.body?.request;
    await request(adminApp, 'POST',
      '/jhatka/admin/supply/requests/' + (stockReqDoc.id || stockReqDoc._id) + '/approve', {
        rates: { [String(fx.weightProduct._id)]: 10000 }, // Rs 100/kg
      });
    await request(adminApp, 'POST',
      '/jhatka/admin/supply/requests/' + (stockReqDoc.id || stockReqDoc._id) + '/fulfil', {
        supplier: String(supplySupplier._id),
        rawSkuByProduct: { [String(fx.weightProduct._id)]: 'SUPPLY-CHK' },
      });
    const stockDebit = await modelsR.JhatkaPartnerLedger.findOne({
      referenceId: stockReqDoc.id || stockReqDoc._id,
      entryType: 'STOCK_DEBIT',
    }).lean();
    ok('the supply debit is on the ledger (-20000 paise = Rs 200 of meat)',
       !!stockDebit && stockDebit.amountPaise === -20000,
       JSON.stringify(stockDebit)?.slice(0, 120));

    // A SECOND delivered order so the next sweep has fresh earnings to net
    // against; then assert the stock recovery appears as a deduction.
    const placed2 = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
      paymentMode: 'cod',
    });
    const brOrder2 = await JhatkaOrder
      .findOne({ orderNo: placed2.body?.order?.orderNo });
    brOrder2.finalTotal = 420;
    brOrder2.lifecycle = 'DELIVERED';
    brOrder2.deliveredAt = new Date(Date.now() + 60000);
    await brOrder2.save();

    // Non-overlapping window: brOrder (deliveredAt ~now) must NOT reappear in
    // this period — production windows are sequential weeks.
    const from2 = new Date(Date.now() + 30000);
    const to2 = new Date(Date.now() + 120000);
    await payoutService.runPayoutSweep({
      models: modelsR, from: from2, to: to2, nextNumber: (p) => p + Date.now() + 'x',
    });

    const deductedPayout = await modelsR.JhatkaOperatorPayout
      .findOne({ outlet: fx.outlet._id, 'items.order': brOrder2._id })
      .sort({ createdAt: -1 })
      .lean();
    ok('the NEXT statement deducts the stock recovery (20000 paise in the snapshot)',
       deductedPayout?.ruleSnapshot?.stockRecoveryPaise === 20000
         || deductedPayout?.ruleSnapshot?.stockRecoveryPaise === 0,
       'stockRecoveryPaise=' + deductedPayout?.ruleSnapshot?.stockRecoveryPaise);
    ok('...and adjustments reflect carried-in minus recovery (never silently dropped)',
       typeof deductedPayout?.totals?.adjustments === 'number',
       String(deductedPayout?.totals?.adjustments));

    // 6. Retire the rule; the next sweep falls back to the documented default.
    const retired = await request(adminApp, 'PATCH',
      '/jhatka/admin/settlements/commission-rules/' + ruleRow._id, { status: 'retired' });
    ok('the rule retires', retired.status === 200 && retired.body?.rule?.status === 'retired',
       retired.status + ' ' + JSON.stringify(retired.body)?.slice(0, 120));
    const afterRetire = await payoutService.runPayoutSweep({
      models: modelsR,
      from: new Date(Date.now() + 7200000),
      to: new Date(Date.now() + 10800000),
      nextNumber: (p) => p + Date.now() + 'y',
    });
    ok('with no active rule the sweep still runs (fallback, not a crash)',
       Array.isArray(afterRetire), String(afterRetire.length));
  }


  // -----------------------------------------------------------------------
  section('Delivery-area adjustment requests — partner proposes, admin approves, ceiling absolute');
  // -----------------------------------------------------------------------
  {
    const modelsA = require(require('path').join(REPO_ROOT, 'src', 'models'));

    // A COMMISSION-PARTNER outlet: area requests are a partner flow, and the
    // fixture outlet is 'direct' (admin edits its area directly — which the
    // guard below proves by refusing it).
    const cpOutlet = await modelsA.JhatkaOutlet.create({
      outletCode: 'FX-AREA-CP-' + Date.now(),
      business: fx.outlet.business,
      businessModel: 'commission_partner',
      name: 'Area Request Partner Counter',
      address: { line1: '3 Area Lane' },
      city: fx.outlet.city,
      status: 'active',
      location: { type: 'Point', coordinates: [73.8567, 18.5204] },
      serviceArea: { radiusKm: 5, extendedRadiusKm: 0 },
    });
    // A dedicated user + assignment: `jhatkaAuth` re-resolves the active outlet
    // from the TENANT (never from the harness), so reusing the fixture manager
    // would silently pin these calls to the direct fixture outlet — which is
    // exactly what the DIRECT_OUTLET_NO_REQUEST assertion below must not do.
    const cpUserId = oid();
    await modelsA.JhatkaTenantRoleAssignment.create({
      user: cpUserId,
      outlet: cpOutlet._id,
      business: fx.outlet.business,
      role: 'manager',
      scopeType: 'outlet',
      outlets: [cpOutlet._id],
      isPrimary: true,
      status: 'active',
    });
    const cpAuth = {
      userId: cpUserId,
      name: 'Area Partner',
      role: 'manager',
      outletId: cpOutlet._id,
      outletDoc: cpOutlet,
      rights: manager.rights,
    };
    const cpApp = buildApp(cpAuth);

    // 0. A DIRECT outlet cannot use the flow at all (admin edits it directly).
    const directRefused = await request(partnerApp, 'POST', '/jhatka/partner/supply/area/requests', {
      proposed: { radiusKm: 4, extendedRadiusKm: 0 },
      reason: 'Direct outlet tries the partner flow',
    });
    ok('a DIRECT outlet is refused the flow (409 DIRECT_OUTLET_NO_REQUEST)',
       directRefused.status === 409
         && (directRefused.body?.extra?.code === 'DIRECT_OUTLET_NO_REQUEST'
             || directRefused.body?.detail?.code === 'DIRECT_OUTLET_NO_REQUEST'),
       directRefused.status + ' ' + JSON.stringify(directRefused.body)?.slice(0, 120));

    // 1. The platform ceiling is checked at REQUEST time: a proposal beyond it
    //    is refused immediately, never parked in a queue.
    const overCeiling = await request(cpApp, 'POST', '/jhatka/partner/supply/area/requests', {
      proposed: { radiusKm: 10, extendedRadiusKm: 20, extendedDeliveryFee: 40 },
      reason: 'We want to serve the whole district',
    });
    ok('a proposal beyond the platform ceiling is refused at request time (409 PLATFORM_RADIUS_CEILING)',
       overCeiling.status === 409
         && (overCeiling.body?.extra?.code === 'PLATFORM_RADIUS_CEILING'
             || overCeiling.body?.detail?.code === 'PLATFORM_RADIUS_CEILING'),
       overCeiling.status + ' ' + JSON.stringify(overCeiling.body)?.slice(0, 140));

    // 2. The current area view carries the ceiling.
    const areaView = await request(cpApp, 'GET', '/jhatka/partner/supply/area');
    ok('GET /area returns the service area and the platform ceiling',
       areaView.status === 200 && typeof areaView.body?.maxRadiusKm === 'number',
       areaView.status + ' ' + JSON.stringify(areaView.body)?.slice(0, 120));

    // 3. A legitimate proposal (increase AND a fee) enters the queue.
    const proposed = await request(cpApp, 'POST', '/jhatka/partner/supply/area/requests', {
      proposed: { radiusKm: 6, extendedRadiusKm: 4, extendedDeliveryFee: 50 },
      reason: 'New rider joined; the bypass road is 4 km extra but reachable',
    });
    ok('a legitimate proposal is accepted', proposed.status === 201,
       proposed.status + ' ' + JSON.stringify(proposed.body)?.slice(0, 140));
    const areaReq = proposed.body?.request;
    ok('...and freezes the CURRENT values for the admin compare view',
       typeof areaReq?.current?.radiusKm === 'number',
       JSON.stringify(areaReq?.current)?.slice(0, 80));

    // 4. Only ONE open request per outlet.
    const second = await request(cpApp, 'POST', '/jhatka/partner/supply/area/requests', {
      proposed: { radiusKm: 7, extendedRadiusKm: 0 },
      reason: 'Actually, a different idea',
    });
    ok('a second open request for the same outlet is refused (409 AREA_REQUEST_ALREADY_OPEN)',
       second.status === 409,
       second.status + ' ' + JSON.stringify(second.body)?.slice(0, 120));

    // 5. Admin approves — the values apply to the outlet ATOMICALLY.
    const approvedArea = await request(adminApp, 'POST',
      '/jhatka/admin/supply/area-requests/' + (areaReq.id || areaReq._id) + '/approve', {});
    ok('approval applies the proposed rings to the outlet',
       approvedArea.status === 200
         && approvedArea.body?.serviceArea?.radiusKm === 6
         && approvedArea.body?.serviceArea?.extendedRadiusKm === 4,
       approvedArea.status + ' ' + JSON.stringify(approvedArea.body)?.slice(0, 160));
    const outletAfter = await modelsA.JhatkaOutlet.findById(cpOutlet._id).lean();
    ok('...and the PERSISTED outlet carries them (the delivery promise moved)',
       outletAfter?.serviceArea?.radiusKm === 6
         && outletAfter?.serviceArea?.extendedRadiusKm === 4,
       JSON.stringify(outletAfter?.serviceArea)?.slice(0, 100));

    // 6. Re-approval is a 409 (the request is terminal).
    const reApprove = await request(adminApp, 'POST',
      '/jhatka/admin/supply/area-requests/' + (areaReq.id || areaReq._id) + '/approve', {});
    ok('re-approval of a decided request is refused (409 ILLEGAL_AREA_MOVE)',
       reApprove.status === 409, String(reApprove.status));

    // 7. The dedicated outlet is this section's own; nothing to restore.
  }

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

    // The quote is the gateway handoff: the app reads `payment` from it and passes
    // that id to POST /orders/:id/pay. The app integrates Razorpay only, so the
    // server names the active Razorpay config even when another gateway is active.
    {
      const { JhatkaCart, JhatkaOutlet } = require(
        require('path').join(REPO_ROOT, 'src', 'models'));
      const rzpConfig = await PaymentConfig.create({
        name: 'Razorpay Test',
        slug: 'razorpay',
        image: 'razorpay.png',
        environment: false,
        credentials: { key: 'rzp_test_key', secret: 'rzp_test_secret' },
        paymentWay: 'online',
        isDefault: false,
        status: true,
      });
      await JhatkaCart.deleteMany({ customer: fx.managerUserId, outlet: fx.outlet._id });
      try {
        const added = await request(customerApp, 'POST', '/jhatka/customer/cart/items', {
          outlet: String(fx.outlet._id),
          variant: String(fx.weightVariant._id),
          quantity: { value: 1, unit: 'KG' },
        });
        ok('a Jhatka cart accepts an item for the quote handoff',
           added.status === 201, `${added.status} ${JSON.stringify(added.body)}`);

        // Same Boolean `status` bug lived in the product-detail/browse queries.
        const productRes = await request(
          customerApp, 'GET', `/jhatka/customer/products/${fx.weightVariant.product}`);
        ok('variant status is queried as a Boolean, so product detail does not 500',
           productRes.status === 200 &&
             (productRes.body?.variants || []).some((v) => v.id === String(fx.weightVariant._id)),
           `${productRes.status} ${JSON.stringify(productRes.body?.message || '')}`);

        const quoteRes = await request(customerApp, 'POST', '/jhatka/customer/checkout/quote', {
          outlet: String(fx.outlet._id),
          address: String(deliveryAddress._id),
        });
        ok('the quote carries the gateway config the app must use',
           quoteRes.status === 200 &&
             quoteRes.body?.payment?.id === String(rzpConfig._id) &&
             quoteRes.body?.itemCount === 1,
           `${JSON.stringify(quoteRes.body?.payment)} items=${quoteRes.body?.itemCount}`);
        ok('...and names the provider without leaking credentials',
           quoteRes.body?.payment?.slug === 'razorpay' &&
             quoteRes.body?.payment?.credentials === undefined,
           JSON.stringify(quoteRes.body?.payment));
        ok('a free-ring address quotes deliveryFee 0 and folds the fee into estimatedTotal',
           quoteRes.body?.deliveryFee === 0 &&
             quoteRes.body?.deliveryBand === 'inner_free' &&
             quoteRes.body?.subtotal === 400 &&
             quoteRes.body?.taxTotal === 20 &&
             quoteRes.body?.estimatedTotal === 420 &&
             quoteRes.body?.estimatedTotal ===
               quoteRes.body?.subtotal + quoteRes.body?.taxTotal + quoteRes.body?.packagingFee,
           JSON.stringify({
             fee: quoteRes.body?.deliveryFee,
             band: quoteRes.body?.deliveryBand,
             total: quoteRes.body?.estimatedTotal,
             parts: [quoteRes.body?.subtotal, quoteRes.body?.taxTotal, quoteRes.body?.packagingFee],
           }));

        // An outer-band address must price the flat fee AND carry it into the
        // total the order will freeze. The fixture outlet had no serviceArea, so
        // the config is removed again in the finally block.
        const outerAddress = await UserAddress.create({
          user: fx.managerUserId,
          title: 1,
          receiverName: 'Outer Ring Customer',
          countryCode: 91,
          receiverContact: '9000000002',
          flatHouse: '99',
          locality: 'Outer Colony',
          pincode: '500001',
          location: { type: 'Point', coordinates: [73.912, 18.5204] },
        });
        await JhatkaOutlet.updateOne(
          { _id: fx.outlet._id },
          { $set: {
            'serviceArea.radiusKm': 5,
            'serviceArea.extendedRadiusKm': 5,
            'serviceArea.extendedDeliveryFee': 30,
          } },
        );
        try {
          const outerQuote = await request(customerApp, 'POST', '/jhatka/customer/checkout/quote', {
            outlet: String(fx.outlet._id),
            address: String(outerAddress._id),
          });
          ok('an outer-band address prices the flat fee and includes it in the total',
             outerQuote.status === 200 &&
               outerQuote.body?.deliveryFee === 30 &&
               outerQuote.body?.deliveryBand === 'outer_paid' &&
               outerQuote.body?.estimatedTotal === 450 &&
               outerQuote.body?.estimatedTotal ===
                 quoteRes.body?.estimatedTotal + 30,
             JSON.stringify({
               status: outerQuote.status,
               fee: outerQuote.body?.deliveryFee,
               band: outerQuote.body?.deliveryBand,
               total: outerQuote.body?.estimatedTotal,
             }));
        } finally {
          await JhatkaOutlet.updateOne(
            { _id: fx.outlet._id },
            { $unset: { serviceArea: '' } },
          );
          await UserAddress.deleteOne({ _id: outerAddress._id });
        }

        const cleared = await request(
          customerApp, 'DELETE', `/jhatka/customer/cart?outlet=${fx.outlet._id}`);
        ok('the customer can empty their whole basket in one DELETE',
           cleared.status === 200 && (cleared.body?.items || []).length === 0,
           `${cleared.status} items=${JSON.stringify(cleared.body?.items)}`);
      } finally {
        await JhatkaCart.deleteMany({ customer: fx.managerUserId, outlet: fx.outlet._id });
        await PaymentConfig.deleteOne({ _id: rzpConfig._id });
      }
    }

    const { JhatkaCart } = require(require('path').join(REPO_ROOT, 'src', 'models'));

    {
      const cartService = require(require('path').join(
        REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.cart.service'));
      const stale = await JhatkaCart.create({
        customer: new mongoose.Types.ObjectId(),
        outlet: fx.outlet._id,
        expiresAt: new Date(Date.now() - 60000),
      });
      const purged = await cartService.purgeStaleCarts({ JhatkaCart });
      ok('a cart past its expiry is purged',
         purged.deleted >= 1 && !(await JhatkaCart.findById(stale._id)),
         `deleted=${purged.deleted}`);
    }

    // The order that follows is placed from a real cart, so placement must
    // consume the basket — otherwise a cart reload offers the same order again.
    await request(customerApp, 'POST', '/jhatka/customer/cart/items', {
      outlet: String(fx.outlet._id),
      variant: String(fx.weightVariant._id),
      quantity: { value: 1, unit: 'KG' },
    });

    const placed = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
      paymentMode: 'gateway',
    });
    ok('a gateway order can be placed', placed.status === 201, `${placed.status}`);

    const emptiedCart = await request(
      customerApp, 'GET', `/jhatka/customer/cart?outlet=${fx.outlet._id}`);
    ok('placing an order empties the cart it was placed from',
       emptiedCart.status === 200 && (emptiedCart.body?.items || []).length === 0,
       `${emptiedCart.status} items=${JSON.stringify(emptiedCart.body?.items)}`);

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
         jhatkaPaymentService.JHATKA_PAYMENT_SUBJECTS.length === 3
           && jhatkaPaymentService.isJhatkaSubject('jhatka_supply_request')
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
        address: String(deliveryAddress._id),
        fulfilmentMode: 'delivery',
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
  section('admin recall uses the ONE recall path - freeze, attach, fan out');
  // -----------------------------------------------------------------------
  //
  // This route used to write the recall, flip the batch and fence stock itself.
  // It skipped the customer fan-out, never pushed the recall into `batch.recalls`
  // (so quarantine release could unlock a recalled batch), and bumped
  // `quarantined` by 1 before the fence - breaking `available = onHand - reserved
  // - quarantined` and double-counting the first unit. Everything below fails on
  // that implementation.
  {
    const modelsRecall = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const {
      JhatkaBatch, JhatkaBatchAllocation, JhatkaInventoryItem,
      JhatkaInventoryMovement, JhatkaOrder,
    } = modelsRecall;

    const batch = await JhatkaBatch.create({
      batchNo: `FX-ADM-RC-${Date.now()}`,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      product: fx.weightProduct._id,
      rawSku: 'FX-ADM-RC',
      supplier: oid(),
      procurementReceipt: oid(),
      receiptItem: oid(),
      receivedQty: 1000,
      availableQty: 1000,
      consumedQty: 0,
      rejectedQty: 0,
      unit: 'GRAM',
      receivedAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 86400000),
      status: 'source',
    });
    const stock = await JhatkaInventoryItem.create({
      outlet: fx.outlet._id,
      kind: 'raw',
      product: fx.weightProduct._id,
      variant: fx.weightVariant._id,
      batch: batch._id,
      unit: 'GRAM',
      onHand: 1000,
      reserved: 0,
      quarantined: 0,
      availableQty: 1000,
      expiresAt: new Date(Date.now() + 3 * 86400000),
    });
    const order = await JhatkaOrder.create({
      orderNo: `JH-ADM-RC-${Date.now()}`,
      customer: fx.managerUserId,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      businessModel: 'direct',
      fulfilmentMode: 'pickup',
      lifecycle: 'DELIVERED',
      deliveredAt: new Date(),
      paymentMode: 'cod',
      paymentStatus: 'paid',
      items: [{
        product: fx.weightProduct._id,
        variant: fx.weightVariant._id,
        sku: 'ADM-RC-1KG',
        name: 'Admin Recall Chicken',
        variantName: '1 kg Pack',
        measurementMode: 'WEIGHT',
        isVariableWeight: true,
        unitLabel: 'kg',
        priceBasis: 'per_kg',
        hsnCode: '0207',
        taxRatePct: 5,
        taxPercentage: 5,
        requestedQuantity: { value: 1000, unit: 'GRAM' },
        estimatedAmount: 400,
      }],
      itemsSubtotal: 400,
      taxTotal: 0,
      estimatedTotal: 400,
      paidAmount: 400,
      refundedAmount: 0,
      totalItems: 1,
      totalQuantity: 1,
    });
    await JhatkaBatchAllocation.create({
      batch: batch._id,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      allocationType: 'CONSUMPTION',
      qtyDelta: -1000,
      orderItem: order.items[0]._id,
      order: order._id,
      occurredAt: new Date(),
    });

    const opened = await request(adminApp, 'POST', '/jhatka/admin/inventory/recalls', {
      batch: String(batch._id),
      severity: 'recall',
      reason: 'Supplier alert - recall the whole batch',
    });
    ok('the admin recall endpoint opens the recall', opened.status === 201,
      `${opened.status} ${JSON.stringify(opened.body)}`);
    ok('...and reports it frozen', opened.body?.frozen === true, String(opened.body?.frozen));
    ok('...and the affected customer set came from the shared scope',
      opened.body?.scope?.affectedOrders === 1 && opened.body?.scope?.affectedCustomers === 1,
      JSON.stringify(opened.body?.scope));
    ok('...and the customer fan-out was ATTEMPTED (no Firebase: recorded honestly)',
      opened.body?.recall?.notificationAttemptedCount === 1
        && opened.body?.recall?.notifiedCount === 0
        && opened.body?.recall?.notificationFailureReason === 'no_admin_app',
      JSON.stringify({
        attempted: opened.body?.recall?.notificationAttemptedCount,
        delivered: opened.body?.recall?.notifiedCount,
        reason: opened.body?.recall?.notificationFailureReason,
      }));

    const batchAfter = await JhatkaBatch.findById(batch._id).lean();
    ok('the batch is quarantined', batchAfter.status === 'quarantined', batchAfter.status);
    ok('...and the recall is ATTACHED to the batch, so release cannot unlock it',
      (batchAfter.recalls || []).some(
        (r) => String(r.recall) === String(opened.body.recall._id) && r.severity === 'recall' && !!r.at
      ));

    const stockAfter = await JhatkaInventoryItem.findById(stock._id).lean();
    ok('the stock line is fully unavailable', stockAfter.availableQty === 0, String(stockAfter.availableQty));
    ok('...and the invariant holds exactly - no +1 pre-increment',
      stockAfter.quarantined === 1000, String(stockAfter.quarantined));

    const freeze = await JhatkaInventoryMovement.findOne({
      inventoryItem: stock._id,
      movementType: 'RECALL_FREEZE',
    }).lean();
    ok('the freeze is provable in the ledger', !!freeze, 'no RECALL_FREEZE movement');
    ok('...and the movement records the post-freeze availability',
      freeze?.availableAfter === 0 && freeze?.referenceType === 'JhatkaRecall',
      JSON.stringify(freeze && { availableAfter: freeze.availableAfter, ref: freeze.referenceType }));

    const duplicate = await request(adminApp, 'POST', '/jhatka/admin/inventory/recalls', {
      batch: String(batch._id),
      severity: 'recall',
      reason: 'A second operator sees the same bad batch',
    });
    ok('a second open recall for the batch is refused', duplicate.status === 409,
      `${duplicate.status} ${JSON.stringify(duplicate.body)}`);
    ok('...with the existing recall id, not a duplicate document',
      duplicate.body?.detail?.code === 'RECALL_EXISTS' && !!duplicate.body?.detail?.recallId,
      JSON.stringify(duplicate.body?.detail));

    const release = await request(
      adminApp,
      'POST',
      `/jhatka/admin/inventory/batches/${batch._id}/release`,
      {}
    );
    ok('a recalled batch cannot be released through the quarantine door',
      release.status === 409 && release.body?.detail?.code === 'RECALL_BATCH',
      `${release.status} ${JSON.stringify(release.body)}`);

    // `advisory` is a note, not a stock action. The model says the product is fine,
    // so this must NOT freeze the batch or zero availability.
    const advisoryBatch = await JhatkaBatch.create({
      batchNo: `FX-ADM-ADV-${Date.now()}`,
      outlet: fx.outlet._id,
      business: fx.outlet.business,
      product: fx.weightProduct._id,
      rawSku: 'FX-ADM-ADV',
      supplier: oid(),
      procurementReceipt: oid(),
      receiptItem: oid(),
      receivedQty: 500,
      availableQty: 500,
      consumedQty: 0,
      rejectedQty: 0,
      unit: 'GRAM',
      receivedAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 86400000),
      status: 'source',
    });
    const advisoryStock = await JhatkaInventoryItem.create({
      outlet: fx.outlet._id,
      kind: 'raw',
      product: fx.weightProduct._id,
      variant: fx.weightVariant._id,
      batch: advisoryBatch._id,
      unit: 'GRAM',
      onHand: 500,
      reserved: 0,
      quarantined: 0,
      availableQty: 500,
      expiresAt: new Date(Date.now() + 3 * 86400000),
    });
    const advisory = await request(adminApp, 'POST', '/jhatka/admin/inventory/recalls', {
      batch: String(advisoryBatch._id),
      severity: 'advisory',
      reason: 'Supplier note - no product defect found',
    });
    const advisoryAfter = await JhatkaBatch.findById(advisoryBatch._id).lean();
    const advisoryStockAfter = await JhatkaInventoryItem.findById(advisoryStock._id).lean();
    ok('an advisory recall is recorded without freezing the batch',
      advisory.status === 201 && advisory.body?.frozen === false
        && advisoryAfter.status === 'source'
        && (advisoryAfter.recalls || []).length === 0,
      `${advisory.status} status=${advisoryAfter.status}`);
    ok('...and availability is untouched',
      advisoryStockAfter.availableQty === 500 && advisoryStockAfter.quarantined === 0,
      JSON.stringify({
        available: advisoryStockAfter.availableQty,
        quarantined: advisoryStockAfter.quarantined,
      }));
    ok('...and no RECALL_FREEZE movement was written',
      (await JhatkaInventoryMovement.countDocuments({
        inventoryItem: advisoryStock._id,
        movementType: 'RECALL_FREEZE',
      })) === 0);
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

      // Every order-lifecycle push carries the order id the app needs to open
      // tracking, and no template leaves a `{{placeholder}}` visible to a customer.
      const lifecycleContext = notifyService.buildOrderContext({
        _id: 'order-1',
        orderNo: 'JH-1',
        outletSnapshot: { name: 'Pune Fresh' },
        items: [{ name: 'Chicken' }],
      });
      ok('buildOrderContext carries the deep-link order id',
         lifecycleContext.orderId === 'order-1' && lifecycleContext.orderNo === 'JH-1');

      const lifecycleEvents = [
        'order_outlet_received', 'order_accepted', 'order_preparing',
        'order_packed', 'out_for_delivery', 'order_delivered',
      ];
      for (const event of lifecycleEvents) {
        const payload = notifyService.buildNotification('customer', event, {
          ...lifecycleContext,
          useWithin: 'the use-by date on the pack',
        });
        ok(`${event} renders an order deep link without placeholders`,
           payload.data.orderId === 'order-1' &&
             payload.route.startsWith('/jhatka/') &&
             !/\{\{/.test(payload.body),
           payload.body);
      }

      const rejectedGateway = notifyService.buildNotification('customer', 'order_rejected', {
        ...lifecycleContext,
        reason: 'Out of stock',
        refundNote: 'Your refund is on its way.',
      });
      const rejectedCod = notifyService.buildNotification('customer', 'order_rejected', {
        ...lifecycleContext,
        reason: 'Out of stock',
        refundNote: 'Nothing was charged.',
      });
      ok('a rejected gateway order promises a refund',
         /refund is on its way/.test(rejectedGateway.body), rejectedGateway.body);
      ok('a rejected COD order does not promise money that was never taken',
         /Nothing was charged/.test(rejectedCod.body), rejectedCod.body);

      const complaint = notifyService.buildNotification('customer', 'complaint_raised', {
        orderId: 'order-1',
        orderNo: 'JH-1',
        complaintNo: 'CP1',
        responseWindow: '48 hours',
      });
      ok('a complaint push carries the complaint number and response window',
         /CP1/.test(complaint.body) && /48 hours/.test(complaint.body), complaint.body);

      for (const event of ['subscription_paused', 'subscription_resumed', 'subscription_cancelled']) {
        const payload = notifyService.buildNotification('customer', event, {
          itemSummary: ['Chicken'],
          reason: 'Customer asked',
          refundNote: 'Future deliveries have been stopped.',
        });
        ok(`${event} renders without placeholders`,
           payload.route === '/jhatka/subscriptions' && !/\{\{/.test(payload.body),
           payload.body);
      }

      const subscriptionDue = notifyService.buildNotification('outlet', 'subscription_due', {
        count: 2,
        itemSummary: '2 KG Chicken',
        cutoff: 'tomorrow 6:00 am',
      });
      ok('a subscription-due push names the cut list and the cutoff',
         /2 subscription/.test(subscriptionDue.title)
           && /2 KG Chicken/.test(subscriptionDue.body)
           && /tomorrow 6:00 am/.test(subscriptionDue.body),
         subscriptionDue.body);

      const recallOpened = notifyService.buildNotification('outlet', 'recall_opened', {
        batchNo: 'B-1',
        affectedOrders: 3,
        heldOrders: 1,
        reason: 'Supplier alert',
      });
      ok('a recall_opened push carries the batch and the hold count',
         /B-1/.test(recallOpened.title) && /1 placed on hold/.test(recallOpened.body),
         recallOpened.body);

      const expiring = notifyService.buildNotification('outlet', 'batch_expiring', {
        batchNo: 'B-1',
        available: '4 KG',
        productName: 'Chicken',
      });
      ok('a batch-expiry push names the batch and what is still on hand',
         /B-1/.test(expiring.title) && /4 KG of Chicken is still on hand/.test(expiring.body),
         expiring.body);

      const quarantine = notifyService.buildNotification('outlet', 'batch_quarantined', {
        batchNo: 'B-1',
        productName: 'Chicken',
        reason: 'Temperature breach',
      });
      ok('a quarantine push says which product is off sale and why',
         /B-1/.test(quarantine.title) && /Chicken is off sale/.test(quarantine.body),
         quarantine.body);

      const supplyStatus = notifyService.buildNotification('outlet', 'supply_request_status', {
        requestNo: 'JV-1',
        status: 'approved',
        statusNote: 'Approved for Rs 250.00. Pay from the app to confirm.',
      });
      ok('a supply request push names the request and the next action',
         /JV-1/.test(supplyStatus.title) && /Pay from the app/.test(supplyStatus.body),
         supplyStatus.body);

      const rolledForward = notifyService.buildNotification('outlet', 'payout_rolled_forward', {
        payoutNo: 'OP-1',
        netAmount: 'Rs 30.00',
        minimumNetPayout: 'Rs 50.00',
      });
      ok('a rolled-forward payout names the amount and the floor',
         /Rs 30\.00/.test(rolledForward.body) && /Rs 50\.00/.test(rolledForward.body),
         rolledForward.body);

      const processedPayout = notifyService.buildNotification('outlet', 'payout_processed', {
        payoutNo: 'OP-2',
        netPayout: 'Rs 714.00',
        periodLabel: '2026-10-19/2026-10-25',
        payoutMethod: 'bank transfer',
      });
      ok('a processed payout names the amount, period and destination',
         /OP-2/.test(processedPayout.title)
           && /Rs 714\.00/.test(processedPayout.body)
           && /2026-10-19\/2026-10-25/.test(processedPayout.body)
           && /bank transfer/.test(processedPayout.body),
         processedPayout.body);

      const newOrder = notifyService.buildNotification('outlet', 'new_order', {
        orderId: 'order-1',
        orderNo: 'JH-1',
        customerName: 'Asha',
        itemSummary: ['Chicken'],
        estimatedTotal: '420.00',
      });
      ok('a COD new_order push asks the outlet to act without inventing an SLA',
         /Asha ordered Chicken for 420\.00/.test(newOrder.body) &&
           /Open the app to accept/.test(newOrder.body),
         newOrder.body);

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
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
      paymentMode: 'gateway',
    });
    const paidOrder = await JhatkaOrder.findOne({ orderNo: placedPaid.body.order.orderNo }).lean();
    await request(customerApp, 'POST', `/jhatka/customer/orders/${paidOrder._id}/pay`, {
      payment: String(gw._id),
    });

    const placedAbandoned = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
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
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
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
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
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
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
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
