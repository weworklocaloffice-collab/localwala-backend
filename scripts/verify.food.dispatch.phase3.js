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
 * verify.food.dispatch.phase3.js — Phase 3 policy config & observability.
 *
 * Run: node scripts/verify.food.dispatch.phase3.js
 *
 * ## What this pins
 *
 *   3-1  a restaurant without `deliveryConfig` dispatches exactly as before
 *        (every field falls back to the platform value); a set field
 *        overrides; clearing it restores the fallback. Deleting the config
 *        is a rollback with no migration.
 *   3-2  polygon zones gate the customer pin through the kernel classifier
 *        (consumed as-is), with the radius as a backstop — a zone drawn
 *        wider than the delivery area must not silently extend it.
 *   3-3  illegal order / driverAssign / offer moves throw 409 instead of
 *        silently corrupting the row.
 *   3-4  surge is a capped quote, never a charge: disabled means 1.0, peak
 *        and demand pick the higher signal, the cap always wins.
 *   3-5  every dispatch path writes the append-only trail, and the six
 *        operations numbers are computable from it.
 *
 * ## Flag handling
 *
 * Same as the engine suite: `DISPATCH_CASCADE_ENABLED` is set before any
 * module is required, because `config/config.js` captures the environment at
 * load time.
 */

process.env.DISPATCH_CASCADE_ENABLED = 'true';
process.env.DISPATCH_MAX_ATTEMPTS = '5';

const mongoose = require('mongoose');
require('dotenv').config();

const dispatchService = require('../src/services/dispatch.service');
const dispatchMetrics = require('../src/services/dispatch.metrics.service');
const dispatchEvents = require('../src/services/dispatch.events.service');
const dispatchScoring = require('../src/kernel/dispatch/dispatch.scoring');
const transitions = require('../src/services/food.delivery.transitions');
const policy = require('../src/utils/delivery.policy');
const surge = require('../src/kernel/dispatch/dispatch.surge');
const ordersService = require('../src/services/orders.service');
const restaurantService = require('../src/services/restaurant.service');
const cityService = require('../src/services/city.service');
const zoneService = require('../src/services/delivery.zone.service');
const driverService = require('../src/services/driver.service');
const addressService = require('../src/services/user.address.service');
const localityService = require('../src/services/locality.service');
const restaurantController = require('../src/controllers/restaurant.controller');
const dispatchController = require('../src/controllers/dispatch.controller');
const localityValidation = require('../src/validations/locality.validation');
const deliveryConfigValidation = require('../src/validations/delivery.config.validation');
const pinGuard = require('../src/utils/pin.guard');
const customValidation = require('../src/validations/custom.validation');

const {
  Orders,
  Restaurant,
  Driver,
  User,
  DriverNewOrderStatus,
  DispatchAttempt,
  DriverSettings,
  City,
  Locality,
  DeliveryZone,
  DeliveryZoneHistory,
  UserAddress,
} = require('../src/models');
const OrderAssignmentEvent = require('../src/kernel/dispatch/models/order.assignment.event.model');

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
const CITY2 = new mongoose.Types.ObjectId();
const PAYMENT = new mongoose.Types.ObjectId();
const RESTAURANT = new mongoose.Types.ObjectId();
const SURGE_RESTAURANT = new mongoose.Types.ObjectId();
const CITY_RESTAURANT = new mongoose.Types.ObjectId();

const KITCHEN = [72.8777, 19.076];

const makeUser = () => {
  seq += 1;
  return User.create({
    firstName: 'Phase3',
    lastName: 'Test' + STAMP + '.' + seq,
    email: 'p3test' + STAMP + '.' + seq + '@example.invalid',
    password: 'verify.food.dispatch.phase3.' + STAMP,
    countryCode: '+91',
    mobile: '97777' + String(STAMP + seq).slice(-5),
  });
};

const makeRestaurant = async (id, name) =>
  Restaurant.create({
    _id: id,
    userId: new mongoose.Types.ObjectId(),
    name: name + ' ' + STAMP,
    address: 'a',
    shortDescription: 'x',
    logo: 'l',
    cover: 'c',
    city: CITY,
    location: { type: 'Point', coordinates: KITCHEN },
    type: 'restaurant',
    approxDeliveryTime: 30,
    dishPriceForTwo: 200,
    minOrderAmount: 100,
    ownDriver: false,
  });

const makeDriver = async (offsetKm, orderHandling = 0, extra = {}) => {
  const rider = await makeUser();
  return Driver.create({
    userId: rider._id,
    city: CITY,
    vehicle: new mongoose.Types.ObjectId(),
    location: {
      type: 'Point',
      coordinates: [KITCHEN[0], KITCHEN[1] + offsetKm / 111.32],
    },
    type: 'freelancer',
    identity: 'passport',
    identityNumber: 'P3' + STAMP + seq,
    identityProof: 'p',
    drivingLicense: 'DLP3' + STAMP,
    age: 25,
    dob: new Date('1995-01-01'),
    restaurant: null,
    isBlocked: false,
    activeStatus: true,
    status: true,
    orderHandling,
    rating: 4.5,
    ...extra,
  });
};

const makeOrder = async (restaurantId, overrides = {}) => {
  const customer = await makeUser();
  return Orders.create({
    orderNo: 900000 + (await Orders.countDocuments()) + 1,
    user: customer._id,
    payment: PAYMENT,
    restaurant: restaurantId,
    cartItemRaw: '[]',
    orderAt: new Date(),
    orderTo: 'homedelivery',
    status: 'preparing',
    driver: null,
    driverAssign: 'ideal',
    deliveryAddressRaw: 'Customer address',
    grandTotal: 10000,
    ...overrides,
  });
};

const eventsForOrder = (orderId) =>
  OrderAssignmentEvent.find({ order: new mongoose.Types.ObjectId(orderId) }).lean();

const cleanup = async () => {
  for (const id of [RESTAURANT, SURGE_RESTAURANT, CITY_RESTAURANT]) {
    const orders = await Orders.find({ restaurant: id }, { user: 1 }).lean();
    await DriverNewOrderStatus.deleteMany({ restaurant: id });
    await DispatchAttempt.deleteMany({ restaurant: id });
    await OrderAssignmentEvent.deleteMany({ restaurant: id });
    await Orders.deleteMany({ restaurant: id });
    await Restaurant.deleteMany({ _id: id });
    const users = orders.map((o) => o.user);
    if (users.length) await User.deleteMany({ _id: { $in: users } });
  }
  await Driver.deleteMany({ identityNumber: new RegExp('^P3' + STAMP) });
  await User.deleteMany({ email: new RegExp('^p3test' + STAMP + '\\.') });
  await DeliveryZoneHistory.deleteMany({ city: CITY2 });
  await DeliveryZone.deleteMany({ city: CITY2 });
  await Locality.deleteMany({ city: CITY2 });
  await Locality.deleteMany({ name: new RegExp('^P3Other' + STAMP) });
  await UserAddress.deleteMany({ cityRef: CITY2 });
  await City.deleteMany({ _id: { $in: [CITY2] } });
};

const throws409 = async (fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    // 409 illegal move, 422 refused input, 403 out-of-scope, 404 missing.
    // Any of those is "correctly refused"; anything else is a real failure.
    const code = e && (e.statusCode || e.status);
    return code >= 400 && code < 500 ? String(code) : 'OTHER:' + (e && e.message);
  }
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  await DriverSettings.findOneAndUpdate({}, { maxOrderLimit: 5 }, { upsert: true });

  await makeRestaurant(RESTAURANT, 'Phase3 Kitchen');
  await makeRestaurant(SURGE_RESTAURANT, 'Phase3 Surge Kitchen');

  console.log('\n=== 3-1 absent config falls back to the platform ===\n');

  const fallback = await policy.resolveDeliveryPolicy(RESTAURANT);
  ck('radius source is the platform when no config exists', fallback.sources.radius === 'platform');
  ck('ladder is derived (platform default) when no config exists',
    fallback.ladder === null && fallback.sources.ladder === 'derived');
  ck('maxAttempts has no restaurant override when no config exists',
    fallback.maxAttempts === null && fallback.sources.maxAttempts === 'platform');
  ck('zones default to empty', Array.isArray(fallback.zones) && fallback.zones.length === 0);
  ck('surge defaults to disabled', fallback.surge.enabled === false);

  const platformLadder = await dispatchService.resolveLadder();
  const perRestaurant = await dispatchService.resolveLadderForRestaurant(RESTAURANT);
  ck('per-restaurant ladder equals the platform ladder without a config',
    JSON.stringify(perRestaurant.ladder) === JSON.stringify(platformLadder.ladder));
  ck('per-restaurant ceiling equals the platform radius without a config',
    perRestaurant.zoneCeilingMeters === platformLadder.zoneCeilingMeters);
  ck('per-restaurant maxAttempts equals the platform default without a config',
    perRestaurant.maxAttempts === platformLadder.maxAttempts);

  console.log('\n=== 3-1 a set field overrides, clearing restores the fallback ===\n');

  await policy.updateDeliveryConfig(RESTAURANT, {
    deliveryRadiusMeters: 4500,
    maxDispatchAttempts: 2,
    escalationLadder: [
      { radiusMeters: 2000, batchSize: 2, ttlSeconds: 30 },
      { radiusMeters: 4500, batchSize: 4, ttlSeconds: 45 },
    ],
  });
  const overridden = await policy.resolveDeliveryPolicy(RESTAURANT);
  ck('radius source is the restaurant once set',
    overridden.sources.radius === 'restaurant' && overridden.radiusMeters === 4500, JSON.stringify(overridden.radiusMeters));
  ck('custom ladder is returned once set',
    overridden.ladder && overridden.ladder.length === 2 && overridden.ladder[0].batchSize === 2);
  ck('custom maxAttempts is returned once set', overridden.maxAttempts === 2);

  const customLadder = await dispatchService.resolveLadderForRestaurant(RESTAURANT);
  ck('the engine picks up the custom ladder', customLadder.ladder.length === 2);
  ck('the engine picks up the custom ceiling', customLadder.zoneCeilingMeters === 4500);
  ck('the engine picks up the custom maxAttempts', customLadder.maxAttempts === 2);

  const badPatch = await policy.updateDeliveryConfig(RESTAURANT, {
    deliveryRadiusMeters: -50,
    batchSizes: [0, 99],
    maxDispatchAttempts: 99,
  });
  ck('a negative radius is dropped, not stored', badPatch.deliveryRadiusMeters === 4500, JSON.stringify(badPatch.deliveryRadiusMeters));
  ck('batch sizes are clamped into range',
    JSON.stringify(badPatch.batchSizes) === JSON.stringify([1, 20]), JSON.stringify(badPatch.batchSizes));
  ck('maxAttempts is clamped, not stored raw', badPatch.maxDispatchAttempts === 10, JSON.stringify(badPatch.maxDispatchAttempts));

  // Restore the intended attempts for the tests below.
  await policy.updateDeliveryConfig(RESTAURANT, { maxDispatchAttempts: 2 });
  // Parallel arrays compose a ladder when no explicit ladder is set.
  await policy.updateDeliveryConfig(RESTAURANT, {}, ['escalationLadder']);
  await policy.updateDeliveryConfig(RESTAURANT, { batchSizes: [2, 3], offerTtlSeconds: [30, 40] });
  const composed = await policy.resolveDeliveryPolicy(RESTAURANT);
  ck('parallel batchSizes/offerTtlSeconds compose a ladder',
    composed.ladder && composed.ladder.length === 2 && composed.ladder[0].batchSize === 2 && composed.ladder[1].ttlSeconds === 40,
    JSON.stringify(composed.ladder));

  await policy.updateDeliveryConfig(RESTAURANT, {}, ['deliveryRadiusMeters', 'maxDispatchAttempts', 'batchSizes', 'offerTtlSeconds']);
  const restored = await policy.resolveDeliveryPolicy(RESTAURANT);
  ck('clearing overrides restores the platform radius', restored.sources.radius === 'platform');
  ck('clearing overrides restores the derived ladder', restored.ladder === null);

  console.log('\n=== A-1 city default radius (+ registration cap) ===\n');

  await City.create({
    _id: CITY2,
    name: 'Phase3 City ' + STAMP,
    image: 'c',
    location: { type: 'Point', coordinates: KITCHEN },
    defaultDeliveryRadiusMeters: 6000,
  });
  await makeRestaurant(CITY_RESTAURANT, 'Phase3 City Kitchen').then((r) =>
    Restaurant.updateOne({ _id: r._id }, { $set: { city: CITY2 } })
  );
  const cityPolicy = await policy.resolveDeliveryPolicy(CITY_RESTAURANT);
  ck('a city default applies with no restaurant config',
    cityPolicy.sources.radius === 'city' && cityPolicy.radiusMeters === 6000, JSON.stringify(cityPolicy.radiusMeters));

  await policy.updateDeliveryConfig(CITY_RESTAURANT, { deliveryRadiusMeters: 4500 });
  const cityOverridden = await policy.resolveDeliveryPolicy(CITY_RESTAURANT);
  ck('a restaurant override still beats the city default',
    cityOverridden.sources.radius === 'restaurant' && cityOverridden.radiusMeters === 4500);
  await policy.updateDeliveryConfig(CITY_RESTAURANT, {}, ['deliveryRadiusMeters']);
  const cityRestored = await policy.resolveDeliveryPolicy(CITY_RESTAURANT);
  ck('clearing the override falls back to the city, not the platform',
    cityRestored.sources.radius === 'city' && cityRestored.radiusMeters === 6000);

  // Legacy / hand-edited bad values never widen or break resolution.
  await City.updateOne({ _id: CITY2 }, { $set: { defaultDeliveryRadiusMeters: -5 } });
  const badCity = await policy.resolveDeliveryPolicy(CITY_RESTAURANT);
  ck('an unusable city value falls through to the platform',
    badCity.sources.radius === 'platform', JSON.stringify(badCity.sources.radius));
  await City.updateOne({ _id: CITY2 }, { $set: { defaultDeliveryRadiusMeters: 6000 } });

  // Registration is shrink-only and inherit-by-default.
  ck('signup caps an excessive request at the city default',
    (await restaurantService.resolveSignupRadiusMeters(CITY2, 50000)) === 6000);
  ck('signup keeps a narrower request as-is',
    (await restaurantService.resolveSignupRadiusMeters(CITY2, 2000)) === 2000);
  ck('signup with nothing requested stores nothing (inherit)',
    (await restaurantService.resolveSignupRadiusMeters(CITY2, null)) === null);
  ck('signup with garbage requested stores nothing (inherit)',
    (await restaurantService.resolveSignupRadiusMeters(CITY2, 'abc')) === null);
  ck('signup without a city caps at the platform radius',
    (await restaurantService.resolveSignupRadiusMeters(new mongoose.Types.ObjectId(), 50000)) !== null);

  const signupUser = await makeUser();
  const signupRestaurant = await restaurantService.createRestaurant({
    userId: signupUser._id,
    name: 'Signup Cap Kitchen ' + STAMP,
    address: 'a',
    shortDescription: 'x',
    cuisine: [new mongoose.Types.ObjectId()],
    logo: 'l',
    cover: 'c',
    city: CITY2,
    latitude: KITCHEN[1],
    longitude: KITCHEN[0],
    locationType: 'Point',
    type: 'commission',
    approxDeliveryTime: 30,
    dishPriceForTwo: 200,
    minOrderAmount: 100,
    restaurantType: [new mongoose.Types.ObjectId()],
    restaurantFacility: [new mongoose.Types.ObjectId()],
    deliveryRadiusMeters: 50000,
  });
  ck('a restaurant created with an excessive radius stores the capped value',
    signupRestaurant.deliveryConfig &&
      signupRestaurant.deliveryConfig.deliveryRadiusMeters === 6000,
    JSON.stringify(signupRestaurant.deliveryConfig));
  await Restaurant.deleteMany({ _id: signupRestaurant._id });

  // City service carries the field on create and update-with-present-key.
  await cityService.createCity({
    name: 'Phase3 Unset City ' + STAMP,
    image: 'c',
    latitude: KITCHEN[1],
    longitude: KITCHEN[0],
    type: 'Point',
  });
  const unsetCity = await City.findOne({ name: 'Phase3 Unset City ' + STAMP }).lean();
  ck('a city created without the field stores null (platform fallback)',
    unsetCity && unsetCity.defaultDeliveryRadiusMeters === null);
  await cityService.updateCityById(unsetCity._id, {
    name: unsetCity.name,
    image: 'c',
    type: 'Point',
    latitude: KITCHEN[1],
    longitude: KITCHEN[0],
    defaultDeliveryRadiusMeters: 7000,
  });
  const setCity = await City.findById(unsetCity._id).lean();
  ck('city update sets the default radius', setCity.defaultDeliveryRadiusMeters === 7000);
  await cityService.updateCityById(unsetCity._id, {
    name: unsetCity.name,
    image: 'c',
    type: 'Point',
    latitude: KITCHEN[1],
    longitude: KITCHEN[0],
  });
  const keptCity = await City.findById(unsetCity._id).lean();
  ck('city update without the key leaves the value alone', keptCity.defaultDeliveryRadiusMeters === 7000);
  await City.deleteMany({ name: 'Phase3 Unset City ' + STAMP });

  console.log('\n=== A-2 zones form by nearest attachment ===\n');

  const locAt = (name, lng, lat) =>
    Locality.create({ name: name + ' ' + STAMP, city: CITY2, location: { type: 'Point', coordinates: [lng, lat] } });
  const nearLocs = [
    await locAt('P3NearA', KITCHEN[0], KITCHEN[1] + 0.5 / 111.32),
    await locAt('P3NearB', KITCHEN[0], KITCHEN[1] + 1.0 / 111.32),
    await locAt('P3NearC', KITCHEN[0], KITCHEN[1] + 1.5 / 111.32),
    await locAt('P3NearD', KITCHEN[0], KITCHEN[1] + 2.0 / 111.32),
  ];
  const farLocs = [
    await locAt('P3FarA', KITCHEN[0], KITCHEN[1] + 0.3),
    await locAt('P3FarB', KITCHEN[0] + 0.005, KITCHEN[1] + 0.3),
  ];

  const proposal = await zoneService.proposeZones(CITY2);
  ck('clustering separates the far pocket from the near pocket', proposal.groups.length === 2, JSON.stringify(proposal.groups.length));
  ck('every proposed group fits the cap',
    proposal.groups.every((g) => g.diameterKm <= proposal.capKm), JSON.stringify(proposal.groups.map((g) => g.diameterKm)));
  const proposal2 = await zoneService.proposeZones(CITY2);
  ck('clustering is deterministic',
    JSON.stringify(proposal.groups.map((g) => g.localities.map((l) => String(l.id)).sort())) ===
      JSON.stringify(proposal2.groups.map((g) => g.localities.map((l) => String(l.id)).sort())));

  const pubFirst = await zoneService.publishZones(
    CITY2,
    [
      { name: 'P3 North', localities: [nearLocs[0]._id, nearLocs[1]._id] },
      { name: 'P3 Mid', localities: [nearLocs[2]._id, nearLocs[3]._id] },
      { name: 'P3 Far', localities: [farLocs[0]._id, farLocs[1]._id] },
    ],
    { reason: 'initial clustering' }
  );
  ck('first publish creates the zones', pubFirst.created === 3 && pubFirst.updated === 0, JSON.stringify(pubFirst));
  const listed = await zoneService.listZonesByCity(CITY2);
  ck('the city lists its zones', listed.length === 3);
  const historyAfterCreate = await DeliveryZoneHistory.countDocuments({ city: CITY2 });
  ck('every publish writes history', historyAfterCreate === 3, JSON.stringify(historyAfterCreate));

  const pubSame = await zoneService.publishZones(
    CITY2,
    [
      { name: 'P3 North', localities: [nearLocs[0]._id, nearLocs[1]._id] },
      { name: 'P3 Mid', localities: [nearLocs[2]._id, nearLocs[3]._id] },
      { name: 'P3 Far', localities: [farLocs[0]._id, farLocs[1]._id] },
    ],
    { reason: 'no-op republish' }
  );
  ck('republishing the same set changes nothing', pubSame.unchanged === 3 && pubSame.updated === 0, JSON.stringify(pubSame));

  const zoneOfNearA = await zoneService.resolveZoneForLocality(CITY2, nearLocs[0]._id);
  ck('a locality resolves to its zone', zoneOfNearA && zoneOfNearA.name === 'P3 North', zoneOfNearA && zoneOfNearA.name);
  ck('an unknown locality resolves to null',
    (await zoneService.resolveZoneForLocality(CITY2, new mongoose.Types.ObjectId())) === null);

  const pinZone = await zoneService.resolveZoneForPin(CITY2, KITCHEN[0], KITCHEN[1] + 0.6 / 111.32);
  ck('a pin resolves through its nearest locality',
    pinZone.zone && pinZone.locality && Number.isFinite(pinZone.distanceKm));
  const farPin = await zoneService.resolveZoneForPin(CITY2, KITCHEN[0] + 5, KITCHEN[1] + 5);
  ck('a pin far outside the city resolves to nothing', farPin.zone === null && farPin.locality === null);
  const badPinZone = await zoneService.resolveZoneForPin(CITY2, NaN, NaN);
  ck('an unusable pin resolves to nothing, not an exception', badPinZone.zone === null);

  const otherLoc = await Locality.create({
    name: 'P3Other' + STAMP,
    city: CITY,
    location: { type: 'Point', coordinates: KITCHEN },
  });
  const dupeResult = await throws409(() =>
    zoneService.publishZones(CITY2, [
      { name: 'X', localities: [nearLocs[0]._id] },
      { name: 'Y', localities: [nearLocs[0]._id, nearLocs[1]._id] },
    ])
  );
  ck('a locality in two zones is refused', dupeResult === '422', String(dupeResult));
  const wideResult = await throws409(() =>
    zoneService.publishZones(CITY2, [
      { name: 'Too Wide', localities: [...nearLocs.map((l) => l._id), ...farLocs.map((l) => l._id)] },
    ])
  );
  ck('an over-wide group is refused with outliers', wideResult === '422', String(wideResult));
  const crossResult = await throws409(() =>
    zoneService.publishZones(CITY2, [{ name: 'Cross', localities: [otherLoc._id] }])
  );
  ck('a locality from another city is refused', crossResult === '422', String(crossResult));

  const moveFrom = await zoneService.resolveZoneForLocality(CITY2, nearLocs[2]._id);
  const moveToZones = await zoneService.listZonesByCity(CITY2);
  const moveTo = moveToZones.find((z) => z.name === 'P3 North');
  const zoneMoved = await zoneService.moveLocality(nearLocs[2]._id, moveTo._id, { reason: 'review adjustment' });
  ck('a locality moves between zones', zoneMoved.status === 'moved' && String(zoneMoved.from) === String(moveFrom._id));
  const movedZone = await zoneService.resolveZoneForLocality(CITY2, nearLocs[2]._id);
  ck('resolution follows the move', String(movedZone._id) === String(moveTo._id));
  const sameMove = await zoneService.moveLocality(nearLocs[2]._id, moveTo._id);
  ck('moving within the same zone is a no-op', sameMove.status === 'unchanged');
  const stretchMove = await throws409(() => zoneService.moveLocality(farLocs[0]._id, moveTo._id));
  ck('a move that would stretch the target is refused', stretchMove === '422', String(stretchMove));
  const historyAfterMove = await DeliveryZoneHistory.countDocuments({ city: CITY2 });
  ck('moves append history on both sides', historyAfterMove > historyAfterCreate, JSON.stringify(historyAfterMove));

  const beforeRepublish = await DeliveryZone.find({ city: CITY2, status: true });
  const keepGroup = beforeRepublish.find((z) => z.name === 'P3 North');
  const retireResult = await zoneService.publishZones(
    CITY2,
    [{ name: keepGroup.name, localities: keepGroup.localities }],
    { reason: 'retire the rest' }
  );
  ck('dropping groups retires their zones', retireResult.retired === 2, JSON.stringify(retireResult));
  const afterRetire = await zoneService.listZonesByCity(CITY2);
  ck('retired zones leave the active list', afterRetire.length === 1);
  const retiredRows = await DeliveryZone.find({ city: CITY2, status: false }).lean();
  ck('retired rows are kept, not deleted', retiredRows.length === 2);

  console.log('\n=== A-3 served localities (+ membership check) ===\n');

  await policy.updateDeliveryConfig(CITY_RESTAURANT, {
    localities: [nearLocs[0]._id, nearLocs[1]._id],
  });
  const locPolicy = await policy.resolveDeliveryPolicy(CITY_RESTAURANT);
  ck('served localities resolve on the policy',
    locPolicy.localities.length === 2 && locPolicy.sources.localities === 'restaurant',
    JSON.stringify(locPolicy.localities));
  const crossLoc = await throws409(() =>
    policy.updateDeliveryConfig(CITY_RESTAURANT, { localities: [otherLoc._id] })
  );
  ck('a locality from another city is refused on the tick-list', crossLoc === '422', String(crossLoc));
  await policy.updateDeliveryConfig(CITY_RESTAURANT, { localities: ['not-an-id', nearLocs[0]._id] });
  const scrubbed = await policy.resolveDeliveryPolicy(CITY_RESTAURANT);
  ck('unusable ids are dropped, valid ones kept',
    scrubbed.localities.length === 1 && scrubbed.localities[0] === String(nearLocs[0]._id),
    JSON.stringify(scrubbed.localities));
  await policy.updateDeliveryConfig(CITY_RESTAURANT, {
    localities: [nearLocs[0]._id, nearLocs[1]._id],
  });

  const hit = await policy.resolveCustomerCoverage({
    restaurantId: CITY_RESTAURANT,
    customerLng: KITCHEN[0],
    customerLat: KITCHEN[1] + 0.5 / 111.32,
    customerLocalityId: String(nearLocs[0]._id),
  });
  ck('a served locality with an address ref is covered',
    hit.inside === true && hit.level === 'localities' && hit.reason === 'in_served_localities',
    JSON.stringify({ inside: hit.inside, level: hit.level, reason: hit.reason }));
  ck('coverage carries the delivery zone', hit.zone && hit.zone.name === 'P3 North', hit.zone && hit.zone.name);

  const miss = await policy.resolveCustomerCoverage({
    restaurantId: CITY_RESTAURANT,
    customerLng: KITCHEN[0],
    customerLat: KITCHEN[1] + 2.0 / 111.32,
    customerLocalityId: String(nearLocs[3]._id),
  });
  ck('an unticked locality is not covered, however close',
    miss.inside === false && miss.reason === 'outside_served_localities', JSON.stringify(miss.reason));

  const nearestHit = await policy.resolveCustomerCoverage({
    restaurantId: CITY_RESTAURANT,
    customerLng: KITCHEN[0],
    customerLat: KITCHEN[1] + 1.0 / 111.32,
  });
  ck('without a ref the nearest locality decides (served)',
    nearestHit.inside === true && nearestHit.reason === 'in_served_localities', JSON.stringify(nearestHit.reason));

  const nearestMiss = await policy.resolveCustomerCoverage({
    restaurantId: CITY_RESTAURANT,
    customerLng: KITCHEN[0],
    customerLat: KITCHEN[1] + 0.3,
  });
  ck('without a ref the nearest locality decides (unserved)',
    nearestMiss.inside === false && nearestMiss.reason === 'outside_served_localities',
    JSON.stringify(nearestMiss.reason));

  await policy.updateDeliveryConfig(CITY_RESTAURANT, { localities: [farLocs[0]._id] });
  const beyondList = await policy.resolveCustomerCoverage({
    restaurantId: CITY_RESTAURANT,
    customerLng: KITCHEN[0],
    customerLat: KITCHEN[1] + 0.3,
    customerLocalityId: String(farLocs[0]._id),
  });
  ck('a served locality past rider range is still outside',
    beyondList.inside === false && beyondList.reason === 'beyond_radius', JSON.stringify(beyondList.reason));

  const badPinCoverage = await policy.resolveCustomerCoverage({
    restaurantId: CITY_RESTAURANT,
    customerLng: NaN,
    customerLat: NaN,
  });
  ck('an unusable pin is outside, not an exception', badPinCoverage.inside === false && badPinCoverage.reason === 'invalid_pin');

  // Polygon level outranks the tick-list when both are configured.
  await policy.updateDeliveryConfig(CITY_RESTAURANT, {
    localities: [nearLocs[0]._id],
    zones: [
      {
        name: 'core',
        geometry: [
          [KITCHEN[0] - 0.01, KITCHEN[1] - 0.01],
          [KITCHEN[0] + 0.01, KITCHEN[1] - 0.01],
          [KITCHEN[0] + 0.01, KITCHEN[1] + 0.01],
          [KITCHEN[0] - 0.01, KITCHEN[1] + 0.01],
          [KITCHEN[0] - 0.01, KITCHEN[1] - 0.01],
        ],
        enabled: true,
      },
    ],
  });
  const polyFirst = await policy.resolveCustomerCoverage({
    restaurantId: CITY_RESTAURANT,
    customerLng: KITCHEN[0],
    customerLat: KITCHEN[1] + 0.5 / 111.32,
    customerLocalityId: String(nearLocs[3]._id),
  });
  ck('the polygon level decides when both levels are set',
    polyFirst.inside === true && polyFirst.level === 'polygon', JSON.stringify({ inside: polyFirst.inside, level: polyFirst.level }));
  await policy.updateDeliveryConfig(CITY_RESTAURANT, {}, ['zones', 'localities']);
  const cleared = await policy.resolveDeliveryPolicy(CITY_RESTAURANT);
  ck('clearing the list restores inheritance', cleared.localities.length === 0 && cleared.sources.localities === 'inherit');
  const radiusFallback = await policy.resolveCustomerCoverage({
    restaurantId: CITY_RESTAURANT,
    customerLng: KITCHEN[0],
    customerLat: KITCHEN[1] + 0.5 / 111.32,
  });
  ck('with nothing configured the radius decides',
    radiusFallback.inside === true && radiusFallback.level === 'radius', JSON.stringify(radiusFallback.level));

  console.log('\n=== A-4 zone tagging + per-zone metrics ===\n');

  const northZone = await DeliveryZone.findOne({ city: CITY2, status: true }).lean();
  const pinRaw = (lng, lat) => JSON.stringify({ location: { type: 'Point', coordinates: [lng, lat] } });

  // Riders in CITY2 — the shared fixtures live in CITY and never match here.
  const zoneRiderA = await makeDriver(0.5, 0, { city: CITY2 });
  const zoneRiderB = await makeDriver(0.7, 0, { city: CITY2 });

  const taggedOrder = await makeOrder(CITY_RESTAURANT, {
    deliveryAddressRaw: pinRaw(KITCHEN[0], KITCHEN[1] + 0.5 / 111.32),
  });
  const taggedDispatch = await dispatchService.dispatch(taggedOrder._id, CITY_RESTAURANT);
  ck('broadcast works for the zone-tagged order', taggedDispatch.status === 'broadcast', JSON.stringify(taggedDispatch));
  const taggedAttempt = await DispatchAttempt.findOne({ order: taggedOrder._id }).lean();
  ck('the attempt carries the customer zone',
    taggedAttempt && String(taggedAttempt.zone) === String(northZone._id) && taggedAttempt.zoneVersion === northZone.version,
    JSON.stringify(taggedAttempt && { zone: taggedAttempt.zone, v: taggedAttempt.zoneVersion }));
  const taggedEvents = await eventsForOrder(taggedOrder._id);
  ck('dispatched/offered events carry the zone',
    taggedEvents.length >= 2 && taggedEvents.every((e) => String(e.zone) === String(northZone._id)),
    JSON.stringify(taggedEvents.map((e) => ({ t: e.type, z: e.zone }))));

  const plainOrder = await makeOrder(CITY_RESTAURANT);
  await dispatchService.dispatch(plainOrder._id, CITY_RESTAURANT);
  const plainAttempt = await DispatchAttempt.findOne({ order: plainOrder._id }).lean();
  ck('an unparseable address tags nothing and breaks nothing',
    plainAttempt && plainAttempt.zone === null);

  const addrUser = await makeUser();
  const servedAddress = await UserAddress.create({
    user: addrUser._id,
    title: 0,
    receiverName: 'Zone Test',
    countryCode: 91,
    receiverContact: '9000000001',
    flatHouse: '1',
    locality: 'P3NearB',
    localityRef: nearLocs[1]._id,
    cityRef: CITY2,
    location: { type: 'Point', coordinates: [KITCHEN[0], KITCHEN[1] + 1.0 / 111.32] },
  });
  const refTag = await zoneService.resolveOrderZone({
    deliveryAddress: servedAddress._id,
    deliveryAddressRaw: '',
    restaurant: CITY_RESTAURANT,
  });
  ck('an address ref resolves straight to its zone',
    refTag.zone && String(refTag.zone) === String(northZone._id), JSON.stringify(refTag.zone));

  const manualZoneOrder = await makeOrder(CITY_RESTAURANT, {
    status: 'created',
    deliveryAddressRaw: pinRaw(KITCHEN[0], KITCHEN[1] + 0.5 / 111.32),
  });
  await ordersService.prepareOrder(manualZoneOrder._id, {
    vendorId: CITY_RESTAURANT,
    driverId: String(zoneRiderB.userId),
    time: 10,
  });
  const manualZoneEvents = await eventsForOrder(manualZoneOrder._id);
  ck('manual offered events carry the zone',
    manualZoneEvents.some((e) => e.type === 'offered' && String(e.zone) === String(northZone._id)),
    JSON.stringify(manualZoneEvents.map((e) => ({ t: e.type, z: e.zone }))));

  const acceptZoneOffer = await DriverNewOrderStatus.findOne({ orderId: taggedOrder._id, driverOrderStatus: 'ideal' });
  await ordersService.driverAcceptOrder(acceptZoneOffer._id, taggedOrder._id, acceptZoneOffer.driver);
  const acceptZoneEvents = await eventsForOrder(taggedOrder._id);
  ck('the accepted event carries the zone',
    acceptZoneEvents.some((e) => e.type === 'accepted' && String(e.zone) === String(northZone._id)));

  await driverService.updateDriverLocation(zoneRiderA.userId, KITCHEN[1] + 0.5 / 111.32, KITCHEN[0]);
  const heartbeatDriver = await Driver.findById(zoneRiderA._id).lean();
  ck('a heartbeat tags the rider zone',
    heartbeatDriver.zone && String(heartbeatDriver.zone) === String(northZone._id) && heartbeatDriver.zoneUpdatedAt instanceof Date);

  // Checkout stamps the zone: the production path (createOrder), not the fixture.
  const checkoutOrder = await ordersService.createOrder({
    orderNo: 910000 + seq,
    user: addrUser._id,
    payment: PAYMENT,
    restaurant: CITY_RESTAURANT,
    cartItemRaw: '[]',
    orderAt: new Date(),
    orderTo: 'homedelivery',
    deliveryAddress: servedAddress._id,
    deliveryAddressRaw: pinRaw(KITCHEN[0], KITCHEN[1] + 1.0 / 111.32),
    grandTotal: 10000,
  });
  ck('checkout stamps the customer zone',
    checkoutOrder.zone && String(checkoutOrder.zone) === String(northZone._id),
    JSON.stringify(checkoutOrder.zone));
  await transitions.transitionFoodOrderStatus(checkoutOrder._id, 'created');
  await transitions.transitionFoodOrderStatus(checkoutOrder._id, 'preparing');

  const zoneMetrics = await dispatchMetrics.getZoneMetrics(String(CITY2));
  ck('zone metrics scope to the city', zoneMetrics.cityId === String(CITY2));
  ck('zone metrics list the active zones', zoneMetrics.zones.length === 1 && zoneMetrics.zones[0].name === 'P3 North');
  const northMetrics = zoneMetrics.zones[0];
  ck('zone pending counts tagged open orders', northMetrics.pending >= 1, JSON.stringify(northMetrics.pending));
  ck('zone supply counts heartbeat-tagged riders', northMetrics.activeRiders >= 1, JSON.stringify(northMetrics.activeRiders));
  ck('zone offers are counted from the trail', northMetrics.offersBroadcast >= 1, JSON.stringify(northMetrics.offersBroadcast));
  ck('zone metrics carry accept rate + batch + percentiles',
    'offerAcceptRate' in northMetrics && 'avgBatchSize' in northMetrics && 'timeToAssignP50Seconds' in northMetrics);
  ck('the ungrouped bucket exists', zoneMetrics.ungrouped && zoneMetrics.ungrouped.name === 'Ungrouped');

  const ungrouped = await zoneService.checkUngroupedVolume(CITY2, { threshold: 0.99 });
  ck('ungrouped volume is measured', ungrouped.total >= 1 && ungrouped.ungrouped >= 1, JSON.stringify(ungrouped));
  ck('a high threshold means no alert', ungrouped.alert === false);
  const ungroupedAlarm = await zoneService.checkUngroupedVolume(CITY2, { threshold: 0.0001 });
  ck('a low threshold raises the alert', ungroupedAlarm.alert === true, JSON.stringify(ungroupedAlarm.ratio));

  console.log('\n=== A-5 pin guards (ranges, null island, city membership) ===\n');

  ck('shared latitude rejects the poles-plus', customValidation.latitude.validate(100).error !== undefined);
  ck('shared latitude accepts a real value', customValidation.latitude.validate(19.076).error === undefined);
  ck('shared longitude rejects out-of-range', customValidation.longitude.validate(200).error !== undefined);
  ck('shared longitude accepts a real value', customValidation.longitude.validate(72.8777).error === undefined);

  const pinRejects = async (fn) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e && (e.statusCode === 422 || e.status === 422) ? '422' : 'OTHER:' + (e && e.message);
    }
  };
  ck('null island is refused', (await pinRejects(() => pinGuard.assertUsablePin(0, 0))) === '422');
  ck('near-zero is refused', (await pinRejects(() => pinGuard.assertUsablePin(0.0005, -0.0004))) === '422');
  ck('out-of-range is refused', (await pinRejects(() => pinGuard.assertUsablePin(72.8, 95))) === '422');
  ck('a real pin passes', (await pinGuard.assertUsablePin(KITCHEN[0], KITCHEN[1], 'T')) !== null);

  const memberLocality = await pinGuard.assertLocalityInCity(nearLocs[0]._id, CITY2);
  ck('a city locality passes membership', String(memberLocality.city) === String(CITY2));
  ck('a cross-city locality is refused',
    (await pinRejects(() => pinGuard.assertLocalityInCity(otherLoc._id, CITY2))) === '422');
  const pinCityOk = await pinGuard.assertPinInCity(CITY2, KITCHEN[0], KITCHEN[1]);
  ck('a pin among city localities passes', pinCityOk && pinCityOk.city !== undefined);
  ck('a pin far outside the city is refused',
    (await pinRejects(() => pinGuard.assertPinInCity(CITY2, KITCHEN[0] + 5, KITCHEN[1] + 5))) === '422');
  const emptyCity = new mongoose.Types.ObjectId();
  ck('a city with no localities cannot validate — onboarding is not blocked',
    (await pinGuard.assertPinInCity(emptyCity, KITCHEN[0] + 5, KITCHEN[1] + 5)) === null);

  const vendorParam = (cityId, lng, lat, extra = {}) => ({
    userId: new mongoose.Types.ObjectId(),
    name: 'Guard Kitchen ' + STAMP,
    address: 'a',
    shortDescription: 'x',
    cuisine: [new mongoose.Types.ObjectId()],
    logo: 'l',
    cover: 'c',
    city: cityId,
    latitude: lat,
    longitude: lng,
    locationType: 'Point',
    type: 'commission',
    approxDeliveryTime: 30,
    dishPriceForTwo: 200,
    minOrderAmount: 100,
    restaurantType: [new mongoose.Types.ObjectId()],
    restaurantFacility: [new mongoose.Types.ObjectId()],
    ...extra,
  });
  const zeroPinRestaurant = await pinRejects(() =>
    restaurantService.createRestaurant(vendorParam(CITY2, 0, 0))
  );
  ck('restaurant onboarding refuses null island', zeroPinRestaurant === '422', String(zeroPinRestaurant));
  const crossLocRestaurant = await pinRejects(() =>
    restaurantService.createRestaurant(vendorParam(CITY2, KITCHEN[0], KITCHEN[1], { locality: otherLoc._id }))
  );
  ck('restaurant onboarding refuses a cross-city locality', crossLocRestaurant === '422', String(crossLocRestaurant));
  const farPinRestaurant = await pinRejects(() =>
    restaurantService.createRestaurant(vendorParam(CITY2, KITCHEN[0] + 5, KITCHEN[1] + 5))
  );
  ck('restaurant onboarding refuses an out-of-city pin', farPinRestaurant === '422', String(farPinRestaurant));
  const goodRestaurant = await restaurantService.createRestaurant(
    vendorParam(CITY2, KITCHEN[0], KITCHEN[1], { locality: nearLocs[0]._id })
  );
  ck('a clean onboarding still creates', !!goodRestaurant._id);
  await Restaurant.deleteMany({ _id: goodRestaurant._id });

  ck('city creation refuses null island',
    (await pinRejects(() =>
      cityService.createCity({ name: 'P3 Zero ' + STAMP, image: 'c', latitude: 0, longitude: 0, type: 'Point' })
    )) === '422');

  const addrUser2 = await makeUser();
  ck('address saving refuses null island',
    (await pinRejects(() =>
      addressService.saveAddress({
        user: addrUser2._id,
        title: 0,
        receiverName: 'Guard',
        receiverContact: '9000000002',
        countryCode: 91,
        flatHouse: '2',
        locality: 'nowhere',
        type: 'Point',
        longitude: 0,
        latitude: 0,
      })
    )) === '422');
  const goodAddress = await addressService.saveAddress({
    user: addrUser2._id,
    title: 0,
    receiverName: 'Guard',
    receiverContact: '9000000002',
    countryCode: 91,
    flatHouse: '2',
    locality: 'nearby',
    type: 'Point',
    longitude: KITCHEN[0],
    latitude: KITCHEN[1],
  });
  ck('a clean address still saves', !!goodAddress._id);
  const updatedAddress = await addressService.updateAddress(goodAddress._id, {
    user: addrUser2._id,
    title: 0,
    receiverName: 'Guard',
    receiverContact: '9000000002',
    countryCode: 91,
    flatHouse: '3',
    locality: 'nearby',
    type: 'Point',
    longitude: KITCHEN[0],
    latitude: KITCHEN[1],
  });
  ck('a clean address update still works', String(updatedAddress._id) === String(goodAddress._id));
  await UserAddress.deleteMany({ _id: goodAddress._id });

  console.log('\n=== B-1 pin to locality suggestion ===\n');

  const suggest = await localityService.getNearestLocality({
    city: String(CITY2),
    latitude: KITCHEN[1] + 1.07 / 111.32,
    longitude: KITCHEN[0],
  });
  ck('the nearest locality is suggested with its distance',
    suggest.locality && String(suggest.locality.id) === String(nearLocs[1]._id) && suggest.distanceKm > 0 && suggest.distanceKm < 1,
    JSON.stringify(suggest));
  const suggestFar = await localityService.getNearestLocality({
    city: String(CITY2),
    latitude: KITCHEN[1] + 5,
    longitude: KITCHEN[0] + 5,
  });
  ck('nothing nearby suggests nothing (200, not 404)', suggestFar.locality === null && suggestFar.distanceKm === null);
  ck('an invalid city is refused',
    (await pinRejects(() => localityService.getNearestLocality({ city: 'nope', latitude: 19, longitude: 72 }))) === '422');
  ck('out-of-range coordinates are refused',
    (await pinRejects(() => localityService.getNearestLocality({ city: String(CITY2), latitude: 95, longitude: 72 }))) === '422');
  const nearestQuery = localityValidation.nearestLocality.query.validate({
    city: String(CITY2),
    latitude: '19.08',
    longitude: '72.87',
  });
  ck('string coordinates coerce in the query validation', nearestQuery.error === undefined);
  ck('a missing city fails the query validation',
    localityValidation.nearestLocality.query.validate({ latitude: 19, longitude: 72 }).error !== undefined);

  const publicRouter = require('../src/routes/v1/public.route.js');
  const publicPaths = publicRouter.stack.filter((l) => l.route).map((l) => l.route.path);
  ck('GET /localities_nearest is registered (public, pre-auth)',
    publicPaths.includes('/localities_nearest'), JSON.stringify(publicPaths.filter((p) => /localit/i.test(p))));

  console.log('\n=== B-2 coverage routes (override / reset / zones) ===\n');

  const adminRouter = require('../src/routes/v1/admin.route.js');
  const adminPaths = adminRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  ck('PATCH delivery-config is registered (admin)',
    adminPaths.includes('PATCH /restaurant/delivery-config/:restaurantId'));
  ck('zone publish is registered (admin)', adminPaths.includes('POST /delivery-zones/publish/:cityId'));
  ck('zone move is registered (admin)', adminPaths.includes('PATCH /delivery-zones/move/:localityId'));
  const cityzenRouter = require('../src/routes/v1/cityzen.route.js');
  const cityzenPaths = cityzenRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  ck('PATCH delivery-config is registered (city-master)',
    cityzenPaths.includes('PATCH /update_restaurant_delivery_config/:restaurantId/:master'));
  ck('zone publish is registered (city-master)', cityzenPaths.includes('POST /delivery_zones/:master/publish/:cityId'));
  ck('zone move is registered (city-master)', cityzenPaths.includes('PATCH /delivery_zones/:master/move/:localityId'));

  const badRadiusPatch = deliveryConfigValidation.deliveryConfigPatch.body.validate({ deliveryRadiusMeters: 60000 });
  ck('an out-of-range radius fails validation', badRadiusPatch.error !== undefined);
  const goodRadiusPatch = deliveryConfigValidation.deliveryConfigPatch.body.validate({
    deliveryRadiusMeters: 4000,
    clearKeys: ['surge'],
  });
  ck('a valid patch with clearKeys passes validation', goodRadiusPatch.error === undefined);
  const cityzenParams = deliveryConfigValidation.cityzenDeliveryConfigPatch.params.validate({
    restaurantId: String(RESTAURANT),
  });
  ck('the cityzen variant requires :master', cityzenParams.error !== undefined);

  console.log('\n=== C-1 zone affinity (soft nudge, never a filter) ===\n');

  ck('same zone scores 1', dispatchScoring.zoneAffinityScore('a', 'a') === 1);
  ck('cross zone scores 0', dispatchScoring.zoneAffinityScore('a', 'b') === 0);
  ck('missing tags score neutral, not zero',
    dispatchScoring.zoneAffinityScore(null, 'a') === 0.5 && dispatchScoring.zoneAffinityScore('a', null) === 0.5);
  ck('weights still sum to 1',
    Math.abs(Object.values(dispatchScoring.DEFAULT_WEIGHTS).reduce((s, w) => s + w, 0) - 1) < 1e-9);

  const affinityBase = {
    distanceKm: 1.0,
    orderHandling: 0,
    maxOrderLimit: 5,
    rating: 4,
    updatedAt: new Date(),
    isOwnFleet: false,
    priorRejects: 0,
    radiusKm: 8,
  };
  const affinityRanked = dispatchScoring.rankCandidates([
    { ...affinityBase, zoneId: 'other', orderZoneId: 'home' },
    { ...affinityBase, zoneId: 'home', orderZoneId: 'home' },
  ]);
  ck('otherwise identical, the same-zone rider ranks first',
    affinityRanked[0].zoneId === 'home' && affinityRanked[1].zoneId === 'other');
  ck('the breakdown explains the decision',
    typeof affinityRanked[0].factors.zoneAffinity === 'number' && affinityRanked[0].factors.zoneAffinity === 1);
  const untaggedRanked = dispatchScoring.rankCandidates([
    { ...affinityBase, zoneId: null, orderZoneId: 'home' },
    { ...affinityBase, zoneId: null, orderZoneId: 'home' },
  ]);
  ck('untagged riders are not punished into an order',
    untaggedRanked[0].score === untaggedRanked[1].score);

  const affinityOffer = await DriverNewOrderStatus.findOne({ orderId: taggedOrder._id }).lean();
  ck('broadcasts snapshot the affinity factor',
    affinityOffer && affinityOffer.dispatchFactors && typeof affinityOffer.dispatchFactors.zoneAffinity === 'number',
    JSON.stringify(affinityOffer && affinityOffer.dispatchFactors));

  console.log('\n=== C-2 zone-level surge (higher lens wins) ===\n');

  await policy.updateDeliveryConfig(CITY_RESTAURANT, {
    surge: { enabled: true, demandThreshold: 1, multiplierCap: 3, peakHours: [] },
  });
  const zoneSurgePolicy = await policy.resolveDeliveryPolicy(CITY_RESTAURANT);
  // Overwhelming zone backlog: 10 live offers on the one North-tagged order,
  // one heartbeat-tagged rider → ratio 10 → capped at 3.
  const surgeSeedOffers = [];
  for (let i = 0; i < 10; i++) {
    surgeSeedOffers.push({
      orderId: checkoutOrder._id,
      driver: (i % 2 === 0 ? zoneRiderA : zoneRiderB).userId,
      restaurant: CITY_RESTAURANT,
      deliveryAddressRaw: 'surge probe',
      driverOrderStatus: 'ideal',
      orderFrom: 'auto',
    });
  }
  await DriverNewOrderStatus.insertMany(surgeSeedOffers);
  const zoneQuote = await dispatchService.quoteSurgeForRung(zoneSurgePolicy, CITY_RESTAURANT, 5, northZone._id);
  ck('zone backlog outbids a quiet restaurant',
    zoneQuote.multiplier === 3 && zoneQuote.reason === 'high_demand_zone', JSON.stringify(zoneQuote));
  const noZoneQuote = await dispatchService.quoteSurgeForRung(zoneSurgePolicy, CITY_RESTAURANT, 5, null);
  ck('without a zone the restaurant lens decides alone',
    noZoneQuote.reason !== 'high_demand_zone', JSON.stringify(noZoneQuote));
  await DriverNewOrderStatus.deleteMany({ orderId: checkoutOrder._id, deliveryAddressRaw: 'surge probe' });
  await policy.updateDeliveryConfig(CITY_RESTAURANT, {}, ['surge']);

  console.log('\n=== C-3 shadow replay (acceptors in the would-offer set) ===\n');

  const shadowOrder = await makeOrder(CITY_RESTAURANT, {
    deliveryAddressRaw: JSON.stringify({ location: { type: 'Point', coordinates: [KITCHEN[0], KITCHEN[1]] } }),
  });
  const shadow = await dispatchService.shadowDispatch(shadowOrder._id, CITY_RESTAURANT);
  ck('shadow replay names would-offer riders without writing',
    shadow && Array.isArray(shadow.wouldOffer) && shadow.wouldOffer.length >= 1,
    JSON.stringify(shadow && shadow.wouldOffer.length));
  const shadowOffersBefore = await DriverNewOrderStatus.countDocuments({ orderId: shadowOrder._id });
  ck('shadow mode writes no offers', shadowOffersBefore === 0);
  await Orders.deleteMany({ _id: shadowOrder._id });

  // The handler end to end (mocked res): override then reset. Note: the
  // codebase's catchAsync is fire-and-forget (it does not return the
  // promise), so the test waits on send/next instead of awaiting the call.
  const callHandler = (req) =>
    new Promise((resolve, reject) => {
      const res = { send: (b) => resolve({ sent: b }) };
      restaurantController.updateDeliveryConfigHandler(req, res, (e) =>
        e ? reject(e) : resolve({ next: true })
      );
    });
  const { sent: sentBody } = await callHandler({
    params: { restaurantId: String(RESTAURANT) },
    body: { deliveryRadiusMeters: 4000 },
  });
  ck('the handler stores the override',
    sentBody && sentBody.deliveryConfig && sentBody.deliveryConfig.deliveryRadiusMeters === 4000,
    JSON.stringify(sentBody && sentBody.deliveryConfig));
  await callHandler({
    params: { restaurantId: String(RESTAURANT) },
    body: { clearKeys: ['deliveryRadiusMeters'] },
  });
  const afterReset = await policy.resolveDeliveryPolicy(RESTAURANT);
  ck('the handler resets to inheritance', afterReset.sources.radius === 'platform');

  console.log('\n=== D-1 city-master scoping (403, not silent cross-city) ===\n');

  const masterIn = await makeUser();
  await User.updateOne({ _id: masterIn._id }, { $set: { city: CITY2 } });
  const masterOut = await makeUser();
  await User.updateOne({ _id: masterOut._id }, { $set: { city: CITY } });
  const owned = await restaurantService.assertMasterOwnsRestaurant(masterIn._id, CITY_RESTAURANT);
  ck('same-city master passes scoping', !!owned.restaurant);
  ck('cross-city restaurant access is forbidden',
    (await throws409(() => restaurantService.assertMasterOwnsRestaurant(masterOut._id, CITY_RESTAURANT))) === '403');
  ck('missing rows stay 404',
    (await throws409(() => restaurantService.assertMasterOwnsRestaurant(masterIn._id, new mongoose.Types.ObjectId()))) === '404');
  ck('cross-city zone access is forbidden',
    (await throws409(() => zoneService.assertMasterOwnsCity(masterOut._id, CITY2))) === '403');
  const scopedPublish = await throws409(() =>
    zoneService.publishZones(CITY2, [{ name: 'X', localities: [nearLocs[0]._id] }], { masterId: masterOut._id })
  );
  ck('cross-city publish writes nothing', scopedPublish === '403');
  const scopedMove = await throws409(() =>
    zoneService.moveLocality(nearLocs[0]._id, northZone._id, { masterId: masterOut._id })
  );
  ck('cross-city move writes nothing', scopedMove === '403');

  const scopedSent = await new Promise((resolve, reject) => {
    const res = { send: (b) => resolve({ sent: b }) };
    restaurantController.cityzenUpdateDeliveryConfigHandler(
      { params: { restaurantId: String(CITY_RESTAURANT), master: String(masterIn._id) }, body: { deliveryRadiusMeters: 5000 } },
      res,
      reject
    );
  });
  ck('in-scope city-master write applies',
    scopedSent.sent && scopedSent.sent.deliveryConfig && scopedSent.sent.deliveryConfig.deliveryRadiusMeters === 5000);
  const scopedReject = await new Promise((resolve) => {
    const res = { send: () => resolve({ sent: true }) };
    restaurantController.cityzenUpdateDeliveryConfigHandler(
      { params: { restaurantId: String(CITY_RESTAURANT), master: String(masterOut._id) }, body: { deliveryRadiusMeters: 4000 } },
      res,
      (e) => resolve({ rejected: e && (e.statusCode || e.status) })
    );
  });
  ck('out-of-scope city-master write is rejected', scopedReject.rejected === 403, JSON.stringify(scopedReject));
  await policy.updateDeliveryConfig(CITY_RESTAURANT, {}, ['deliveryRadiusMeters']);

  console.log('\n=== D-2 vendor self-narrowing (shrink-only) ===\n');

  const vendorUser = await makeUser();
  const vendorRestaurant = await restaurantService.createRestaurant({
    userId: vendorUser._id,
    name: 'Narrow Kitchen ' + STAMP,
    address: 'a',
    shortDescription: 'x',
    cuisine: [new mongoose.Types.ObjectId()],
    logo: 'l',
    cover: 'c',
    city: CITY2,
    locality: nearLocs[0]._id,
    latitude: KITCHEN[1],
    longitude: KITCHEN[0],
    locationType: 'Point',
    type: 'commission',
    approxDeliveryTime: 30,
    dishPriceForTwo: 200,
    minOrderAmount: 100,
    restaurantType: [new mongoose.Types.ObjectId()],
    restaurantFacility: [new mongoose.Types.ObjectId()],
  });
  await policy.updateDeliveryConfig(vendorRestaurant._id, { deliveryRadiusMeters: 4500 });
  const narrowed = await policy.narrowDeliveryConfig(vendorUser._id, { deliveryRadiusMeters: 2000 });
  ck('narrowing the radius applies', narrowed.deliveryRadiusMeters === 2000, JSON.stringify(narrowed));
  ck('widening the radius is refused with a pointer to the master',
    (await throws409(() => policy.narrowDeliveryConfig(vendorUser._id, { deliveryRadiusMeters: 9000 }))) === '422');
  const narrowedList = await policy.narrowDeliveryConfig(vendorUser._id, { localities: [nearLocs[0]._id] });
  ck('keeping a served subset applies', JSON.stringify(narrowedList.localities) === JSON.stringify([String(nearLocs[0]._id)]));
  ck('adding an unserved locality is refused',
    (await throws409(() => policy.narrowDeliveryConfig(vendorUser._id, { localities: [farLocs[0]._id] }))) === '422');
  ck('a vendor with no restaurant gets 404, not a write',
    (await throws409(() => policy.narrowDeliveryConfig(masterIn._id, { deliveryRadiusMeters: 1000 }))) === '404');
  ck('clearKeys is not even validatable on the narrow schema',
    deliveryConfigValidation.vendorDeliveryConfigNarrow.body.validate({ clearKeys: ['surge'] }).error !== undefined);
  const vendorRouter = require('../src/routes/v1/vendor.route.js');
  const vendorPaths = vendorRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  ck('PATCH narrow is registered without any :id (vendor resolves from auth)',
    vendorPaths.includes('PATCH /restaurant/delivery-config/narrow'));
  const { sent: narrowSent } = await new Promise((resolve, reject) => {
    const res = { send: (b) => resolve({ sent: b }) };
    restaurantController.narrowDeliveryConfigHandler({ user: { _id: vendorUser._id }, body: { deliveryRadiusMeters: 1500 } }, res, reject);
  });
  ck('the narrow handler stores via the authenticated vendor',
    narrowSent && narrowSent.deliveryConfig && narrowSent.deliveryConfig.deliveryRadiusMeters === 1500);
  await Restaurant.deleteMany({ _id: vendorRestaurant._id });

  console.log('\n=== G-4 rider zone card (display-only) ===\n');

  const zonedCard = await driverService.getMyZoneSummary(zoneRiderA.userId);
  ck('a tagged rider gets their zone card',
    zonedCard.zone && zonedCard.zone.name === 'P3 North' && Number.isFinite(zonedCard.openOrders) && Number.isFinite(zonedCard.activeRiders),
    JSON.stringify(zonedCard));
  const untaggedRiderUser = await makeUser();
  const untaggedRider = await makeDriver(3.0, 0);
  const untaggedCard = await driverService.getMyZoneSummary(untaggedRider.userId);
  ck('an untagged rider gets an empty card, not an error',
    untaggedCard.zone === null && untaggedCard.openOrders === 0 && untaggedCard.activeRiders === 0);
  ck('an unknown driver gets 404',
    (await throws409(() => driverService.getMyZoneSummary(new mongoose.Types.ObjectId()))) === '404');
  const driverRouter = require('../src/routes/v1/driver.route.js');
  const driverPaths = driverRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  ck('GET drivers/myZone is registered (no params, auth-resolved)',
    driverPaths.includes('GET /drivers/myZone'));
  void untaggedRiderUser;

  console.log('\n=== D-3 i18n keys ship with the screens ===\n');

  const adminEn = JSON.parse(
    require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'Admin_panel', 'src', 'assets', 'i18n', 'en.json'),
      'utf8'
    )
  );
  ck('admin coverage keys exist',
    ['delivery_coverage', 'delivery_radius', 'use_default', 'custom', 'served_localities', 'select_localities'].every((k) => k in adminEn));
  const appEn = JSON.parse(
    require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'Restaurant_app', 'lib', 'app', 'l10n', 'app_en.arb'),
      'utf8'
    )
  );
  ck('app auto-detect key exists with placeholders',
    typeof appEn.detectedLocality === 'string' && appEn.detectedLocality.includes('{name}') && appEn.detectedLocality.includes('{distance}'));

  console.log('\n=== E-1 checkout coverage gate ===\n');

  const skipPickup = await policy.assertOrderCovered({
    restaurantId: String(CITY_RESTAURANT),
    orderTo: 'selfpickup',
    deliveryAddress: servedAddress._id,
  });
  ck('self-pickup skips the gate', skipPickup.skipped === 'not_home_delivery');
  const skipNoPin = await policy.assertOrderCovered({
    restaurantId: String(CITY_RESTAURANT),
    orderTo: 'homedelivery',
    deliveryAddressRaw: 'Customer address',
  });
  ck('unresolvable pins keep today behaviour (allowed)', skipNoPin.skipped === 'no_pin' && skipNoPin.inside === true);
  const coveredCheck = await policy.assertOrderCovered({
    restaurantId: String(CITY_RESTAURANT),
    orderTo: 'homedelivery',
    deliveryAddress: servedAddress._id,
  });
  ck('a covered pin passes the gate', coveredCheck.inside === true);

  const farUser = await makeUser();
  const farAddress = await UserAddress.create({
    user: farUser._id,
    title: 0,
    receiverName: 'Far Away',
    countryCode: 91,
    receiverContact: '9000000003',
    flatHouse: '9',
    locality: 'far',
    location: { type: 'Point', coordinates: [KITCHEN[0], KITCHEN[1] + 0.3] },
  });
  const farCheck = await throws409(() =>
    policy.assertOrderCovered({
      restaurantId: String(CITY_RESTAURANT),
      orderTo: 'homedelivery',
      deliveryAddress: farAddress._id,
    })
  );
  ck('an uncovered pin is refused, not silently created', farCheck === '422', String(farCheck));

  const checkoutUser = await makeUser();
  const gatedOrder = await ordersService.createOrder({
    orderNo: 920000 + seq,
    user: checkoutUser._id,
    payment: PAYMENT,
    restaurant: CITY_RESTAURANT,
    cartItemRaw: '[]',
    orderAt: new Date(),
    orderTo: 'homedelivery',
    deliveryAddress: servedAddress._id,
    grandTotal: 10000,
  });
  ck('a covered checkout creates the order', !!gatedOrder._id);
  const countBefore = await Orders.countDocuments({ restaurant: CITY_RESTAURANT });
  const gatedReject = await throws409(() =>
    ordersService.createOrder({
      orderNo: 921000 + seq,
      user: checkoutUser._id,
      payment: PAYMENT,
      restaurant: CITY_RESTAURANT,
      cartItemRaw: '[]',
      orderAt: new Date(),
      orderTo: 'homedelivery',
      deliveryAddress: farAddress._id,
      grandTotal: 10000,
    })
  );
  const countAfter = await Orders.countDocuments({ restaurant: CITY_RESTAURANT });
  ck('an uncovered checkout fails before any write', gatedReject === '422' && countAfter === countBefore);
  await UserAddress.deleteMany({ _id: farAddress._id });

  console.log('\n=== E-2 metrics endpoints (read-only dashboards) ===\n');

  const callCtrl = (fn, req) =>
    new Promise((resolve, reject) => {
      const res = { send: (b) => resolve({ sent: b }) };
      fn(req, res, (e) => (e ? reject(e) : resolve({ next: true })));
    });
  const metricsPaths = adminRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  ck('GET dispatch metrics is registered (admin)', metricsPaths.includes('GET /dispatch/metrics'));
  ck('GET zone metrics is registered (admin)', metricsPaths.includes('GET /delivery-zones/metrics/:cityId'));
  ck('GET ungrouped is registered (admin)', metricsPaths.includes('GET /delivery-zones/ungrouped/:cityId'));
  const cityzenMetricsPaths = cityzenRouter.stack
    .filter((l) => l.route)
    .map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  ck('GET dispatch metrics is registered (city-master)', cityzenMetricsPaths.includes('GET /dispatch/metrics/:master'));
  ck('GET zone metrics is registered (city-master)', cityzenMetricsPaths.includes('GET /delivery_zones/:master/metrics/:cityId'));

  const { sent: metricsSent } = await callCtrl(dispatchController.getMetrics, { query: {} });
  ck('dispatch metrics serve without scope', metricsSent && metricsSent.metrics && 'offerAcceptRate' in metricsSent.metrics);
  const { sent: zoneMetricsSent } = await callCtrl(dispatchController.getZoneMetrics, { params: { cityId: String(CITY2) }, query: {} });
  ck('zone metrics serve per city', zoneMetricsSent && zoneMetricsSent.metrics && zoneMetricsSent.metrics.zones.length === 1);
  const { sent: ungroupedSent } = await callCtrl(dispatchController.getUngrouped, { params: { cityId: String(CITY2) }, query: {} });
  ck('ungrouped serves with its threshold', ungroupedSent && ungroupedSent.ungrouped && Number.isFinite(ungroupedSent.ungrouped.ratio));
  const scopedZoneMetrics = await callCtrl(dispatchController.cityzenGetZoneMetrics, {
    params: { master: String(masterIn._id), cityId: String(CITY2) },
    query: {},
  });
  ck('in-scope city-master reads metrics', !!scopedZoneMetrics.sent);
  const scopedZoneDenied = await callCtrl(dispatchController.cityzenGetZoneMetrics, {
    params: { master: String(masterOut._id), cityId: String(CITY2) },
    query: {},
  }).then(
    () => ({ denied: false }),
    (e) => ({ denied: e && (e.statusCode === 403 || e.status === 403) })
  );
  ck('out-of-scope city-master reads are forbidden', scopedZoneDenied.denied === true);

  console.log('\n=== E-3 fleetFirst false means platform backup ===\n');

  const FLEET_RESTAURANT = new mongoose.Types.ObjectId();
  await makeRestaurant(FLEET_RESTAURANT, 'Phase3 Fleet Kitchen').then((r) =>
    Restaurant.updateOne({ _id: r._id }, { $set: { city: CITY2, ownDriver: true } })
  );
  const fleetUser = await makeUser();
  const fleetRider = await Driver.create({
    userId: fleetUser._id,
    city: CITY2,
    vehicle: new mongoose.Types.ObjectId(),
    location: { type: 'Point', coordinates: [KITCHEN[0], KITCHEN[1] + 0.4 / 111.32] },
    type: 'salary',
    identity: 'passport',
    identityNumber: 'P3' + STAMP + seq + 'F',
    identityProof: 'p',
    drivingLicense: 'DLP3' + STAMP,
    age: 30,
    dob: new Date('1990-01-01'),
    restaurant: FLEET_RESTAURANT,
    isBlocked: false,
    activeStatus: true,
    status: true,
    orderHandling: 0,
    rating: 4.5,
  });
  const fleetOrder = await makeOrder(FLEET_RESTAURANT);
  const fleetDefault = await dispatchService.dispatch(fleetOrder._id, FLEET_RESTAURANT);
  ck('own fleet dispatches to its own rider by default', fleetDefault.status === 'broadcast');
  const fleetOffer = await DriverNewOrderStatus.findOne({ orderId: fleetOrder._id }).lean();
  ck('the default offer names the fleet rider', fleetOffer && String(fleetOffer.driver) === String(fleetRider.userId));
  await policy.updateDeliveryConfig(FLEET_RESTAURANT, { fleetFirst: false, maxDispatchAttempts: 5 });
  const fleetOrder2 = await makeOrder(FLEET_RESTAURANT);
  const fleetBackup = await dispatchService.dispatch(fleetOrder2._id, FLEET_RESTAURANT);
  const backupOffer = await DriverNewOrderStatus.findOne({ orderId: fleetOrder2._id }).lean();
  const backupAttempt = await DispatchAttempt.findOne({ order: fleetOrder2._id }).lean();
  ck('fleetFirst false offers a platform rider instead of nobody',
    fleetBackup.status === 'broadcast' && backupOffer && String(backupOffer.driver) !== String(fleetRider.userId),
    JSON.stringify(backupOffer && backupOffer.driver));
  ck('the audit trail records the platform pool',
    backupAttempt && backupAttempt.pool === 'platform', JSON.stringify(backupAttempt && backupAttempt.pool));
  await policy.updateDeliveryConfig(FLEET_RESTAURANT, {}, ['fleetFirst', 'maxDispatchAttempts']);
  await Restaurant.deleteMany({ _id: FLEET_RESTAURANT });
  await Driver.deleteMany({ _id: fleetRider._id });
  await DriverNewOrderStatus.deleteMany({ restaurant: FLEET_RESTAURANT });
  await DispatchAttempt.deleteMany({ restaurant: FLEET_RESTAURANT });
  await Orders.deleteMany({ restaurant: FLEET_RESTAURANT });

  console.log('\n=== E-4 peak freeze (no redraws during rush) ===\n');

  const appConfig = require('../src/config/config.js');
  appConfig.zone.editionFrozen = true;
  ck('publish is refused while frozen',
    (await throws409(() =>
      zoneService.publishZones(CITY2, [{ name: 'P3 North', localities: [nearLocs[0]._id] }])
    )) === '422');
  ck('moves are refused while frozen',
    (await throws409(() => zoneService.moveLocality(nearLocs[1]._id, northZone._id))) === '422');
  const forcedPublish = await zoneService.publishZones(
    CITY2,
    [{ name: 'P3 North', localities: [nearLocs[0]._id, nearLocs[1]._id, nearLocs[2]._id] }],
    { force: true, reason: 'incident sign-off' }
  );
  ck('force with sign-off still publishes', forcedPublish.unchanged === 1, JSON.stringify(forcedPublish));
  appConfig.zone.editionFrozen = false;
  const thawedPublish = await zoneService.publishZones(
    CITY2,
    [{ name: 'P3 North', localities: [nearLocs[0]._id, nearLocs[1]._id, nearLocs[2]._id] }]
  );
  ck('thawed publishes flow normally', thawedPublish.unchanged === 1);

  const coversPaths = publicRouter.stack.filter((l) => l.route).map((l) => l.route.path);
  ck('GET /restaurants/covers/:restaurantId is registered (public)',
    coversPaths.includes('/restaurants/covers/:restaurantId'));
  ck('out-of-range pins fail covers validation',
    (() => {
      try {
        const v = require('../src/validations/restaurant.validation.js');
        return v.coverageCheckValidation.query.validate({ latitude: 95, longitude: 72 }).error !== undefined;
      } catch {
        return false;
      }
    })());

  console.log('\n=== 3-1 the broadcast honours the restaurant ladder ===\n');

  const r1 = await makeDriver(0.5, 0);
  const r2 = await makeDriver(0.7, 0);
  const r3 = await makeDriver(0.9, 0);
  await policy.updateDeliveryConfig(RESTAURANT, {
    escalationLadder: [{ radiusMeters: 2000, batchSize: 2, ttlSeconds: 60 }],
    maxDispatchAttempts: 5,
  });
  const ladderOrder = await makeOrder(RESTAURANT);
  const ladderDispatch = await dispatchService.dispatch(ladderOrder._id, RESTAURANT);
  ck('custom round 0 broadcasts its own batch size',
    ladderDispatch.status === 'broadcast' && ladderDispatch.offered === 2, JSON.stringify(ladderDispatch));
  const ladderEvents = await eventsForOrder(ladderOrder._id);
  ck('the broadcast wrote one dispatched event',
    ladderEvents.filter((e) => e.type === 'dispatched').length === 1);
  ck('the broadcast wrote one offered event per rider',
    ladderEvents.filter((e) => e.type === 'offered').length === 2);
  await policy.updateDeliveryConfig(RESTAURANT, {}, ['escalationLadder', 'maxDispatchAttempts']);
  void r1;
  void r2;
  void r3;

  console.log('\n=== 3-2 zones gate the pin, radius stays the backstop ===\n');

  const ring = [
    [KITCHEN[0] - 0.01, KITCHEN[1] - 0.01],
    [KITCHEN[0] + 0.01, KITCHEN[1] - 0.01],
    [KITCHEN[0] + 0.01, KITCHEN[1] + 0.01],
    [KITCHEN[0] - 0.01, KITCHEN[1] + 0.01],
    [KITCHEN[0] - 0.01, KITCHEN[1] - 0.01],
  ];
  const near = { lng: KITCHEN[0] + 0.001, lat: KITCHEN[1] + 0.001 };
  const far = { lng: KITCHEN[0] + 0.5, lat: KITCHEN[1] + 0.5 };

  const noZones = policy.isCustomerInDeliveryArea({
    kitchenCoords: KITCHEN,
    customerLng: near.lng,
    customerLat: near.lat,
    deliveryConfig: {},
    radiusMeters: 10000,
  });
  ck('without zones the radius check decides (inside)', noZones.inside === true && noZones.reason === 'inside_radius');
  const noZonesFar = policy.isCustomerInDeliveryArea({
    kitchenCoords: KITCHEN,
    customerLng: far.lng,
    customerLat: far.lat,
    deliveryConfig: {},
    radiusMeters: 10000,
  });
  ck('without zones the radius check decides (outside)', noZonesFar.inside === false && noZonesFar.reason === 'beyond_radius');

  const zoned = { zones: [{ name: 'core', geometry: ring, enabled: true }] };
  const inZone = policy.isCustomerInDeliveryArea({
    kitchenCoords: KITCHEN,
    customerLng: near.lng,
    customerLat: near.lat,
    deliveryConfig: zoned,
    radiusMeters: 10000,
  });
  ck('a pin inside the polygon is inside', inZone.inside === true && inZone.reason === 'inside_zone' && inZone.zone === 'core');
  const outZone = policy.isCustomerInDeliveryArea({
    kitchenCoords: KITCHEN,
    customerLng: far.lng,
    customerLat: far.lat,
    deliveryConfig: zoned,
    radiusMeters: 100000,
  });
  ck('a pin outside every zone is outside, however generous the radius',
    outZone.inside === false && outZone.reason === 'outside_zones');

  const wideZone = {
    zones: [
      {
        name: 'too-wide',
        geometry: [
          [KITCHEN[0] - 1, KITCHEN[1] - 1],
          [KITCHEN[0] + 1, KITCHEN[1] - 1],
          [KITCHEN[0] + 1, KITCHEN[1] + 1],
          [KITCHEN[0] - 1, KITCHEN[1] + 1],
          [KITCHEN[0] - 1, KITCHEN[1] - 1],
        ],
        enabled: true,
      },
    ],
  };
  const wideButFar = policy.isCustomerInDeliveryArea({
    kitchenCoords: KITCHEN,
    customerLng: far.lng,
    customerLat: far.lat,
    deliveryConfig: wideZone,
    radiusMeters: 10000,
  });
  ck('a zone wider than the radius does not extend the radius',
    wideButFar.inside === false && wideButFar.reason === 'beyond_radius');

  const disabledZone = { zones: [{ name: 'off', geometry: ring, enabled: false }] };
  const disabledCheck = policy.isCustomerInDeliveryArea({
    kitchenCoords: KITCHEN,
    customerLng: near.lng,
    customerLat: near.lat,
    deliveryConfig: disabledZone,
    radiusMeters: 10000,
  });
  ck('a disabled zone is skipped, radius decides', disabledCheck.inside === true && disabledCheck.reason === 'inside_radius');

  const asPolygon = { zones: [{ name: 'poly', geometry: [ring], enabled: true }] };
  const polyCheck = policy.isCustomerInDeliveryArea({
    kitchenCoords: KITCHEN,
    customerLng: near.lng,
    customerLat: near.lat,
    deliveryConfig: asPolygon,
    radiusMeters: 10000,
  });
  ck('POLYGON shape classifies the same as a bare RING', polyCheck.inside === true && polyCheck.reason === 'inside_zone');

  const badPin = policy.isCustomerInDeliveryArea({
    kitchenCoords: KITCHEN,
    customerLng: NaN,
    customerLat: NaN,
    deliveryConfig: zoned,
    radiusMeters: 10000,
  });
  ck('an unusable pin is outside, not an exception', badPin.inside === false && badPin.reason === 'invalid_pin');

  console.log('\n=== 3-3 illegal moves throw 409 ===\n');

  ck('created -> preparing is legal', transitions.canFoodOrderTransition('created', 'preparing') === true);
  ck('preparing -> ready is legal', transitions.canFoodOrderTransition('preparing', 'ready') === true);
  ck('handover -> ongoing is legal', transitions.canFoodOrderTransition('handover', 'ongoing') === true);
  ck('ongoing -> delivered is legal', transitions.canFoodOrderTransition('ongoing', 'delivered') === true);
  ck('created -> delivered is refused', (await throws409(() => transitions.assertFoodOrderTransition('created', 'delivered'))) === '409');
  ck('delivered -> preparing is refused', (await throws409(() => transitions.assertFoodOrderTransition('delivered', 'preparing'))) === '409');
  ck('re-preparing to swap a rider is a legal retry', transitions.canFoodOrderTransition('preparing', 'preparing') === true);
  ck('double delivered stays refused (wallet runs once)', (await throws409(() => transitions.assertFoodOrderTransition('delivered', 'delivered'))) === '409');
  ck('ideal -> notfound is legal', transitions.canFoodDriverAssignTransition('ideal', 'notfound') === true);
  ck('notfound -> hardreject is legal', transitions.canFoodDriverAssignTransition('notfound', 'hardreject') === true);
  ck('hardreject is terminal', (await throws409(() => transitions.assertFoodDriverAssignTransition('hardreject', 'ideal'))) === '409');
  ck('ideal -> accepted is legal for an offer', transitions.canFoodOfferTransition('ideal', 'accepted') === true);
  ck('a rejected offer row never revives', (await throws409(() => transitions.assertFoodOfferTransition('rejected', 'ideal'))) === '409');
  ck('an accepted offer cannot skip to delivered', (await throws409(() => transitions.assertFoodOfferTransition('accepted', 'delivered'))) === '409');

  const smOrder = await makeOrder(RESTAURANT, { status: 'created' });
  const moved = await transitions.transitionFoodOrderStatus(smOrder._id, 'preparing');
  ck('transitionFoodOrderStatus moves the order', moved.status === 'preparing');
  const illegalMove = await throws409(() => transitions.transitionFoodOrderStatus(smOrder._id, 'delivered'));
  ck('transitionFoodOrderStatus refuses the jump', illegalMove === '409');
  const stillPreparing = await Orders.findById(smOrder._id).lean();
  ck('a refused move leaves the row untouched', stillPreparing.status === 'preparing');

  console.log('\n=== 3-4 surge is a capped quote, never a charge ===\n');

  const off = surge.computeSurgeMultiplier({ policy: { enabled: false }, pendingOrders: 99, activeRiders: 1 });
  ck('disabled surge quotes 1.0', off.multiplier === 1 && off.reason === 'surge_disabled');

  const nowHour = new Date().getHours();
  const peakPolicy = {
    enabled: true,
    demandThreshold: 3,
    multiplierCap: 2.0,
    peakHours: [{ startHour: nowHour, endHour: (nowHour + 2) % 24, multiplier: 1.5 }],
  };
  const peak = surge.computeSurgeMultiplier({ policy: peakPolicy, pendingOrders: 0, activeRiders: 5 });
  ck('peak hours quote the window multiplier', peak.multiplier === 1.5 && peak.reason === 'peak_hours', JSON.stringify(peak));

  const rush = surge.computeSurgeMultiplier({
    policy: { enabled: true, demandThreshold: 2, multiplierCap: 3, peakHours: [] },
    pendingOrders: 9,
    activeRiders: 2,
  });
  ck('deep backlog quotes above 1.0 with a demand reason',
    rush.multiplier > 1 && rush.reason === 'high_demand', JSON.stringify(rush));

  const capped = surge.computeSurgeMultiplier({
    policy: { enabled: true, demandThreshold: 1, multiplierCap: 1.5, peakHours: [] },
    pendingOrders: 100,
    activeRiders: 1,
  });
  ck('the cap always wins over runaway demand', capped.multiplier === 1.5, JSON.stringify(capped));

  ck('a midnight-wrapping window covers 23:00', surge.isHourInWindow(23, { startHour: 22, endHour: 2 }) === true);
  ck('a midnight-wrapping window excludes the afternoon', surge.isHourInWindow(15, { startHour: 22, endHour: 2 }) === false);

  const quoted = surge.quoteDeliveryCharge(40, 1.5);
  ck('the charge quote multiplies the base fee', quoted.charge === 60 && quoted.multiplier === 1.5);
  const quotedBad = surge.quoteDeliveryCharge(-5, 99);
  ck('a garbage base never produces a charge', quotedBad.charge === 0);

  // Live snapshot: the engine stamps the quote on the order, and the charged
  // total is untouched.
  const surgeRider = await makeDriver(0.4, 0);
  await policy.updateDeliveryConfig(SURGE_RESTAURANT, { surge: peakPolicy });
  const surgeOrder = await makeOrder(SURGE_RESTAURANT);
  const surgeDispatch = await dispatchService.dispatch(surgeOrder._id, SURGE_RESTAURANT);
  ck('dispatch still broadcasts with surge configured', surgeDispatch.status === 'broadcast');
  const surgeAfter = await Orders.findById(surgeOrder._id).lean();
  ck('the order carries the surge snapshot',
    surgeAfter.surgeMultiplier === 1.5 && surgeAfter.surgeReason === 'peak_hours' && surgeAfter.surgeAppliedAt instanceof Date,
    JSON.stringify({ m: surgeAfter.surgeMultiplier, r: surgeAfter.surgeReason }));
  ck('the charged total is untouched by the snapshot',
    // Non-lean read so the paise getter applies: 10000 display units in,
    // 10000 display units out.
    Number((await Orders.findById(surgeOrder._id)).grandTotal) === 10000);
  await policy.updateDeliveryConfig(SURGE_RESTAURANT, {}, ['surge']);
  void surgeRider;

  console.log('\n=== 3-5 every path writes the trail ===\n');

  const manualOrder = await makeOrder(RESTAURANT, { status: 'created' });
  const manualRiderA = await makeDriver(0.6, 0);
  const manualRiderB = await makeDriver(0.8, 0);
  await ordersService.prepareOrder(manualOrder._id, {
    vendorId: RESTAURANT,
    driverId: String(manualRiderA.userId),
    time: 10,
  });
  await ordersService.prepareOrder(manualOrder._id, {
    vendorId: RESTAURANT,
    driverId: String(manualRiderB.userId),
    time: 10,
  });
  const manualEvents = await eventsForOrder(manualOrder._id);
  ck('manual selection writes offered events',
    manualEvents.filter((e) => e.type === 'offered').length === 2, JSON.stringify(manualEvents.map((e) => e.type)));
  ck('superseding a live offer writes an overridden event',
    manualEvents.filter((e) => e.type === 'overridden').length === 1);

  const acceptOrder = await makeOrder(RESTAURANT);
  const acceptDispatch = await dispatchService.dispatch(acceptOrder._id, RESTAURANT);
  ck('accept test starts from a broadcast', acceptDispatch.status === 'broadcast');
  const acceptOffer = await DriverNewOrderStatus.findOne({ orderId: acceptOrder._id, driverOrderStatus: 'ideal' });
  await ordersService.driverAcceptOrder(acceptOffer._id, acceptOrder._id, acceptOffer.driver);
  const acceptEvents = await eventsForOrder(acceptOrder._id);
  ck('an accept writes an accepted event',
    acceptEvents.some((e) => e.type === 'accepted'), JSON.stringify(acceptEvents.map((e) => e.type)));

  const rejectOrder = await makeOrder(RESTAURANT);
  await dispatchService.dispatch(rejectOrder._id, RESTAURANT);
  const rejectOffer = await DriverNewOrderStatus.findOne({ orderId: rejectOrder._id, driverOrderStatus: 'ideal' });
  await ordersService.driverRejectOrder(rejectOffer._id, null);
  const rejectEvents = await eventsForOrder(rejectOrder._id);
  ck('a reject writes a rejected event',
    rejectEvents.some((e) => e.type === 'rejected'), JSON.stringify(rejectEvents.map((e) => e.type)));

  const expiryOrder = await makeOrder(RESTAURANT);
  await dispatchService.dispatch(expiryOrder._id, RESTAURANT);
  await DriverNewOrderStatus.updateMany(
    { orderId: expiryOrder._id },
    { $set: { expiresAt: new Date(Date.now() - 1000) } }
  );
  await dispatchService.expireOffers({ limit: 200 });
  const expiryEvents = await eventsForOrder(expiryOrder._id);
  ck('the sweep writes an expired event',
    expiryEvents.some((e) => e.type === 'expired'), JSON.stringify(expiryEvents.map((e) => e.type)));
  ck('the sweep escalates and writes an escalated event',
    expiryEvents.some((e) => e.type === 'escalated'), JSON.stringify(expiryEvents.map((e) => e.type)));

  const doomed = await makeOrder(RESTAURANT, { status: 'preparing', driverAssign: 'ideal' });
  await Orders.updateOne({ _id: doomed._id }, { $set: { dispatchRound: 99, dispatchAttempts: 99 } });
  const doomedResult = await dispatchService.escalate(doomed._id, RESTAURANT, 'test');
  ck('a spent ladder reports exhausted', doomedResult.status === 'exhausted');
  const doomedEvents = await eventsForOrder(doomed._id);
  ck('exhaustion writes a notfound event',
    doomedEvents.some((e) => e.type === 'notfound'), JSON.stringify(doomedEvents.map((e) => e.type)));
  const doomedAfter = await Orders.findById(doomed._id).lean();
  ck('a spent ladder lands on hardreject', doomedAfter.driverAssign === 'hardreject');

  const badEvent = await dispatchEvents.recordAssignmentEvent({ order: String(doomed._id), type: 'nope' });
  ck('an unknown event type is dropped, not thrown', badEvent === null);
  const noOrderEvent = await dispatchEvents.recordAssignmentEvent({ type: 'offered' });
  ck('an event without an order is dropped, not thrown', noOrderEvent === null);

  console.log('\n=== 3-5 the six operations numbers ===\n');

  ck('percentile of nothing is null', dispatchMetrics.percentile([], 50) === null);
  ck('p50 interpolates', dispatchMetrics.percentile([10, 20, 30, 40], 50) === 25);
  ck('p100 is the max', dispatchMetrics.percentile([10, 20, 30], 100) === 30);

  const metrics = await dispatchMetrics.getDispatchMetrics({ restaurantId: String(RESTAURANT) });
  ck('metrics carry the scope', metrics.scope && metrics.scope.restaurantId === String(RESTAURANT));
  ck('metrics carry time-to-assign percentiles', 'timeToAssignP50Seconds' in metrics && 'timeToAssignP95Seconds' in metrics);
  ck('metrics carry the offer/accept counts',
    Number.isFinite(metrics.offersBroadcast) && Number.isFinite(metrics.offersAccepted));
  ck('metrics carry the batch size', 'avgBatchSize' in metrics);
  ck('metrics carry reassignments', Number.isFinite(metrics.reassignmentCount));
  ck('metrics carry the override rate — the tuning signal', 'overrideRate' in metrics && 'overridden' in metrics);
  ck('metrics carry SLA breaches', Number.isFinite(metrics.slaBreaches));
  ck('the trail observed broadcasts for this restaurant', metrics.dispatchRungs >= 3, JSON.stringify(metrics.dispatchRungs));
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
          ? 'ALL FOOD DISPATCH PHASE3 CHECKS PASSED'
          : failures + ' FOOD DISPATCH PHASE3 CHECK(S) FAILED')
    );
    process.exit(failures === 0 ? 0 : 1);
  });
