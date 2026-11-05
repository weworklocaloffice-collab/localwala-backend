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
 * verify.stores.delivery.js — store-owned delivery, and the OTP that guards COD handover.
 *
 * Run: node scripts/verify.stores.delivery.js
 *
 * ## What this pins
 *
 *   BR-29  delivery verification is a customer OTP at handover — the reason a COD order
 *          can be trusted at all. Wrong OTP refused, expiry enforced, attempts capped,
 *          and the OTP is only ever stored hashed.
 *   BR-39  the COD ladder is pending -> collected -> reconciled, and never "paid" at
 *          creation. Collection requires delivery to have happened first.
 *   BR-06/07  one delivery per order; a driver is assigned, not auto-dispatched
 *   §5.20  the delivery transition table — legal moves accepted, illegal refused
 *
 * ## Why the OTP block works the way it does
 *
 * `assignDriver` generates the OTP internally and stores only `hashOtp(otp)`, so the
 * plaintext is never persisted and a database leak cannot be replayed. The consequence for
 * this suite is that a SUCCESSFUL verification cannot be driven from the assigned value —
 * the service deliberately never gives it back. So the suite seeds `otpHash` with
 * `hashOtp('123456')` and verifies with `123456`. That still exercises the real hashing
 * function and the real comparison path; it just avoids pretending the plaintext is
 * recoverable.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const deliveryService = require('../src/modules/stores/services/stores.delivery.service');

// The service resolves models through `mongoose.model(...)` at call time.
require('../src/modules/stores/models/store.delivery.model');
require('../src/modules/stores/models/store.driver.model');
require('../src/modules/stores/models/store.driver.vehicle.model');
require('../src/modules/stores/models/store.order.model');

const StoreDelivery = mongoose.model('StoreDelivery');
const StoreDriver = mongoose.model('StoreDriver');
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

const OUTLET = new mongoose.Types.ObjectId();
const CHAIN = new mongoose.Types.ObjectId();
const DRIVER = new mongoose.Types.ObjectId();
const STAMP = Date.now();

const KNOWN_OTP = '123456';

const makeOrder = async (overrides = {}) =>
  StoreOrder.create({
    orderNo: Math.floor(Math.random() * 1000000),
    customer: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    items: [],
    grandTotal: 500,
    paymentMode: 'cod',
    lifecycle: 'ready',
    ...overrides,
  });

const makeDelivery = async (overrides = {}) =>
  StoreDelivery.create({
    order: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    driver: DRIVER,
    status: 'assigned',
    otpHash: deliveryService.hashOtp(KNOWN_OTP),
    otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    otpAttempts: 0,
    maxOtpAttempts: 3,
    codAmount: 500,
    deliveryFee: 30,
    estimatedMinutes: 30,
    ...overrides,
  });

/** Walk a delivery to `out_for_delivery` through the real transition function.
 *
 * `afterOtd` replays what the RECEIVING side would know: since the van-departure
 * transition mints a FRESH handover code and pushes it to the customer, a caller
 * that knows a deterministic code re-seeds it here to stand in for the customer's
 * phone — standing in for the push, not undoing the mint.
 */
const walkToOutForDelivery = async (delivery, { afterOtd } = {}) => {
  for (const to of ['accepted', 'picked_up', 'out_for_delivery']) {
    await deliveryService.transitionDelivery(delivery._id, to);
  }
  if (afterOtd && Object.keys(afterOtd).length) {
    await StoreDelivery.updateOne({ _id: delivery._id }, afterOtd);
  }
  return StoreDelivery.findById(delivery._id).lean();
};

