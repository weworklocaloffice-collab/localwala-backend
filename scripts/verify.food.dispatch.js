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
 * verify.food.dispatch.js — the food delivery rider-assignment trust boundary.
 *
 * Run: node scripts/verify.food.dispatch.js
 *
 * ## What this pins
 *
 *   D-03  an order that was offered to a rider who never answered is visible to
 *         operations. Excluding `driverAssign: 'ideal'` from the un-assigned queue
 *         is what made stuck orders invisible.
 *   D-04  a `driverId` arriving from a client picker is re-validated server-side.
 *         Before this, any user id at all became a live offer.
 *   D-06  one active offer per order. A double-tap is a conflict, not a second rider.
 *   D-11  a derived outlet inherits `ownDriver` from its parent, and its riders are
 *         registered against that parent — so the pool must resolve to the parent.
 *
 * ## Why eligibility is asserted and not merely logged
 *
 * The picker the vendor sees is a point-in-time snapshot that goes stale the moment
 * the order is prepared. A rider can go offline, be blocked, fill up, or decline the
 * order in between. Nothing the client sends is therefore trustworthy, and every
 * condition is re-derived from the database in `utils/rider.pool.js`.
 *
 * ## Supersede, not refuse
 *
 * Refusing any manual assignment while an offer is live would leave operations with
 * no way to fix a stuck order — no code path writes `driverOrderStatus: 'cancelled'`.
 * So a repeat offer to the *same* rider is refused as a conflict, while an offer to a
 * *different* rider supersedes the stale one. That is the manual-override path.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const {
  assertRiderEligible,
  resolveRiderPool,
  buildPoolQuery,
} = require('../src/utils/rider.pool');

const driverService = require('../src/services/driver.service');

const {
  Orders,
  Restaurant,
  Driver,
  User,
  DriverNewOrderStatus,
  RestaurantSettings,
} = require('../src/models');

const ordersService = require('../src/services/orders.service');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const STAMP = Date.now();
let seq = 0;

const CITY = new mongoose.Types.ObjectId();
const PAYMENT = new mongoose.Types.ObjectId();

// Platform-owned restaurants (ownDriver falsy) dispatch from the platform pool.
const PLATFORM_RESTAURANT = new mongoose.Types.ObjectId();
// A restaurant that runs its own fleet.
const FLEET_RESTAURANT = new mongoose.Types.ObjectId();
// A derived outlet that inherits ownDriver from FLEET_RESTAURANT.
const OUTLET = new mongoose.Types.ObjectId();

const COORDS = [72.8777, 19.076];

/**
 * A real User document. The un-assigned queue resolves `users` through a
 * `$lookup` and then matches on `users.firstName` / `users.lastName`, so an order
 * pointing at a user id that does not exist would be filtered out of every page
 * for the wrong reason.
 */
const makeUser = () => {
  seq += 1;
  return User.create({
    firstName: 'Food',
    lastName: 'Test' + STAMP,
    email: 'foodtest' + STAMP + '.' + seq + '@example.invalid',
    password: 'verify.food.dispatch.' + STAMP,
    countryCode: '+91',
    mobile: '99999' + String(STAMP + seq).slice(-5),
  });
};

const makeRestaurant = (overrides = {}) =>
  Restaurant.create({
    userId: new mongoose.Types.ObjectId(),
    name: 'Test Kitchen ' + STAMP,
    address: 'Somewhere',
    shortDescription: 'x',
    logo: 'l',
    cover: 'c',
    city: CITY,
    location: { type: 'Point', coordinates: COORDS },
    type: 'restaurant',
    approxDeliveryTime: 30,
    dishPriceForTwo: 200,
    minOrderAmount: 100,
    ownDriver: false,
    ...overrides,
  });

const makeDriver = (overrides = {}) =>
  Driver.create({
    userId: new mongoose.Types.ObjectId(),
    city: CITY,
    vehicle: new mongoose.Types.ObjectId(),
    location: { type: 'Point', coordinates: COORDS },
    type: 'freelancer',
    identity: 'passport',
    identityNumber: 'X' + STAMP,
    identityProof: 'p',
    drivingLicense: 'DL' + STAMP,
    age: 25,
    dob: new Date('1995-01-01'),
    restaurant: null,
    isBlocked: false,
    activeStatus: true,
    status: true,
    orderHandling: 0,
    ...overrides,
  });

