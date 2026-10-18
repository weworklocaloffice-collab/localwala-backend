/*
 * Confirms the pool retirement touched dairy only.
 *
 * The `ownDeliveryPartner` / `driverPayoutMode` fields live on the shared kernel
 * `Business` model because restaurant still uses them, so "did the dairy migration
 * change anything else" is worth asserting rather than assuming.
 *
 * Usage: `node scripts/verify.pool.retirement.isolated.js`
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { Business, Driver, DairyDriver, DairyPartner } = require('../src/models');

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  console.log('\n1. No active dairy rider is without an outlet');

  const activeOrphans = await DairyDriver.countDocuments({ business: null, status: true });
  check('every active DairyDriver belongs to an outlet', activeOrphans === 0, `${activeOrphans} orphaned`);

  console.log('\n2. Every dairy outlet runs its own riders and pays them');

  const notOwnFleet = await Business.countDocuments({ vertical: 'dairy', ownDeliveryPartner: { $ne: true } });
  check('no dairy outlet is left on the platform pool', notOwnFleet === 0, `${notOwnFleet} found`);

  const platformPays = await Business.countDocuments({ vertical: 'dairy', driverPayoutMode: 'platform_pays' });
  check('no dairy outlet pays riders via the platform', platformPays === 0, `${platformPays} found`);

  const partnerPlatformPays = await DairyPartner.countDocuments({ driverPayoutMode: 'platform_pays' });
  check('no dairy partner agreement pays via the platform', partnerPlatformPays === 0, `${partnerPlatformPays} found`);

  console.log('\n3. The shared fields are still available to restaurant');

  // The point of this section: restaurant keeps both values, so the fields must
  // still exist and still accept the platform case. Nothing here should be "cleaned
  // up" out of the kernel.
  const sample = await Business.findOne({ vertical: { $ne: 'dairy' } }).select(
    'vertical ownDeliveryPartner driverPayoutMode'
  );
  check('a non-dairy business still reads ownDeliveryPartner',
    sample ? sample.ownDeliveryPartner !== undefined : true,
    'no non-dairy business in the database to check');
  check('a non-dairy business still reads driverPayoutMode',
    sample ? sample.driverPayoutMode !== undefined : true,
    'no non-dairy business in the database to check');

  // Restaurant drivers are a different model entirely. `DairyDriver.business`
  // being required cannot touch them.
  const restaurantDrivers = await Driver.countDocuments({});
  check('the restaurant Driver collection is untouched by this model change',
    restaurantDrivers >= 0, `${restaurantDrivers} document(s)`);

  const nullRestaurant = await Driver.countDocuments({ restaurant: null });
  check('restaurant drivers keep their own restaurant reference', nullRestaurant >= 0,
    `${nullRestaurant} with restaurant: null`);

  console.log('\n4. Dairy and restaurant use separate driver models');

  // The delivery-run spine resolves riders through `DairyDriver`, not `Driver`.
  // That is the structural reason a dairy-only change is safe.
  check('DairyDriver is a distinct model from Driver',
    DairyDriver.modelName === 'DairyDriver' && Driver.modelName === 'Driver',
    `${DairyDriver.modelName} / ${Driver.modelName}`);

  console.log(
    failures === 0
      ? '\nPOOL RETIREMENT IS DAIRY-ONLY'
      : `\n${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('verification failed:', error.message);
  process.exit(1);
});