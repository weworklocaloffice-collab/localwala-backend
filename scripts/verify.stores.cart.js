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
 * verify.stores.cart.js — the two gates before an order exists.
 *
 * Run: node scripts/verify.stores.cart.js
 *
 * ## What this pins
 *
 *   BR-37  exactly one outlet per cart. The guard looks ACROSS the customer's carts,
 *          because creating a second cart never fails — it silently strands the first
 *          one. Empty carts are exempt; only carts holding lines can conflict. The 409
 *          carries both outlet ids so the client can render the choice dialog instead
 *          of the server deciding on the customer's behalf.
 *   BR-27  an outlet is eligible only when it is operational, active, located, open,
 *          serving the locality, inside capacity — and the customer is inside its
 *          radius. Every reason is a machine-readable code, because the storefront
 *          renders "why not" from this list.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const cartService = require('../src/modules/stores/services/stores.cart.service');
const eligibilityService = require('../src/modules/stores/services/stores.eligibility.service');
const checkoutService = require('../src/modules/stores/services/stores.checkout.service');

// The services resolve models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.cart.model');
require('../src/modules/stores/models/store.outlet.model');
require('../src/modules/stores/models/store.order.model');

const StoreCart = mongoose.model('StoreCart');
const StoreOutlet = mongoose.model('StoreOutlet');
const StoreOrder = mongoose.model('StoreOrder');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const CUSTOMER = new mongoose.Types.ObjectId();
const OUTLET_A = new mongoose.Types.ObjectId();
const OUTLET_B = new mongoose.Types.ObjectId();
const CHAIN = new mongoose.Types.ObjectId();

const baseOutlet = (id, overrides = {}) => ({
  _id: id,
  chain: CHAIN,
  outletCode: 'CART',
  name: 'cart suite',
  operational: true,
  status: 'active',
  location: { type: 'Point', coordinates: [77.6, 12.97] },
  deliveryConfig: { radiusKm: 5, deliveryFee: 0, dailyOrderCapacity: 0 },
  operatingHours: [{ day: new Date().getDay(), isOpen: true, opensAt: '00:00', closesAt: '23:59' }],
  holidays: [],
  serviceLocalities: [],
  ...overrides,
});