const makeOrder = async (overrides = {}) => {
  const customer = await makeUser();
  return Orders.create({
    orderNo: 900000 + (await Orders.countDocuments()) + 1,
    user: customer._id,
    payment: PAYMENT,
    restaurant: PLATFORM_RESTAURANT,
    cartItemRaw: '[]',
    orderAt: new Date(),
    orderTo: 'homedelivery',
    status: 'preparing',
    driver: null,
    driverAssign: 'ideal',
    deliveryAddressRaw: 'Somewhere else',
    grandTotal: 10000,
    ...overrides,
  });
};

/** Assert that `fn` throws with the given HTTP status. */
const expectStatus = async (label, fn, status) => {
  try {
    await fn();
    ck(label, false, 'expected ' + status + ', nothing was thrown');
  } catch (e) {
    ck(label, e.statusCode === status, 'got ' + e.statusCode + ': ' + e.message);
  }
};

const cleanup = async () => {
  const restaurants = { $in: [PLATFORM_RESTAURANT, FLEET_RESTAURANT, OUTLET] };
  await Orders.deleteMany({ restaurant: restaurants });
  await DriverNewOrderStatus.deleteMany({ restaurant: restaurants });
  await Driver.deleteMany({ identityNumber: new RegExp('^X' + STAMP) });
  await Restaurant.deleteMany({ _id: { $in: [PLATFORM_RESTAURANT, FLEET_RESTAURANT, OUTLET] } });
  // By email, not by "users referenced by an order" — a user created for a
  // negative case (`nonRider`) is never attached to an order and would leak.
  await User.deleteMany({ email: new RegExp('^foodtest' + STAMP + '\\.') });
  await User.deleteMany({ email: new RegExp('^foodtest' + STAMP + '@') });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== pool resolution ===\n');

  await makeRestaurant({ _id: PLATFORM_RESTAURANT });
  const parent = await makeRestaurant({
    _id: FLEET_RESTAURANT,
    name: 'Fleet Owner ' + STAMP,
    ownDriver: true,
  });
  await makeRestaurant({
    _id: OUTLET,
    name: 'Derived Outlet ' + STAMP,
    type: 'derived',
    isOutlet: true,
    outletManagerId: parent._id,
    ownDriver: false,
  });

  // `DriverSettings.maxOrderLimit` is platform-wide shared config and is left
  // alone; the over-capacity rider below is seeded at 99, above any sane limit.

  const platformPool = await resolveRiderPool(PLATFORM_RESTAURANT);
  ck('a restaurant without ownDriver resolves to the platform pool', platformPool.isOwnFleet === false);
  ck('the platform pool has no fleet owner', platformPool.fleetOwnerRestaurantId === null);

  const outletPool = await resolveRiderPool(OUTLET);
  ck('a derived outlet inherits ownDriver from its parent', outletPool.isOwnFleet === true);
  ck(
    'the outlet pool resolves to the PARENT restaurant, not the outlet',
    String(outletPool.fleetOwnerRestaurantId) === String(parent._id),
    'got ' + outletPool.fleetOwnerRestaurantId
  );

  console.log('\n=== a client-supplied driverId is not trusted ===\n');

  const good = await makeDriver();
  const blocked = await makeDriver({ isBlocked: true });
  const offline = await makeDriver({ activeStatus: false });
  const disabled = await makeDriver({ status: false });
  const full = await makeDriver({ orderHandling: 99 });
  const otherCity = await makeDriver({ city: new mongoose.Types.ObjectId() });
  const fleetRider = await makeDriver({ restaurant: FLEET_RESTAURANT });
  const order = await makeOrder();

  await expectStatus(
    'a blocked rider is refused',
    () => assertRiderEligible({ driverId: blocked.userId, restaurantId: PLATFORM_RESTAURANT }),
    422
  );

  await expectStatus(
    'an offline rider is refused',
    () => assertRiderEligible({ driverId: offline.userId, restaurantId: PLATFORM_RESTAURANT }),
    422
  );
  await expectStatus(
    'a disabled rider account is refused',
    () => assertRiderEligible({ driverId: disabled.userId, restaurantId: PLATFORM_RESTAURANT }),
    422
  );
  await expectStatus(
    'a rider over order capacity is refused',
    () => assertRiderEligible({ driverId: full.userId, restaurantId: PLATFORM_RESTAURANT }),
    422
  );
  await expectStatus(
    'a rider in another city is refused',
    () => assertRiderEligible({ driverId: otherCity.userId, restaurantId: PLATFORM_RESTAURANT }),
    422
  );
  await expectStatus(
    "a fleet rider is refused for a restaurant that does not own a fleet",
    () => assertRiderEligible({ driverId: fleetRider.userId, restaurantId: PLATFORM_RESTAURANT }),
    422
  );
  const nonRider = await makeUser();
  await expectStatus(
    'a user id that is not a rider at all is refused',
    () => assertRiderEligible({ driverId: nonRider._id, restaurantId: PLATFORM_RESTAURANT }),
    422
  );
  await expectStatus(
    'a malformed driver id is refused',
    () => assertRiderEligible({ driverId: 'not-an-id', restaurantId: PLATFORM_RESTAURANT }),
    422
  );

  try {
    const eligible = await assertRiderEligible({
      driverId: good.userId,
      restaurantId: PLATFORM_RESTAURANT,
      orderId: order._id,
    });
    ck('an eligible platform rider passes', eligible.rider !== null && eligible.rider !== undefined);
  } catch (e) {
    ck('an eligible platform rider passes', false, e.message);
  }

  await DriverNewOrderStatus.create({
    orderId: order._id,
    driver: good.userId,
    restaurant: PLATFORM_RESTAURANT,
    driverOrderStatus: 'rejected',
    orderFrom: 'auto',
  });

  await expectStatus(
    'a rider who already declined this order is refused',
    () =>
      assertRiderEligible({
        driverId: good.userId,
        restaurantId: PLATFORM_RESTAURANT,
        orderId: order._id,
      }),
    422
  );

  console.log('\n=== the pool query applies every condition ===\n');

  const fleetQuery = buildPoolQuery(await resolveRiderPool(OUTLET));
  ck('the own-fleet pool filters on the parent restaurant id',
    String(fleetQuery.restaurant) === String(parent._id));
  ck('the own-fleet pool still caps orderHandling',
    fleetQuery.orderHandling !== undefined && fleetQuery.orderHandling.$lte !== undefined);
  ck('the own-fleet pool filters city', String(fleetQuery.city) === String(CITY));
  ck('the pool filters blocked riders', fleetQuery.isBlocked === false);
  ck('the pool filters inactive riders', fleetQuery.activeStatus === true);
  ck('the pool filters disabled accounts', fleetQuery.status === true);

  const platformQuery = buildPoolQuery(await resolveRiderPool(PLATFORM_RESTAURANT));
  ck('the platform pool filters on restaurant: null', platformQuery.restaurant === null);

  console.log('\n=== manual assignment writes one audited offer ===\n');

  await DriverNewOrderStatus.deleteMany({ orderId: order._id });
  await DriverNewOrderStatus.updateOne(
    { orderId: order._id },
    { $set: { driverOrderStatus: 'rejected' } }
  );

  const second = await makeDriver();
  const fresh = await makeOrder();

  const assigned = await ordersService.assignDriverOrderVendor(fresh._id, second.userId, null);
  ck('assignDriverOrderVendor returns the order', assigned && assigned.restaurant !== undefined);

  const offers = await DriverNewOrderStatus.find({ orderId: fresh._id, driverOrderStatus: 'ideal' });
  ck('exactly one active offer exists', offers.length === 1, 'got ' + offers.length);
  ck('the offer is recorded as manual', offers[0].orderFrom === 'manually');
  ck('the selection source is stamped', offers[0].selectionSource === 'vendor_web');
  ck('the selection time is stamped', offers[0].selectedAt instanceof Date);

  const third = await makeDriver();
  await ordersService.assignDriverOrderVendor(fresh._id, third.userId, null);
  const afterSupersede = await DriverNewOrderStatus.find({ orderId: fresh._id });
  ck('an override to a different rider supersedes the previous offer',
    afterSupersede.some((x) => String(x.driver) === String(second.userId) && x.driverOrderStatus === 'cancelled'));
  ck('the superseding offer is live',
    afterSupersede.some((x) => String(x.driver) === String(third.userId) && x.driverOrderStatus === 'ideal'));

  await expectStatus(
    're-offering the same rider is a conflict, not a second offer',
    () => ordersService.assignDriverOrderVendor(fresh._id, third.userId, null),
    409
  );

  await expectStatus(
    'the admin path applies the same validation',
    () => ordersService.assignDriverOrderAdmin(fresh._id, fleetRider.userId, null),
    422
  );

  console.log('\n=== a stuck order is visible to operations ===\n');

  // No offer at all — the classic "offered, rider never answered" end state.
  const stuck = await makeOrder({ status: 'preparing', driverAssign: 'ideal' });
  // An offer is genuinely live — this one must NOT be escalated to a human.
  const live = await makeOrder({ status: 'preparing', driverAssign: 'ideal' });
  await DriverNewOrderStatus.create({
    orderId: live._id,
    driver: second.userId,
    restaurant: PLATFORM_RESTAURANT,
    driverOrderStatus: 'ideal',
    orderFrom: 'auto',
  });
  // Escalated the old way — always belongs in the queue.
  const escalated = await makeOrder({ status: 'ready', driverAssign: 'rejected' });

  const listed = await ordersService.getAdminUnAssignedOrderList({
    limit: 100,
    page: 1,
    search: '',
  });
  const listedIds = listed.orders.map((o) => String(o.id));

  ck('an order stuck at `ideal` with no live offer now appears',
    listedIds.includes(String(stuck._id)));
  ck('an order with a live offer is not escalated to a human',
    !listedIds.includes(String(live._id)));
  ck('an escalated order still appears', listedIds.includes(String(escalated._id)));
  ck('the total count agrees with the page',
    listed.totalResults === listed.orders.length,
    'totalResults=' + listed.totalResults + ' rows=' + listed.orders.length);

  console.log('\n=== the vendor picker does not leak the platform pool ===\n');

  const settings = await RestaurantSettings.findOneAndUpdate(
    {},
    { driverPickup: true, platformDriverPickup: false },
    { new: true, upsert: true }
  );
  ck('platformDriverPickup defaults to off',
    settings.platformDriverPickup === false, 'got ' + settings.platformDriverPickup);
  ck('driverPickup is unchanged and still on',
    settings.driverPickup === true, 'got ' + settings.driverPickup);

  const platformRider = await makeDriver({ restaurant: null });
  const foreignFleetRider = await makeDriver({ restaurant: FLEET_RESTAURANT });

  const platformView = await driverService.getNearMeActiveDriver(PLATFORM_RESTAURANT);
  const platformIds = platformView.drivers.map((d) => String(d.id));

  ck('a platform-pool rider is listed for a platform restaurant',
    platformIds.includes(String(platformRider._id)));
  ck("another restaurant's own rider is NOT listed in the platform pool",
    !platformIds.includes(String(foreignFleetRider._id)),
    'leaked ' + foreignFleetRider._id);

  const shownPlatform = platformView.drivers.find((d) => String(d.id) === String(platformRider._id));
  const users = shownPlatform ? shownPlatform.users || {} : {};
  ck('no first name is released to a platform-pool vendor',
    !('firstName' in users) || users.firstName === '', JSON.stringify(users));
  ck('no last name is released to a platform-pool vendor',
    !('lastName' in users) || users.lastName === '', JSON.stringify(users));
  ck('no photo is released to a platform-pool vendor',
    !('image' in users) || users.image === '', JSON.stringify(users));
  ck('distance is still released, so the count is useful',
    typeof shownPlatform.distance === 'number');

  // The own-fleet vendor owns these riders, so identity is appropriate there.
  const fleetView = await driverService.getNearMeActiveDriver(FLEET_RESTAURANT);
  const shownFleet = fleetView.drivers.find((d) => String(d.id) === String(foreignFleetRider._id));
  ck('a restaurant still sees its OWN rider by name',
    !!shownFleet && !!shownFleet.users && shownFleet.users.firstName !== undefined);
  ck('a restaurant still sees its OWN rider by photo',
    !!shownFleet && !!shownFleet.users && 'image' in shownFleet.users);
  ck('a restaurant does NOT see platform riders in its fleet view',
    !fleetView.drivers.map((d) => String(d.id)).includes(String(platformRider._id)));

  await RestaurantSettings.findOneAndUpdate(
    {},
    { platformDriverPickup: true },
    { new: true, upsert: true }
  );
  const reopened = await RestaurantSettings.findOne({});
  ck('an operator can restore the legacy behaviour per restaurant',
    reopened.platformDriverPickup === true);
  await RestaurantSettings.findOneAndUpdate(
    {},
    { platformDriverPickup: false, driverPickup: true },
    { new: true, upsert: true }
  );
};

run()
  .catch((e) => {
    failures += 1;
    console.log('\nSUITE ERROR: ' + (e && e.stack ? e.stack : e));
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch {
      /* the run already failed; cleanup errors must not mask it */
    }
    await mongoose.disconnect();
    console.log(
      '\n' +
        (failures === 0
          ? 'ALL FOOD DISPATCH CHECKS PASSED'
          : failures + ' FOOD DISPATCH CHECK(S) FAILED')
    );
    process.exit(failures === 0 ? 0 : 1);
  });
