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
 * Seeds the dairy vertical so the app has something to render.
 *
 * Idempotent — safe to re-run. Creates:
 *   1. Vertical 'dairy'
 *   2. An owner-operator who is BOTH dairyPartner and dairyDriver
 *      (Business + DairyDriver profile), which is the case the merged
 *      DairyPartner_app exists for
 *   3. A commission-partner outlet, which runs its own riders like every
 *      other dairy outlet
 *   4. A second rider, attached to that outlet
 *
 * There is no platform-pool rider. Dairy has no pool: a rider is always employed by
 * one outlet, and `DairyDriver.business` is required.
 *
 * Usage:
 *   node scripts/seed.dairy.js
 *   node scripts/seed.dairy.js --wipe   removes all dairy seed data first
 */

const mongoose = require('mongoose');
const { User, Business, DairyDriver, Vertical, City, Locality } = require('../src/models');

const PASSWORD = 'Dairy@12345';

const log = (...args) => console.log('[seed.dairy]', ...args);

const connect = async () => {
  require('dotenv').config();
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) throw new Error('MONGODB_URL not set');
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });
  log('connected');
};

const wipe = async () => {
  const mobiles = ['9000000001', '9000000002', '9000000003'];
  const users = await User.find({ mobile: { $in: mobiles } }).select('_id');
  const userIds = users.map((u) => u._id);

  await Promise.all([
    User.deleteMany({ _id: { $in: userIds } }),
    Business.deleteMany({ owner: { $in: userIds } }),
    DairyDriver.deleteMany({ userId: { $in: userIds } }),
  ]);
  log('wiped existing dairy seed data');
};

