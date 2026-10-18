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
 * Retires the dairy platform pool.
 *
 * A dairy rider is now always employed by one outlet, so:
 *
 *   - `DairyDriver.business` is required, and the one existing pool rider has none
 *   - every dairy `Business` runs its own riders (`ownDeliveryPartner: true`)
 *   - every dairy `Business` and `DairyPartner` pays its riders (`business_pays`)
 *
 * The rider is the awkward one. There is no correct outlet to attach it to, and no
 * way to invent one, so it is **disabled rather than deleted** and printed for a
 * human to look at. Disabling keeps the audit trail and the row; deleting would
 * destroy a delivery history that is referenced by past runs.
 *
 * The outlet flags are safe to set outright: `ownDeliveryPartner: false` previously
 * meant "the platform dispatches this outlet's riders", and with no pool that state
 * is simply broken — nobody would ever deliver its orders.
 *
 * Safe to run twice.
 *
 * Usage: `node scripts/migrate.retire.pool.js [--dry]`
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { Business, DairyDriver, DairyPartner } = require('../src/models');

const DRY = process.argv.includes('--dry');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const write = async (label, filter, update) => {
    const count = await Business.countDocuments(filter);
    if (count === 0) {
      console.log(`  none   ${label}`);
      return 0;
    }
    console.log(`  ${DRY ? 'would fix' : 'fixed'} ${count}  ${label}`);
    if (!DRY) {
      await Business.updateMany(filter, update);
    }
    return count;
  };

  console.log(`\n1. Pool riders (business: null)`);

  const orphans = await DairyDriver.find({ business: null }).select('userId city locality status');

  if (!orphans.length) {
    console.log('  none');
  } else {
    for (const driver of orphans) {
      console.log(
        `  driver ${driver._id}  user=${driver.userId}  ` +
          `city=${driver.city || '-'} locality=${driver.locality || '-'}`
      );
    }
    console.log(
      '  ^ no outlet can be inferred for these. Disabled, not deleted: past runs\n' +
        '    reference them and deleting would break that history. Attach each to an\n' +
        '    outlet by hand if it was really working for one.'
    );
    if (!DRY) {
      await DairyDriver.updateMany(
        { business: null },
        { $set: { status: false, activeStatus: false } }
      );
      console.log(`  disabled ${orphans.length} pool rider(s)`);
    }
  }

  console.log(`\n2. Dairy outlets not running their own riders`);

  await write(
    'Business.ownDeliveryPartner: false -> true',
    { vertical: 'dairy', ownDeliveryPartner: { $ne: true } },
    { $set: { ownDeliveryPartner: true } }
  );

  await write(
    'Business.driverPayoutMode: platform_pays -> business_pays',
    { vertical: 'dairy', driverPayoutMode: 'platform_pays' },
    { $set: { driverPayoutMode: 'business_pays' } }
  );

  const partnerFilter = { driverPayoutMode: 'platform_pays' };
  const partnerCount = await DairyPartner.countDocuments(partnerFilter);
  if (partnerCount === 0) {
    console.log('  none   DairyPartner.driverPayoutMode: platform_pays -> business_pays');
  } else {
    console.log(`  ${DRY ? 'would fix' : 'fixed'} ${partnerCount}  DairyPartner.driverPayoutMode -> business_pays`);
    if (!DRY) {
      await DairyPartner.updateMany(partnerFilter, { $set: { driverPayoutMode: 'business_pays' } });
    }
  }

  console.log(`\n3. Verifying`);

  // Only an *active* orphan means the migration did not finish. A disabled one is
  // the intended end state — there is no outlet to attach it to, so it is parked
  // for a human rather than deleted.
  const activeOrphans = await DairyDriver.countDocuments({ business: null, status: true });
  const parkedOrphans = await DairyDriver.countDocuments({ business: null, status: false });
  const remainingFalse = await Business.countDocuments({
    vertical: 'dairy',
    ownDeliveryPartner: { $ne: true },
  });
  const remainingPlatformPays = await Business.countDocuments({
    vertical: 'dairy',
    driverPayoutMode: 'platform_pays',
  });

  console.log(`  active pool riders left       ${activeOrphans}`);
  console.log(`  parked for a human            ${parkedOrphans}`);
  console.log(`  dairy outlets not own-fleet   ${remainingFalse}`);
  console.log(`  dairy outlets on platform_pays ${remainingPlatformPays}`);

  const clean = activeOrphans === 0 && remainingFalse === 0 && remainingPlatformPays === 0;
  console.log(clean ? '\nMIGRATION COMPLETE' : '\nMIGRATION INCOMPLETE — see above');

  process.exit(clean || DRY ? 0 : 1);
};

run().catch((error) => {
  console.error('migration failed:', error.message);
  process.exit(1);
});