const cleanup = async () => {
  await StoreCart.deleteMany({ customer: CUSTOMER });
  await StoreOrder.deleteMany({ outlet: { $in: [OUTLET_A, OUTLET_B] } });
  // The capacity block creates a real outlet row (populate-free reads need it).
  await StoreOutlet.deleteMany({ _id: { $in: [OUTLET_A, OUTLET_B] } });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== BR-37: one outlet per cart ===\n');

  // No carts at all: anything goes.
  await cartService.assertCartOutletMatches(CUSTOMER, OUTLET_A);
  ck('with no carts, any outlet is allowed', true);

  // An EMPTY cart at A does not block B.
  await StoreCart.create({ customer: CUSTOMER, outlet: OUTLET_A, chain: CHAIN, items: [] });
  await cartService.assertCartOutletMatches(CUSTOMER, OUTLET_B);
  ck('an empty cart never conflicts', true);

  // A cart HOLDING LINES at A blocks B.
  await StoreCart.updateOne(
    { customer: CUSTOMER, outlet: OUTLET_A },
    { $push: { items: { product: new mongoose.Types.ObjectId(), variant: new mongoose.Types.ObjectId(), quantity: 1 } } }
  );
  let conflict = null;
  try {
    await cartService.assertCartOutletMatches(CUSTOMER, OUTLET_B);
  } catch (e) {
    conflict = e;
  }
  ck('a stocked cart at A blocks outlet B', !!conflict && conflict.statusCode === 409);
  ck('the error names the rule', conflict && /CART_OUTLET_CONFLICT/.test(conflict.message), conflict && conflict.message);
  ck('the error carries both outlets for the client dialog',
    conflict && conflict.extra && String(conflict.extra.cartOutlet) === String(OUTLET_A) &&
    String(conflict.extra.requestedOutlet) === String(OUTLET_B),
    conflict && JSON.stringify(conflict.extra));

  // Same outlet is always fine.
  await cartService.assertCartOutletMatches(CUSTOMER, OUTLET_A);
  ck('the same outlet never conflicts with itself', true);

  // Clearing resolves the conflict — leaving a store must not require clearing first
  // only when the cart is already empty; a stocked cart keeps blocking until released.
  await StoreCart.updateOne({ customer: CUSTOMER, outlet: OUTLET_A }, { $set: { items: [] } });
  await cartService.assertCartOutletMatches(CUSTOMER, OUTLET_B);
  ck('emptying the cart releases the conflict', true);

  console.log('\n=== BR-27: outlet eligibility ===\n');

  const eligible = await eligibilityService.checkEligibility({ outlet: baseOutlet() });
  ck('a healthy outlet is eligible with no reasons', eligible.eligible === true && eligible.reasons.length === 0,
    JSON.stringify(eligible.reasons));

  const missing = await eligibilityService.checkEligibility({ outlet: null });
  ck('a missing outlet reports OUTLET_NOT_FOUND', !missing.eligible && missing.reasons.includes('OUTLET_NOT_FOUND'));

  // --- the wrapper the HTTP layer actually calls ---
  //
  // Every assertion above passes a real outlet DOCUMENT to `checkEligibility`. The route
  // never does that: it hands `validateCheckoutEligibility` the `outlet` ObjectId straight
  // from the request body. The wrapper used to forward that id untouched, so
  // `outlet.operational` / `outlet.status` / `outlet.location` were all `undefined` and
  // every outlet — healthy, open, in range — came back with STORE_NOT_OPERATIONAL,
  // STORE_NOT_ACTIVE and STORE_LOCATION_MISSING, i.e. checkout was impossible.
  //
  // These assertions go through the wrapper with an ID so that gap cannot reopen.
  await StoreOutlet.create({
    _id: OUTLET_A,
    chain: CHAIN,
    outletCode: 'ELIGA',
    name: 'eligibility outlet',
    status: 'active',
    operational: true,
    location: { type: 'Point', coordinates: [77.5946, 12.9716] },
    deliveryConfig: { radiusKm: 10 },
  });

  const viaId = await checkoutService.validateCheckoutEligibility({ outlet: OUTLET_A.toString() });
  ck('eligibility accepts an outlet ID, the way HTTP supplies it',
    viaId.eligible === true,
    JSON.stringify(viaId.reasons));
  ck('a healthy outlet is not failed on phantom grounds',
    !viaId.reasons.includes('STORE_NOT_OPERATIONAL') &&
    !viaId.reasons.includes('STORE_NOT_ACTIVE') &&
    !viaId.reasons.includes('STORE_LOCATION_MISSING'),
    JSON.stringify(viaId.reasons));

  const viaObject = await checkoutService.validateCheckoutEligibility({ outlet: baseOutlet() });
  ck('eligibility still accepts an already-populated outlet document',
    viaObject.eligible === true,
    JSON.stringify(viaObject.reasons));

  const idNotFound = await checkoutService.validateCheckoutEligibility({
    outlet: new mongoose.Types.ObjectId().toString(),
  });
  ck('an unknown outlet ID is OUTLET_NOT_FOUND and nothing else',
    !idNotFound.eligible &&
    idNotFound.reasons.length === 1 &&
    idNotFound.reasons[0] === 'OUTLET_NOT_FOUND',
    JSON.stringify(idNotFound.reasons));

  const notOperational = await eligibilityService.checkEligibility({ outlet: baseOutlet(OUTLET_A, { operational: false }) });
  ck('a non-operational outlet reports STORE_NOT_OPERATIONAL',
    !notOperational.eligible && notOperational.reasons.includes('STORE_NOT_OPERATIONAL'));

  const suspended = await eligibilityService.checkEligibility({ outlet: baseOutlet(OUTLET_A, { status: 'suspended' }) });
  ck('a suspended outlet reports STORE_NOT_ACTIVE',
    !suspended.eligible && suspended.reasons.includes('STORE_NOT_ACTIVE'));

  const noLocation = await eligibilityService.checkEligibility({ outlet: baseOutlet(OUTLET_A, { location: null }) });
  ck('an outlet with no pin reports STORE_LOCATION_MISSING',
    !noLocation.eligible && noLocation.reasons.includes('STORE_LOCATION_MISSING'));

  console.log('\n=== radius and locality ===\n');

  // ~11 km away: outside a 5 km radius. (Bengaluru coords; haversine, not flat math.)
  const far = await eligibilityService.checkEligibility({
    outlet: baseOutlet(),
    addressLocation: { type: 'Point', coordinates: [77.7, 12.97] },
  });
  ck('a customer outside the radius is refused', !far.eligible && far.reasons.includes('OUTSIDE_DELIVERY_RADIUS'));

  const near = await eligibilityService.checkEligibility({
    outlet: baseOutlet(),
    addressLocation: { type: 'Point', coordinates: [77.61, 12.97] },
  });
  ck('a customer inside the radius passes that check', !near.reasons.includes('OUTSIDE_DELIVERY_RADIUS'));

  const localityId = new mongoose.Types.ObjectId();
  const wrongLocality = await eligibilityService.checkEligibility({
    outlet: baseOutlet(OUTLET_A, { serviceLocalities: [localityId] }),
    address: { localityRef: new mongoose.Types.ObjectId() },
  });
  ck('an unserved locality is refused', !wrongLocality.eligible && wrongLocality.reasons.includes('LOCALITY_NOT_SERVICED'));

  const rightLocality = await eligibilityService.checkEligibility({
    outlet: baseOutlet(OUTLET_A, { serviceLocalities: [localityId] }),
    address: { localityRef: localityId },
  });
  ck('a served locality passes', !rightLocality.reasons.includes('LOCALITY_NOT_SERVICED'));

  const noLocalityList = await eligibilityService.checkEligibility({
    outlet: baseOutlet(OUTLET_A, { serviceLocalities: [] }),
    address: { localityRef: new mongoose.Types.ObjectId() },
  });
  ck('an empty service list degrades to pure radius (V1)', !noLocalityList.reasons.includes('LOCALITY_NOT_SERVICED'));

  console.log('\n=== hours, holidays, capacity ===\n');

  const closedToday = await eligibilityService.checkEligibility({
    outlet: baseOutlet(OUTLET_A, { operatingHours: [{ day: new Date().getDay(), isOpen: false }] }),
  });
  ck('a closed day reports STORE_CLOSED', !closedToday.eligible && closedToday.reasons.includes('STORE_CLOSED'));

  const todayStr = new Date().toISOString().split('T')[0];
  const holiday = await eligibilityService.checkEligibility({
    outlet: baseOutlet(OUTLET_A, { holidays: [{ date: todayStr }] }),
  });
  ck('a holiday reports STORE_HOLIDAY', !holiday.eligible && holiday.reasons.includes('STORE_HOLIDAY'));

  // Capacity: seed exactly at the cap with non-terminal orders. Order numbers are drawn
  // high-entropy: fixed literals collide with leftovers from any crashed run on the
  // global unique index.
  const capNo = () => 9720000 + Math.floor(Math.random() * 89999);
  await StoreOutlet.create({ _id: OUTLET_B, chain: CHAIN, outletCode: 'CARTB', name: 'cap' });
  await StoreOrder.create([
    { orderNo: capNo(), customer: CUSTOMER, outlet: OUTLET_B, chain: CHAIN, items: [], grandTotal: 10, lifecycle: 'paid' },
    { orderNo: capNo(), customer: CUSTOMER, outlet: OUTLET_B, chain: CHAIN, items: [], grandTotal: 10, lifecycle: 'paid' },
    // Terminal states do not consume capacity.
    { orderNo: capNo(), customer: CUSTOMER, outlet: OUTLET_B, chain: CHAIN, items: [], grandTotal: 10, lifecycle: 'cancelled' },
  ]);
  const atCap = await eligibilityService.checkEligibility({
    outlet: { ...baseOutlet(), _id: OUTLET_B, deliveryConfig: { radiusKm: 5, dailyOrderCapacity: 2 } },
  });
  ck('at capacity reports STORE_AT_CAPACITY', !atCap.eligible && atCap.reasons.includes('STORE_AT_CAPACITY'));

  const underCap = await eligibilityService.checkEligibility({
    outlet: { ...baseOutlet(), _id: OUTLET_B, deliveryConfig: { radiusKm: 5, dailyOrderCapacity: 3 } },
  });
  ck('under capacity passes', !underCap.reasons.includes('STORE_AT_CAPACITY'));

  console.log('\n=== reasons accumulate, not short-circuit ===\n');

  const everything = await eligibilityService.checkEligibility({
    outlet: baseOutlet(OUTLET_A, { operational: false, status: 'suspended', location: null }),
  });
  ck('multiple failures are all reported, not just the first',
    ['STORE_NOT_OPERATIONAL', 'STORE_NOT_ACTIVE', 'STORE_LOCATION_MISSING'].every((r) => everything.reasons.includes(r)),
    everything.reasons.join(','));
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
    console.log('\n' + (failures === 0 ? 'ALL STORES CART CHECKS PASSED' : failures + ' STORES CART CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });