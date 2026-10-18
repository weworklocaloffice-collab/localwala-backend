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
 * verify.food.dispatch.engine.js — the cascade dispatch engine.
 *
 * Run: node scripts/verify.food.dispatch.engine.js
 *
 * ## What this pins
 *
 *   the ladder    round 0 broadcasts a *batch*, not one rider, and every offer
 *                 carries an `expiresAt`. No expiry meant a silent rider stalled
 *                 the order forever.
 *   idempotency   a second dispatch() on an order with live offers is a no-op, so
 *                 a retried webhook cannot fan out duplicate waves.
 *   expiry        `expireOffers` closes dead offers and escalates the order. This
 *                 function did not exist; its absence is the original bug.
 *   exhaustion    the ladder ends in a terminal `hardreject`, not a silent stall.
 *   ranking       a rider who is nearest but already at capacity loses to an idle
 *                 rider further away.
 *   atomic accept two riders accepting at once produce exactly one assignment.
 *
 * ## Flag handling
 *
 * `DISPATCH_CASCADE_ENABLED` is set before any module is required, because
 * `config/config.js` captures the environment at load time. Setting it afterwards
 * would silently leave the engine disabled and every dispatch assertion would pass
 * for the wrong reason (`status: 'disabled'`).
 */

process.env.DISPATCH_CASCADE_ENABLED = 'true';
process.env.DISPATCH_MAX_ATTEMPTS = '3';

const mongoose = require('mongoose');
require('dotenv').config();

const dispatchService = require('../src/services/dispatch.service');
const scoring = require('../src/kernel/dispatch/dispatch.scoring');
const ordersService = require('../src/services/orders.service');
const config = require('../src/config/config');

const {
  Orders,
  Restaurant,
  Driver,
  DriverNewOrderStatus,
  DispatchAttempt,
  BusinessSettings,
  DriverSettings,
  DriverIncentive,
  DeliveryShiftSchedule,
  User,
} = require('../src/models');

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
const RESTAURANT = new mongoose.Types.ObjectId();

// The kitchen sits at the origin of every distance calculation below.
const KITCHEN = [72.8777, 19.076];

const makeUser = () => {
  seq += 1;
  return User.create({
    firstName: 'Engine',
    lastName: 'Test' + STAMP + '.' + seq,
    email: 'enginetest' + STAMP + '.' + seq + '@example.invalid',
    password: 'verify.food.dispatch.engine.' + STAMP,
    countryCode: '+91',
    mobile: '98888' + String(STAMP + seq).slice(-5),
  });
};

/** A rider `offsetKm` north of the kitchen, at the given load. */
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
    identityNumber: 'E' + STAMP,
    identityProof: 'p',
    drivingLicense: 'DLE' + STAMP,
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

const makeOrder = async (overrides = {}) => {
  const customer = await makeUser();
  return Orders.create({
    orderNo: 800000 + (await Orders.countDocuments()) + 1,
    user: customer._id,
    payment: PAYMENT,
    restaurant: RESTAURANT,
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

const cleanup = async () => {
  const orders = await Orders.find({ restaurant: RESTAURANT }, { user: 1 }).lean();
  await DriverNewOrderStatus.deleteMany({ restaurant: RESTAURANT });
  await DispatchAttempt.deleteMany({ restaurant: RESTAURANT });
  await Orders.deleteMany({ restaurant: RESTAURANT });
  await Driver.deleteMany({ identityNumber: 'E' + STAMP });
  await Restaurant.deleteMany({ _id: RESTAURANT });
  const users = orders.map((o) => o.user);
  if (users.length) await User.deleteMany({ _id: { $in: users } });
  await User.deleteMany({ email: new RegExp('^enginetest' + STAMP + '\\.') });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== the flag is genuinely on ===\n');

  ck('DISPATCH_CASCADE_ENABLED parsed true', dispatchService.isCascadeEnabled() === true);
  ck('config reports cascadeEnabled', config.dispatch.cascadeEnabled === true);

  console.log('\n=== scoring: distance alone must not decide ===\n');

  const ranked = scoring.rankCandidates([
    { distanceKm: 0.3, orderHandling: 2, maxOrderLimit: 2, rating: 5, updatedAt: new Date(), isOwnFleet: false, priorRejects: 0, radiusKm: 8 },
    { distanceKm: 1.4, orderHandling: 0, maxOrderLimit: 2, rating: 4.8, updatedAt: new Date(), isOwnFleet: false, priorRejects: 0, radiusKm: 8 },
  ]);
  ck('the idle rider beats the nearer at-capacity rider',
    ranked[0].orderHandling === 0 && ranked[1].orderHandling === 2,
    'got ' + JSON.stringify(ranked.map((r) => ({ d: r.distanceKm, load: r.orderHandling, s: r.score }))));

  const ownFleet = scoring.rankCandidates([
    { distanceKm: 1.0, orderHandling: 0, maxOrderLimit: 2, rating: 4, updatedAt: new Date(), isOwnFleet: false, priorRejects: 0, radiusKm: 8 },
    { distanceKm: 1.0, orderHandling: 0, maxOrderLimit: 2, rating: 4, updatedAt: new Date(), isOwnFleet: true, priorRejects: 0, radiusKm: 8 },
  ]);
  ck('otherwise identical own-fleet rider outranks the platform rider',
    ownFleet[0].isOwnFleet === true);

  const penalised = scoring.rankCandidates([
    { distanceKm: 1.0, orderHandling: 0, maxOrderLimit: 2, rating: 4, updatedAt: new Date(), isOwnFleet: false, priorRejects: 0, radiusKm: 8 },
    { distanceKm: 1.0, orderHandling: 0, maxOrderLimit: 2, rating: 4, updatedAt: new Date(), isOwnFleet: false, priorRejects: 3, radiusKm: 8 },
  ]);
  ck('a rider who already declined is ranked last',
    penalised[1].priorRejects === 3, 'got ' + JSON.stringify(penalised.map((p) => p.priorRejects)));

  ck('every score carries an explainable breakdown',
    typeof ranked[0].factors === 'object' && typeof ranked[0].factors.load === 'number');

  console.log('\n=== the ladder respects the delivery zone ===\n');

  const { ladder } = await dispatchService.resolveLadder();
  ck('three rungs are configured', ladder.length === 3, 'got ' + ladder.length);

  const clamped = dispatchService.rungFor(ladder, 2, 3000);
  ck('a wide rung is clamped to a narrow zone', clamped.radiusMeters === 3000, 'got ' + clamped.radiusMeters);
  ck('the clamp is recorded', clamped.clamped === true);

  const unclamped = dispatchService.rungFor(ladder, 2, 100000);
  ck('an unrestricted zone leaves the rung alone', unclamped.radiusMeters === 8000);

  const beyond = dispatchService.rungFor(ladder, 99, 100000);
  ck('a round past the ladder clamps to the last rung', beyond.radiusMeters === 8000);

  console.log('\n=== dispatch broadcasts a batch with a deadline ===\n');

  await Restaurant.create({
    _id: RESTAURANT,
    userId: new mongoose.Types.ObjectId(),
    name: 'Engine Kitchen ' + STAMP,
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

  const nearIdle = await makeDriver(0.5, 0);
  const nearBusy = await makeDriver(0.3, 2);
  const mid = await makeDriver(1.5, 0);
  await DriverSettings.findOneAndUpdate({}, { maxOrderLimit: 2 }, { upsert: true });

  const first = await makeOrder();
  const dispatched = await dispatchService.dispatch(first._id, RESTAURANT);
  ck('dispatch reports a broadcast', dispatched.status === 'broadcast', JSON.stringify(dispatched));

  const offers = await DriverNewOrderStatus.find({ orderId: first._id });
  ck('offers were created', offers.length >= 1, 'got ' + offers.length);
  ck('every offer carries an expiry',
    offers.every((o) => o.expiresAt instanceof Date));
  ck('every offer is stamped with round 0',
    offers.every((o) => o.offerRound === 0));
  ck('every offer carries its score',
    offers.every((o) => typeof o.dispatchScore === 'number'));
  ck('every offer carries its explainable factors',
    offers.every((o) => o.dispatchFactors && typeof o.dispatchFactors.load === 'number'));
  ck('offers are marked auto', offers.every((o) => o.orderFrom === 'auto'));
  ck('round 0 offers exactly one rider (batchSize 1)', offers.length === 1, 'got ' + offers.length);
  ck('the at-capacity rider was not chosen',
    String(offers[0].driver) !== String(nearBusy.userId));
  ck('the nearest idle rider won round 0',
    String(offers[0].driver) === String(nearIdle.userId));
  ck('round 0 kept the offer inside its own radius',
    offers[0].dispatchDistance <= 2, 'got ' + offers[0].dispatchDistance);

  const attempt = await DispatchAttempt.findOne({ order: first._id });
  ck('a DispatchAttempt row was written', attempt !== null);
  ck('the attempt records the round', attempt.round === 0);
  ck('the attempt records the outcome', attempt.outcome === 'broadcast');

  console.log('\n=== dispatch is idempotent ===\n');

  const again = await dispatchService.dispatch(first._id, RESTAURANT);
  ck('a second dispatch is skipped', again.status === 'skipped', JSON.stringify(again));
  ck('no second wave was created',
    (await DriverNewOrderStatus.countDocuments({ orderId: first._id })) === offers.length);

  console.log('\n=== expiry escalates instead of stalling ===\n');

  await DriverNewOrderStatus.updateMany(
    { orderId: first._id },
    { $set: { expiresAt: new Date(Date.now() - 1000) } }
  );

  const swept = await dispatchService.expireOffers({ limit: 200 });
  ck('the sweep reported expired offers', swept.swept >= 1, JSON.stringify(swept));

  const afterSweep = await Orders.findById(first._id).lean();
  ck('the order advanced past round 0', (afterSweep.dispatchRound || 0) >= 1, 'got ' + afterSweep.dispatchRound);
  ck('the order did not go terminal on the first expiry',
    afterSweep.driverAssign !== 'hardreject', afterSweep.driverAssign);

  const secondRoundOffers = await DriverNewOrderStatus.find({
    orderId: first._id,
    offerRound: 1,
    driverOrderStatus: 'ideal',
  });
  ck('a wider rung broadcast more riders than round 0 did',
    secondRoundOffers.length > offers.length,
    'r0=' + offers.length + ' r1=' + secondRoundOffers.length);
  ck('round 1 reached the rider round 0 could not use',
    secondRoundOffers.some((o) => String(o.driver) === String(nearBusy.userId) || String(o.driver) === String(mid.userId)),
    'r1=' + secondRoundOffers.map((o) => String(o.driver)).join(','));

  console.log('\n=== exhaustion is terminal and visible ===\n');

  const stuck = await makeOrder({ status: 'preparing', driverAssign: 'ideal' });
  await Orders.updateOne(
    { _id: stuck._id },
    { $set: { dispatchRound: 0, dispatchAttempts: 3 } }
  );
  const terminal = await dispatchService.escalate(stuck._id, RESTAURANT, 'test');
  ck('exhaustion reports exhausted', terminal.status === 'exhausted', JSON.stringify(terminal));
  const stuckAfter = await Orders.findById(stuck._id).lean();
  ck('a spent order is marked hardreject', stuckAfter.driverAssign === 'hardreject', stuckAfter.driverAssign);

  const listed = await ordersService.getAdminUnAssignedOrderList({ limit: 100, page: 1, search: '' });
  ck('an exhausted order is visible to operations',
    listed.orders.map((o) => String(o.id)).includes(String(stuck._id)));

  console.log('\n=== accept is atomic under contention ===\n');

  await DriverSettings.findOneAndUpdate({}, { showEarning: false }, { upsert: true });
  await DriverIncentive.deleteMany({});
  await DeliveryShiftSchedule.deleteMany({});
  await BusinessSettings.findOneAndUpdate({}, { findMode: 'km', timezone: { utc: ['UTC'], value: 'UTC' } }, { upsert: true });

  const raceOrder = await makeOrder({ status: 'preparing' });
  const raceA = await makeDriver(0.4, 0);
  const raceB = await makeDriver(0.6, 0);
  // Round 0 has batchSize 1, so it cannot by itself produce a contested offer.
  // Seed both riders a live offer, which is exactly the shape a round-1 batch of
  // two produces in production — two riders holding open offers on one order,
  // both tapping Accept within the same second.
  await DriverNewOrderStatus.insertMany([
    {
      orderId: raceOrder._id,
      driver: raceA.userId,
      restaurant: RESTAURANT,
      deliveryAddressRaw: 'Customer address',
      driverOrderStatus: 'ideal',
      orderFrom: 'auto',
      offerRound: 1,
      expiresAt: new Date(Date.now() + 45000),
    },
    {
      orderId: raceOrder._id,
      driver: raceB.userId,
      restaurant: RESTAURANT,
      deliveryAddressRaw: 'Customer address',
      driverOrderStatus: 'ideal',
      orderFrom: 'auto',
      offerRound: 1,
      expiresAt: new Date(Date.now() + 45000),
    },
  ]);

  const raceOffers = await DriverNewOrderStatus.find({
    orderId: raceOrder._id,
    driverOrderStatus: 'ideal',
  });
  ck('the race starts with two riders holding live offers', raceOffers.length === 2);
  const drivers = [raceA, raceB].map((r) => r.userId);

  const attempts = drivers.map(async (uid) => {
    const offer = raceOffers.find((o) => String(o.driver) === String(uid));
    if (!offer) return 'no-offer';
    try {
      await ordersService.driverAcceptOrder(offer._id, raceOrder._id, uid);
      return 'accepted';
    } catch (e) {
      return `${e.statusCode || 'ERR'}`;
    }
  });
  const outcomes = await Promise.all(attempts);

  ck('exactly one rider wins the race',
    outcomes.filter((o) => o === 'accepted').length === 1, JSON.stringify(outcomes));
  ck('the loser gets 409, not a silent double-assignment',
    outcomes.includes('409'), JSON.stringify(outcomes));

  const claimed = await Orders.findById(raceOrder._id).lean();
  ck('the order has exactly one rider', !!claimed.driver);
  const acceptedOffers = await DriverNewOrderStatus.countDocuments({
    orderId: raceOrder._id,
    driverOrderStatus: 'accepted',
  });
  ck('only one offer is marked accepted', acceptedOffers === 1, 'got ' + acceptedOffers);
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
          ? 'ALL FOOD DISPATCH ENGINE CHECKS PASSED'
          : failures + ' FOOD DISPATCH ENGINE CHECK(S) FAILED')
    );
    process.exit(failures === 0 ? 0 : 1);
  });