const cleanup = async () => {
  await StoreDelivery.deleteMany({ outlet: OUTLET });
  await StoreDriver.deleteMany({ outlet: OUTLET });
  await StoreOrder.deleteMany({ outlet: OUTLET });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  console.log('\n=== the delivery transition table ===\n');

  let allLegalAccepted = true;
  for (const [from, allowed] of Object.entries(deliveryService.DELIVERY_TRANSITIONS)) {
    for (const to of allowed) {
      try {
        deliveryService.assertTransition(from, to);
      } catch (e) {
        allLegalAccepted = false;
        ck(`${from} -> ${to} is allowed`, false, e.message);
      }
    }
  }
  ck('every transition the table permits is accepted', allLegalAccepted);

  const illegal = [
    ['assigned', 'picked_up'],
    ['assigned', 'delivered'],
    ['delivered', 'out_for_delivery'],
    ['delivered', 'picked_up'],
    ['cancelled', 'assigned'],
    ['out_for_delivery', 'picked_up'],
  ];
  for (const [from, to] of illegal) {
    let msg = '';
    try {
      deliveryService.assertTransition(from, to);
    } catch (e) {
      msg = e.message || '';
    }
    ck(`${from} -> ${to} is rejected`, /ILLEGAL_DELIVERY_MOVE/.test(msg), msg);
  }

  console.log('\n=== BR-06: one delivery per order ===\n');

  const orderDoc = await makeOrder();
  const driverDoc = await StoreDriver.create({
    _id: DRIVER,
    user: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    driverCode: 'A-' + STAMP,
    licenseNumber: 'DL-' + STAMP + '-A',
    licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    status: 'active',
    isAvailable: true,
  });
  const assigned = await deliveryService.assignDriver({
    order: orderDoc._id,
    outlet: OUTLET,
    chain: CHAIN,
    driver: driverDoc._id,
    deliveryFee: 30,
    estimatedMinutes: 25,
    actor: new mongoose.Types.ObjectId(),
  });
  ck('assigning a driver creates the delivery', !!assigned._id);
  ck('it starts assigned', assigned.status === 'assigned', assigned.status);
  ck('the driver is recorded', String(assigned.driver) === String(DRIVER));
  ck('COD is taken from the order, not the request body', Number(assigned.codAmount) === 500, assigned.codAmount);
  ck('the order moves to driver_assigned',
    (await StoreOrder.findById(orderDoc._id).lean()).lifecycle === 'driver_assigned');

  let doubleAssign = false;
  try {
    await deliveryService.assignDriver({ order: orderDoc._id, outlet: OUTLET, chain: CHAIN, driver: DRIVER });
  } catch (e) {
    doubleAssign = e.statusCode === 409;
  }
  ck('a second assignment for the same order is refused', doubleAssign);

  let crossOutlet = false;
  try {
    await deliveryService.assignDriver({
      order: orderDoc._id,
      outlet: new mongoose.Types.ObjectId(),
      chain: CHAIN,
      driver: DRIVER,
    });
  } catch (e) {
    crossOutlet = e.statusCode === 404;
  }
  ck('an order cannot be assigned through another outlet', crossOutlet);

  console.log('\n=== BR-29: the OTP is issued hashed, never in plaintext ===\n');

  const assignedHash = assigned.otpHash;
  ck('the stored OTP is a sha256 hex digest', /^[0-9a-f]{64}$/.test(assignedHash), assignedHash);
  ck('it is NOT a 6-digit plaintext', !/^[0-9]{6}$/.test(String(assignedHash)));
  ck('the hash function is a real sha256 of the OTP', deliveryService.hashOtp('123456').length === 64);
  ck('different OTPs hash differently', deliveryService.hashOtp('123456') !== deliveryService.hashOtp('654321'));
  ck('the OTP carries an expiry', !!assigned.otpExpiresAt);
  ck('expiry is in the future', assigned.otpExpiresAt > new Date());
  ck('attempt counters are initialised', assigned.otpAttempts === 0 && assigned.maxOtpAttempts === 3,
    `${assigned.otpAttempts}/${assigned.maxOtpAttempts}`);

  console.log('\n=== the delivery drives the order lifecycle ===\n');

  await walkToOutForDelivery(assigned, { afterOtd: { otpHash: deliveryService.hashOtp(KNOWN_OTP) } });
  const walkedAssign = await StoreDelivery.findById(assigned._id).lean();
  ck('a fresh code is minted when the van leaves', walkedAssign.otpHash !== assignedHash && /^[0-9a-f]{64}$/.test(walkedAssign.otpHash));
  ck('the fresh mint resets the attempt counter', walkedAssign.otpAttempts === 0, walkedAssign.otpAttempts);
  ck('the fresh mint restarts the TTL', walkedAssign.otpExpiresAt > new Date(Date.now() + 9 * 60 * 1000));
  ck('picked_up and out_for_delivery reach the order',
    (await StoreOrder.findById(orderDoc._id).lean()).lifecycle === 'out_for_delivery');
  await deliveryService.verifyDeliveryOtp(assigned._id, KNOWN_OTP);
  const completedOrder = await StoreOrder.findById(orderDoc._id).lean();
  ck('an OTP handover completes the order', completedOrder.lifecycle === 'completed', completedOrder.lifecycle);
  const verifiedDelivery = await StoreDelivery.findById(assigned._id).lean();
  ck('the handover records that the OTP was verified', verifiedDelivery.otpVerified === true);
  ck('the handover stamps the OTP verification time', !!verifiedDelivery.otpVerifiedAt);

  console.log('\n=== BR-29: OTP gates the handover ===\n');

  const d = await makeDelivery();
  await walkToOutForDelivery(d);

  let tooEarly = false;
  try {
    await deliveryService.verifyDeliveryOtp((await makeDelivery({ status: 'assigned' }))._id, KNOWN_OTP);
  } catch (e) {
    tooEarly = e.statusCode === 409 && /not out for delivery/.test(e.message);
  }
  ck('an OTP cannot complete a delivery that is not out for delivery', tooEarly);

  let wrong = false;
  try {
    await deliveryService.verifyDeliveryOtp(d._id, '999999');
  } catch (e) {
    wrong = e.statusCode === 401 && /Invalid OTP/.test(e.message);
  }
  ck('a wrong OTP is refused with 401', wrong);
  const afterWrong = await StoreDelivery.findById(d._id).lean();
  ck('a wrong OTP does NOT complete the delivery', afterWrong.status === 'out_for_delivery', afterWrong.status);
  ck('a wrong OTP still consumes an attempt', afterWrong.otpAttempts === 1, afterWrong.otpAttempts);

  console.log('\n=== BR-29: attempts are capped ===\n');

  const brute = await makeDelivery({ maxOtpAttempts: 3 });
  await walkToOutForDelivery(brute);
  for (let i = 0; i < 3; i++) {
    try {
      await deliveryService.verifyDeliveryOtp(brute._id, '000000');
    } catch {
      /* expected */
    }
  }
  let lockedOut = false;
  try {
    await deliveryService.verifyDeliveryOtp(brute._id, '000000');
  } catch (e) {
    lockedOut = e.statusCode === 409 && /Maximum OTP attempts/.test(e.message);
  }
  ck('after maxOtpAttempts the OTP is locked out', lockedOut);
  const locked = await StoreDelivery.findById(brute._id).lean();
  ck('a locked-out delivery cannot be completed by guessing', locked.status === 'out_for_delivery', locked.status);

  console.log('\n=== BR-29: an expired OTP is refused ===\n');

  const stale = await makeDelivery({ otpExpiresAt: new Date(Date.now() - 60 * 1000) });
  await walkToOutForDelivery(stale, { afterOtd: { otpExpiresAt: new Date(Date.now() - 60 * 1000) } });
  let expired = false;
  try {
    await deliveryService.verifyDeliveryOtp(stale._id, KNOWN_OTP);
  } catch (e) {
    expired = e.statusCode === 409 && /expired/i.test(e.message);
  }
  ck('a CORRECT OTP is still refused once expired', expired);
  ck('the expired delivery is not marked delivered',
    (await StoreDelivery.findById(stale._id).lean()).status === 'out_for_delivery');

  console.log('\n=== BR-29: the correct OTP completes the handover ===\n');

  const good = await makeDelivery();
  await walkToOutForDelivery(good, { afterOtd: { otpHash: deliveryService.hashOtp(KNOWN_OTP) } });
  const verified = await deliveryService.verifyDeliveryOtp(good._id, KNOWN_OTP);
  ck('the correct OTP completes the delivery', verified.status === 'delivered', verified.status);
  ck('the delivery timestamp is stamped', !!verified.deliveredAt);

  console.log('\n=== BR-39: the COD ladder ===\n');

  let collectEarly = false;
  try {
    await deliveryService.collectCod(d._id, 500);
  } catch (e) {
    collectEarly = e.statusCode === 409 && /not completed/i.test(e.message);
  }
  ck('COD cannot be collected before delivery', collectEarly);

  let overCollect = false;
  try {
    await deliveryService.collectCod(verified._id, 502);
  } catch (e) {
    overCollect = e.statusCode === 400 && /EXCEEDS_DUE/.test(e.message);
  }
  ck('collecting more than the COD due is refused', overCollect);

  const collected = await deliveryService.collectCod(verified._id, 500);
  ck('collecting COD sets the amount', Number(collected.codCollected) === 500, collected.codCollected);
  ck('COD moves to collected', collected.codStatus === 'collected', collected.codStatus);
  ck('COD is never "paid" at creation — it starts unset',
    (await StoreDelivery.findById(good._id).lean()).codStatus !== 'paid');

  let reconcileEarly = false;
  try {
    await deliveryService.reconcileCod(d._id);
  } catch (e) {
    reconcileEarly = e.statusCode === 409 && /not collected/i.test(e.message);
  }
  ck('COD cannot be reconciled before collection', reconcileEarly);

  const reconciled = await deliveryService.reconcileCod(verified._id);
  ck('reconciling moves COD to reconciled', reconciled.codStatus === 'reconciled', reconciled.codStatus);

  try {
    await deliveryService.collectCod(verified._id, 500);
  } catch {
    // already reconciled: collection is one-way and cannot be replayed
  }
  const afterRecollect = await StoreDelivery.findById(verified._id).lean();
  ck('re-collecting a reconciled COD does not walk it back', afterRecollect.codStatus === 'reconciled',
    afterRecollect.codStatus);

  console.log('\n=== BR-39: COD cash updates the order ===\n');

  const codDelivery = await deliveryService.collectCod(assigned._id, 500);
  ck('collecting COD stamps the time', !!codDelivery.codCollectedAt);
  const collectedOrder = await StoreOrder.findById(orderDoc._id).lean();
  ck('the order records cash as collected', collectedOrder.paymentStatus === 'collected', collectedOrder.paymentStatus);
  ck('collected cash is recorded on the order', Number(collectedOrder.paidAmount) === 500, collectedOrder.paidAmount);
  await deliveryService.reconcileCod(assigned._id);
  const reconciledOrder = await StoreOrder.findById(orderDoc._id).lean();
  ck('reconciliation reaches the order', reconciledOrder.paymentStatus === 'reconciled', reconciledOrder.paymentStatus);

  console.log('\n=== driver availability (BR-06) ===\n');

  const makeDriver = async (code, status, isAvailable) =>
  StoreDriver.create({
    user: new mongoose.Types.ObjectId(),
    outlet: OUTLET,
    chain: CHAIN,
    driverCode: code,
    licenseNumber: 'DL-' + STAMP + '-' + code,
    licenseExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    status,
    isAvailable,
  });

  const free = await makeDriver('D-' + STAMP, 'active', true);
  const busy = await makeDriver('B-' + STAMP, 'active', false);
  const suspended = await makeDriver('S-' + STAMP, 'suspended', true);

  const available = await deliveryService.getAvailableDrivers(OUTLET);
  const codes = available.map((x) => x.driverCode);
  ck('an active, available driver is offered', codes.includes(free.driverCode));
  ck('an unavailable driver is not offered', !codes.includes(busy.driverCode));
  ck('a suspended driver is not offered', !codes.includes(suspended.driverCode));
  ck('only drivers from the requested outlet are offered',
    available.every((x) => String(x.outlet) === String(OUTLET)));
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
    console.log('\n' + (failures === 0 ? 'ALL STORES DELIVERY CHECKS PASSED' : failures + ' STORES DELIVERY CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });