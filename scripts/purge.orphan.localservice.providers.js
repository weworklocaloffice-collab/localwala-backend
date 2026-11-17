/*
 * Local Services — orphaned provider profiles cleanup.
 *
 * Provider profiles (localserviceproviders) are separate documents from the
 * owning user (users). MongoDB does not cascade, so deleting a user directly
 * in the database leaves the provider row (and its offerings, documents,
 * staff, etc.) behind — the admin Providers list keeps showing them.
 *
 * This script finds providers whose `owner` no longer exists in `users` and
 * removes them together with their provider-owned configuration. Financial
 * records (bookings, invoices, revenue entries, refunds, audit logs) are kept
 * for accounting history.
 *
 * Usage:
 *   node scripts/purge.orphan.localservice.providers.js           report only
 *   node scripts/purge.orphan.localservice.providers.js --apply   delete
 */

require('dotenv').config();

const mongoose = require('mongoose');
const {
  findOrphanProviders,
  purgeProviderData,
} = require('../src/modules/local-services/services/ls.user.cascade.service');

const APPLY = process.argv.includes('--apply');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  console.log('\nLocal Services — orphan provider scan');
  console.log(`  database   ${mongoose.connection.db.databaseName}`);
  console.log(`  mode       ${APPLY ? 'apply (delete)' : 'dry run (report only)'}\n`);

  const providers = await findOrphanProviders();

  if (!providers.length) {
    console.log('  no orphaned provider profiles found\n');
    process.exit(0);
  }

  providers.forEach((provider) => {
    console.log(`  provider   ${provider._id}`);
    console.log(`    business ${provider.businessName || '—'}`);
    console.log(`    status   ${provider.status || '—'}`);
    console.log(`    phone    ${provider.contactPhone || '—'}`);
    console.log(`    owner    ${provider.owner || '—'} (missing in users)`);
    console.log(`    created  ${provider.createdAt ? provider.createdAt.toISOString() : '—'}\n`);
  });

  if (!APPLY) {
    console.log(`  ${providers.length} orphaned provider(s) found — re-run with --apply to delete\n`);
    process.exit(0);
  }

  const result = await purgeProviderData(providers);
  console.log(`  providers  removed ${result.providers}`);
  Object.entries(result.deleted).forEach(([name, count]) => {
    if (count) console.log(`  ${name.padEnd(10)} removed ${count}`);
  });
  console.log('\n  financial records (bookings, invoices, revenue, refunds, audit) kept\n');

  process.exit(0);
};

run().catch((error) => {
  console.error('orphan provider purge failed:', error.message);
  process.exit(1);
});