const seedVertical = async () => {
  const vertical = await Vertical.findOneAndUpdate(
    { key: 'dairy' },
    {
      $set: {
        name: 'Dairy',
        description: 'Milk, curd, ghee, paneer and daily dairy subscriptions',
        usesSharedDelivery: true,
        status: true,
        sortOrder: 1,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  log('vertical:', vertical.key, vertical._id.toString());
  return vertical;
};

const ensureCity = async () => {
  // City requires `image` and `location.coordinates`; Locality requires
  // `location.coordinates` and `city`.
  let city = await City.findOne({ name: 'Bengaluru' });
  if (!city) {
    city = await City.create({
      name: 'Bengaluru',
      image: 'assets/images/languages/india-active.png',
      location: { type: 'Point', coordinates: [77.5946, 12.9716] },
      status: true,
    });
    log('created city:', city._id.toString());
  }
  let locality = await Locality.findOne({ name: 'Indiranagar', city: city._id });
  if (!locality) {
    locality = await Locality.create({
      name: 'Indiranagar',
      city: city._id,
      location: { type: 'Point', coordinates: [77.6408, 12.9784] },
      status: true,
    });
    log('created locality:', locality._id.toString());
  }
  return { city, locality };
};

const upsertUser = async ({ firstName, lastName, mobile, role }) => {
  let user = await User.findOne({ countryCode: '+91', mobile });
  if (!user) {
    user = await User.create({
      firstName,
      lastName,
      countryCode: '+91',
      mobile,
      email: `${mobile}@dairy.local`,
      // `User` requires `password` and `email`; dairy login is mobile+OTP so the
      // password is never used, but the field is mandatory on the model.
      password: PASSWORD,
      role,
      status: true,
      isMobileVerified: true,
      isEmailVerified: false,
      locale: 'en',
    });
    log(`created user ${firstName} (${role})`);
  } else {
    log(`user ${firstName} already exists`);
  }
  return user;
};

/**
 * Owner-operator: owns an outlet AND rides for it. This is the dual-role case
 * that made `DairyPartner_app` a single binary — the role gate should offer
 * both shells for this account.
 */
const seedOwnerOperator = async ({ city, locality }) => {
  const user = await upsertUser({
    firstName: 'Asha',
    lastName: 'Rao',
    mobile: '9000000001',
    role: 'dairyPartner',
  });

  let business = await Business.findOne({ owner: user._id });
  if (!business) {
    business = await Business.create({
      vertical: 'dairy',
      businessModel: 'direct',
      name: 'Asha Dairy Farm',
      shortDescription: 'Cow milk delivered daily across Indiranagar',
      description: 'Direct dairy unit. Owns delivery fleet, 40+ active milk subscriptions.',
      city: city._id,
      locality: locality._id,
      location: { type: 'Point', coordinates: [77.6408, 12.9784] },
      owner: user._id,
      contact: { name: 'Asha Rao', mobile: 9000000001, countryCode: '+91' },
      // TRUE so this outlet draws from its own fleet — exercises the
      // own_fleet branch of the assignment logic.
      ownDeliveryPartner: true,
      driverPayoutMode: 'business_pays',
      verified: true,
      status: true,
    });
    log('created business (own fleet):', business.name, business._id.toString());
  }

  let driver = await DairyDriver.findOne({ userId: user._id });
  if (!driver) {
    driver = await DairyDriver.create({
      userId: user._id,
      business: business._id,
      city: city._id,
      locality: locality._id,
      payoutMode: 'per_litre',
      payoutRate: 1200,
      canCapacity: 24,
      vehicleType: 'cycle',
      identity: 'aadhaar',
      identityNumber: 'XXXX-XXXX-1234',
      licence: 'KA-DL-2024-99887',
      licenceExpiry: new Date('2030-06-30'),
      age: 34,
      activeStatus: true,
      status: true,
    });
    log('created own-fleet driver profile:', driver._id.toString());
  }

  await Business.updateOne({ _id: business._id }, { $addToSet: { deliveryPartners: user._id } });

  return { user, business, driver };
};

/**
 * A second rider, attached to a second outlet.
 *
 * This used to seed a platform-pool rider (`DairyDriver.business === null`). There is
 * no pool in dairy any more: `DairyDriver.business` is required, registration refuses
 * a rider with no invitation, and the platform employs nobody. Seeding one would
 * create a record the application can no longer produce.
 */
const seedPoolRider = async ({ city, locality, business, invitedBy }) => {
  const user = await upsertUser({
    firstName: 'Ravi',
    lastName: 'Kumar',
    mobile: '9000000002',
    role: 'dairyDriver',
  });

  let driver = await DairyDriver.findOne({ userId: user._id });
  if (!driver) {
    driver = await DairyDriver.create({
      userId: user._id,
      // Required: every dairy rider belongs to an outlet.
      business: business._id,
      city: business.city || city._id,
      locality: business.locality || locality._id,
      payoutMode: 'per_can',
      payoutRate: 500,
      canCapacity: 30,
      vehicleType: 'cycle',
      identity: 'aadhaar',
      identityNumber: 'XXXX-XXXX-5678',
      age: 27,
      activeStatus: true,
      status: true,
    });
    await Business.updateOne({ _id: business._id }, { $addToSet: { deliveryPartners: user._id } });
    log('created second rider on the commission outlet:', driver._id.toString());
  } else if (!driver.business || driver.status === false || driver.activeStatus === false) {
    // Repair a driver left behind by an older seed run, or disabled by
    // `migrate.retire.pool.js` because it used to be a pool rider.
    //
    // Re-enabling matters: the migration parked that rider, and `assignAgent` filters
    // on `activeStatus` and `status`, so an outlet with a permanently inactive rider
    // can never be assigned anyone — which looks exactly like "this outlet has no
    // fleet" in every test that depends on it.
    const was = {
      business: driver.business ? 'set' : 'null',
      status: driver.status,
      activeStatus: driver.activeStatus,
    };
    driver.business = business._id;
    driver.city = business.city || driver.city || city._id;
    driver.locality = business.locality || driver.locality || locality._id;
    driver.status = true;
    driver.activeStatus = true;
    await driver.save();
    await Business.updateOne({ _id: business._id }, { $addToSet: { deliveryPartners: user._id } });
    log('repaired second rider:', driver._id.toString(), `(was ${JSON.stringify(was)})`);
  }

  return { user, driver, invitedBy };
};

/**
 * Second outlet. Runs its own riders, like every other dairy outlet.
 *
 * It used to be seeded with `ownDeliveryPartner: false` and `platform_pays`, so it
 * would draw from the platform pool. Both are gone: an outlet with no fleet has no
 * way to get anyone to deliver its orders, and there is no platform rider to fall
 * back on.
 */
const seedPartnerOutlet = async ({ city, locality }) => {
  const user = await upsertUser({
    firstName: 'Meera',
    lastName: 'Nair',
    mobile: '9000000003',
    role: 'dairyPartner',
  });

  let business = await Business.findOne({ owner: user._id });
  if (!business) {
    business = await Business.create({
      vertical: 'dairy',
      businessModel: 'commission_partner',
      name: 'Meera Dairy Corner',
      description: 'Commission partner store. Runs its own delivery riders.',
      city: city._id,
      locality: locality._id,
      location: { type: 'Point', coordinates: [77.6389, 12.9698] },
      owner: user._id,
      contact: { name: 'Meera Nair', mobile: 9000000003, countryCode: '+91' },
      ownDeliveryPartner: true,
      driverPayoutMode: 'business_pays',
      commissionPercentage: 1200,
      verified: false,
      status: true,
    });
    log('created commission partner outlet:', business.name, business._id.toString());
  } else {
    // Repair rows from an earlier seed run.
    const fix = {};
    if (business.ownDeliveryPartner !== true) {
      fix.ownDeliveryPartner = true;
    }
    if (business.driverPayoutMode === 'platform_pays') {
      fix.driverPayoutMode = 'business_pays';
    }
    if (Object.keys(fix).length) {
      await Business.updateOne({ _id: business._id }, { $set: fix });
      log('repaired commission outlet flags:', Object.keys(fix).join(', '));
    }
  }

  return { user, business };
};

const run = async () => {
  await connect();

  if (process.argv.includes('--wipe')) {
    await wipe();
  }

  const vertical = await seedVertical();
  const { city, locality } = await ensureCity();
  const owner = await seedOwnerOperator({ city, locality });
  // The commission outlet is seeded first, because the second rider belongs to it.
  const partner = await seedPartnerOutlet({ city, locality });
  const rider = await seedPoolRider({ city, locality, business: partner.business });

  log('---');
  log('vertical            :', vertical.key);
  log('');
  log('OWNER-OPERATOR (both roles)  mobile 9000000001');
  log('  business          :', owner.business.name, '| ownDeliveryPartner =', owner.business.ownDeliveryPartner);
  log('  driver profile    :', owner.driver._id.toString(), '| payoutMode =', owner.driver.payoutMode);
  log('');
  log('SECOND RIDER (commission outlet)   mobile 9000000002');
  log('  driver profile    :', rider.driver._id.toString(), '| business =', rider.driver.business);
  log('');
  log('COMMISSION PARTNER            mobile 9000000003');
  log('  business          :', partner.business.name, '| verified =', partner.business.verified);
  log('');
  log('Sign in at POST /v1/auth/dairy/login_po/ with any of the above mobiles.');
  log('The request SMS OTP through the app first: POST /v1/auth/dairy/login_po_verification');

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (e) => {
  console.error('[seed.dairy] failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
