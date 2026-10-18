/*
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
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
 * Location integrity on registration.
 *
 * ## Why this is a separate suite
 *
 * Location was optional everywhere in the dairy vertical: an outlet registered
 * with `city: null, locality: null`, and the app's registration form had no
 * control that could ever set them. The fields existed in the state and in the
 * payload builder, wired to nothing.
 *
 * That is not a cosmetic gap. Delivery zones key off locality, so an outlet with
 * none is invisible to dispatch — it can be created, verified, and still never
 * receive a delivery. The seed data had three such outlets, all `verified: true`.
 *
 * ## What is enforced, and where
 *
 *   1. An outlet must state a city and a locality.
 *   2. The locality must belong to that city, checked server-side. Presence alone
 *      is not enough — a client can send two valid ids from different cities.
 *   3. Both must be active, so an outlet cannot be created into a city an admin
 *      has switched off.
 *   4. A rider who was invited to an outlet inherits that outlet's location and
 *      is refused if they send their own.
 *   5. There is no platform pool. A rider with no invitation is refused, and a
 *      location does not stand in for one. An invited rider still inherits the outlet's.
 *
 * Rules 4 and 5 are service-level rather than validation-level because Joi
 * cannot express "required unless an invite exists" — the service is the only
 * place that knows whether there is an invite.
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  City,
  Locality,
  DairyDriver,
  DairyDriverInvite,
} = require('../src/models');
const registrationService = require('../src/modules/dairy/services/dairy.registration.service');

let failures = 0;

const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const rejects = async (label, fn, expectedFragment) => {
  try {
    await fn();
    check(label, false, 'resolved when it should have been refused');
  } catch (error) {
    check(
      label,
      String(error.message || '').toLowerCase().includes(expectedFragment.toLowerCase()),
      `refused with: ${error.message}`
    );
  }
};

const run = async () => {
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const stamp = Date.now().toString().slice(-7);
  const created = { users: [], businesses: [], drivers: [], invites: [], cities: [], localities: [] };

  // A second city, so a locality belonging elsewhere exists to be mismatched with.
  const otherCity = await City.create({
    name: `Loc Other ${stamp}`,
    image: 'loc.png',
    location: { type: 'Point', coordinates: [77.6, 12.97] },
    status: true,
  });
  created.cities.push(otherCity._id);

  // An inactive locality: presence is not enough if it has been switched off.
  const inactiveLocality = await Locality.create({
    name: `Loc Inactive ${stamp}`,
    city: otherCity._id,
    location: { type: 'Point', coordinates: [77.61, 12.98] },
    status: false,
  });
  created.localities.push(inactiveLocality._id);

  const city = await City.findOne({ status: true });
  if (!city) {
    console.log('  FAIL  no active city to register against — run seed.dairy.js first');
    failures += 1;
    console.log(failures === 0 ? '\nALL LOCATION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }

  const locality = await Locality.findOne({ city: city._id, status: true });
  if (!locality) {
    console.log(`  FAIL  city ${city.name} has no active locality — cannot test the happy path`);
    failures += 1;
    console.log(failures === 0 ? '\nALL LOCATION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }

  const outletPayload = (overrides = {}) => ({
    firstName: 'Loc',
    lastName: 'Tester',
    countryCode: '+91',
    mobile: Number(`6${stamp}1`),
    email: `loc${stamp}a@test.local`,
    password: 'Location@123',
    role: 'dairyPartner',
    businessName: `Loc Outlet ${stamp}`,
    businessModel: 'direct',
    // No `ownDeliveryPartner`: the API rejects it now, and the service sets the flag
    // itself. Every dairy outlet runs its own riders.
    city: city._id.toString(),
    locality: locality._id.toString(),
    // Real coordinates, so the rider-inheritance check below has something to
    // inherit. Without these the outlet stores no point, the rider correctly stores
    // none, and the assertion would be testing nothing.
    coordinates: [77.5946, 12.9716],
    ...overrides,
  });

  console.log('\n1. An outlet must state where it is');

  await rejects(
    'an outlet with no city is refused',
    () => registrationService.registerPartner(outletPayload({ city: null })),
    'city'
  );

  await rejects(
    'an outlet with no locality is refused',
    () => registrationService.registerPartner(outletPayload({ locality: null })),
    'locality'
  );

  console.log('\n2. The pair must agree, and both must be live');

  await rejects(
    'a locality from another city is refused',
    () =>
      registrationService.registerPartner(
        outletPayload({ city: otherCity._id.toString(), locality: locality._id.toString() })
      ),
    'does not belong'
  );

  await rejects(
    'an inactive locality is refused',
    () =>
      registrationService.registerPartner(
        outletPayload({
          city: otherCity._id.toString(),
          locality: inactiveLocality._id.toString(),
        })
      ),
    'not one we serve'
  );

  await rejects(
    'a city that does not exist is refused',
    () =>
      registrationService.registerPartner(
        outletPayload({ city: '0'.repeat(24) })
      ),
    'not one we serve'
  );

  console.log('\n3. A valid pair registers, and the outlet keeps the location');

  let registeredBusiness = null;
  try {
    const created1 = await registrationService.registerPartner(outletPayload());
    registeredBusiness = created1.business;
    created.users.push(created1.user._id);
    created.businesses.push(created1.business._id);

    check('a city and locality from the same city registers', true);
    check(
      'the outlet stores the city it chose',
      String(created1.business.city) === city._id.toString(),
      `city=${created1.business.city}`
    );
    check(
      'the outlet stores the locality it chose',
      String(created1.business.locality) === locality._id.toString(),
      `locality=${created1.business.locality}`
    );
    check(
      'a fresh outlet is not yet verified',
      created1.business.verified !== true,
      `verified=${created1.business.verified}`
    );
  } catch (error) {
    check('a city and locality from the same city registers', false, error.message);
  }

  console.log('\n4. A rider joining that outlet inherits its location');

  const riderMobile = Number(`6${stamp}2`);

  const invite = await DairyDriverInvite.create({
    business: registeredBusiness._id,
    invitedBy: created.users[0],
    countryCode: '+91',
    mobile: riderMobile,
    status: 'pending',
    expiresAt: new Date(Date.now() + 86400000),
  });
  created.invites.push(invite._id);

  const riderPayload = (overrides = {}) => ({
    firstName: 'Loc',
    lastName: 'Rider',
    countryCode: '+91',
    mobile: riderMobile,
    email: `loc${stamp}r@test.local`,
    password: 'Rider@12345',
    role: 'dairyDriver',
    ...overrides,
  });

  await rejects(
    'an invited rider cannot set their own city',
    () => registrationService.registerDriver(riderPayload({ city: otherCity._id.toString() })),
    "takes that outlet's location"
  );

  try {
    const rider = await registrationService.registerDriver(riderPayload());
    created.users.push(rider.user._id);
    created.drivers.push(rider.driver._id);

    check(
      'the invited rider joins the outlet',
      String(rider.driver.business) === registeredBusiness._id.toString(),
      `business=${rider.driver.business}`
    );
    check(
      "the rider inherits the outlet's city",
      String(rider.driver.city) === city._id.toString(),
      `city=${rider.driver.city}`
    );
    check(
      "the rider inherits the outlet's locality",
      String(rider.driver.locality) === locality._id.toString(),
      `locality=${rider.driver.locality}`
    );
    // The outlet's coordinates, not just its city and locality.
    //
    // `registerDriver` has always written `location`, but `DairyDriver` had no such
    // path on the schema, so Mongoose strict mode discarded it on every save. The
    // city and locality checks above still passed, which is why this went unnoticed.
    check(
      "the rider inherits the outlet's coordinates",
      Boolean(rider.driver.location)
        && Array.isArray(rider.driver.location.coordinates)
        && rider.driver.location.coordinates.length === 2,
      `location=${JSON.stringify(rider.driver.location)}`
    );
  } catch (error) {
    check("an invited rider joins the outlet and inherits its location", false, error.message);
  }

  console.log('\n5. Riders are invite-only: there is no platform pool');

  const strayPayload = (overrides = {}) => ({
    firstName: 'Stray',
    lastName: 'Rider',
    countryCode: '+91',
    mobile: Number(`6${stamp}3`),
    email: `loc${stamp}s@test.local`,
    password: 'Rider@12345',
    role: 'dairyDriver',
    ...overrides,
  });

  // The pool is gone. A rider with no invitation is refused, and — importantly —
  // refused for *that* reason, not for a missing location field. Before the pool was
  // retired these same requests failed asking for a city and locality, which is the
  // bug the pool's removal actually fixes: the form had no such field.
  await rejects(
    'a rider with no invitation is refused',
    () => registrationService.registerDriver(strayPayload()),
    'join an outlet by invitation'
  );

  await rejects(
    'a location does not buy you an invitation',
    () =>
      registrationService.registerDriver(
        strayPayload({ city: city._id.toString(), locality: locality._id.toString() })
      ),
    'join an outlet by invitation'
  );

  // An invitation from an outlet that does not run its own riders is not enough.
  // Every dairy outlet does now, so this guards a bad row rather than a normal path.
  const noFleetBusiness = await Business.create({
    vertical: 'dairy',
    businessModel: 'direct',
    name: `No Fleet ${stamp}`,
    owner: created.users[0],
    ownDeliveryPartner: false,
    verified: true,
    status: true,
  });
  created.businesses.push(noFleetBusiness._id);

  const noFleetMobile = Number(`6${stamp}4`);
  const noFleetInvite = await DairyDriverInvite.create({
    business: noFleetBusiness._id,
    invitedBy: created.users[0],
    countryCode: '+91',
    mobile: noFleetMobile,
    status: 'pending',
    expiresAt: new Date(Date.now() + 86400000),
  });
  created.invites.push(noFleetInvite._id);

  await rejects(
    'an invitation from an outlet with no fleet is refused',
    () =>
      registrationService.registerDriver(
        strayPayload({ mobile: noFleetMobile, email: `loc${stamp}n@test.local` })
      ),
    'does not run its own delivery riders'
  );

  // And the positive case, to prove the gate is not simply refusing everything: an
  // invited rider from a proper outlet registers and inherits the location.
  const goodMobile = Number(`6${stamp}5`);
  const goodInvite = await DairyDriverInvite.create({
    business: registeredBusiness._id,
    invitedBy: created.users[0],
    countryCode: '+91',
    mobile: goodMobile,
    status: 'pending',
    expiresAt: new Date(Date.now() + 86400000),
  });
  created.invites.push(goodInvite._id);

  try {
    const rider = await registrationService.registerDriver(
      strayPayload({ mobile: goodMobile, email: `loc${stamp}g@test.local` })
    );
    created.users.push(rider.user._id);
    created.drivers.push(rider.driver._id);

    check(
      'an invited rider from a proper outlet still registers',
      Boolean(rider.driver && rider.driver._id)
    );
    check(
      'and is attached to the inviting outlet',
      String(rider.driver.business) === registeredBusiness._id.toString(),
      `business=${rider.driver.business}`
    );
  } catch (error) {
    check('an invited rider from a proper outlet still registers', false, error.message);
  }

  // Scoped cleanup. No deleteMany({}) — the other suites share this database.
  try {
    await User.deleteMany({ _id: { $in: created.users } });
    await Business.deleteMany({ _id: { $in: created.businesses } });
    await DairyDriver.deleteMany({ _id: { $in: created.drivers } });
    await DairyDriverInvite.deleteMany({ _id: { $in: created.invites } });
    await Locality.deleteMany({ _id: { $in: created.localities } });
    await City.deleteMany({ _id: { $in: created.cities } });
  } catch (error) {
    console.log(`  cleanup warning: ${error.message}`);
  }

  console.log(
    failures === 0
      ? '\nALL LOCATION CHECKS PASSED'
      : `\n${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('verification failed:', error.message);
  process.exit(1);
});
