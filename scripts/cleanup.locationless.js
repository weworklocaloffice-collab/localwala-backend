/*
 * Removes dairy outlets that cannot be dispatched to, when they are provably empty.
 *
 * ## What this is for
 *
 * Three outlets existed with no city and no locality yet `verified: true`. All three
 * were test fixtures — names matching template literals in `verify.dairy.settlements`
 * and `verify.dairy.payables`, emails on `@settle.local` / `@payable.local`, zero
 * orders, zero subscriptions, no partner row, zero wallet balance. They predated the
 * registration-time location rules, and the current suites no longer leak rows.
 *
 * ## What it will refuse to do
 *
 * Delete an outlet that has any history. A business with orders, subscriptions, a
 * franchise or franchise agreement, or a non-zero wallet balance is skipped and
 * reported. Removing those is a business decision, not a cleanup, and guessing at one
 * is how real orders get stranded.
 *
 * Registration now refuses a location-less outlet, and `reviewJoiningRequest` refuses
 * to approve one, so nothing new should appear.
 *
 * Usage:
 *   node scripts/cleanup.locationless.js --dry   report only
 *   node scripts/cleanup.locationless.js          delete the empty shells
 */

require('dotenv').config();

const mongoose = require('mongoose');
const {
  Business,
  User,
  Wallet,
  Transactions,
  DairyPartner,
  DairyFranchise,
  DairyOrder,
  DairySubscription,
  DairySku,
  DairyProduct,
  DeliveryRun,
} = require('../src/models');

const DRY = process.argv.includes('--dry');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const rows = await Business.find({
    vertical: 'dairy',
    $or: [{ city: null }, { locality: null }, { city: { $exists: false } }, { locality: { $exists: false } }],
  }).populate('owner', 'firstName lastName email mobile');

  console.log(`\nLocation-less dairy outlets: ${rows.length}\n`);

  let removed = 0;
  let kept = 0;

  for (const b of rows) {
    const ownerId = b.owner ? b.owner._id : null;

    const [orders, subs, partners, franchises, skus, products, runs, wallet, transactions] =
      await Promise.all([
        DairyOrder.countDocuments({ business: b._id }),
        DairySubscription.countDocuments({ business: b._id }),
        DairyPartner.countDocuments({ business: b._id }),
        DairyFranchise.countDocuments({ business: b._id }),
        DairySku.countDocuments({ business: b._id }),
        DairyProduct.countDocuments({ business: b._id }),
        DeliveryRun.countDocuments({ business: b._id }),
        ownerId ? Wallet.findOne({ holderId: ownerId }).lean() : null,
        ownerId ? Transactions.countDocuments({ holderId: ownerId }) : 0,
      ]);

    const balance = wallet ? wallet.balance : 0;
    // Anything at all means this is not an empty shell.
    const hasHistory =
      orders > 0 ||
      subs > 0 ||
      partners > 0 ||
      franchises > 0 ||
      skus > 0 ||
      products > 0 ||
      runs > 0 ||
      transactions > 0 ||
      balance > 0;

    console.log(`  ${b.name}`);
    console.log(`    owner      ${b.owner ? `${b.owner.firstName} ${b.owner.lastName}` : '(none)'}`);
    console.log(
      `    history    orders=${orders} subs=${subs} partners=${partners} ` +
        `franchises=${franchises} skus=${skus} products=${products} runs=${runs} ` +
        `transactions=${transactions} balance=${balance}`
    );

    if (hasHistory) {
      console.log('    action     KEPT — this outlet has history, so deleting it is not a cleanup\n');
      kept += 1;
      continue;
    }

    if (DRY) {
      console.log('    action     would delete (user + wallet + outlet)\n');
      removed += 1;
      continue;
    }

    // Order matters: the wallet and the user are only safe to remove once nothing
    // points at the outlet.
    if (ownerId) {
      await Wallet.deleteMany({ holderId: ownerId });
      await Transactions.deleteMany({ holderId: ownerId });
    }
    await Business.updateOne({ _id: b._id }, { $pull: { deliveryPartners: ownerId } });
    await Business.deleteOne({ _id: b._id });
    if (ownerId) {
      // Only if nothing else owns one — the owner may own several outlets.
      const otherOutlets = await Business.countDocuments({ owner: ownerId });
      if (otherOutlets === 0) {
        await User.deleteOne({ _id: ownerId });
      }
    }

    console.log('    action     deleted\n');
    removed += 1;
  }

  console.log(`  ${removed} ${DRY ? 'would be removed' : 'removed'}, ${kept} kept`);

  const remaining = await Business.countDocuments({
    vertical: 'dairy',
    $or: [{ city: null }, { locality: null }, { city: { $exists: false } }, { locality: { $exists: false } }],
  });
  console.log(`  location-less dairy outlets remaining: ${remaining}\n`);

  process.exit(0);
};

run().catch((error) => {
  console.error('cleanup failed:', error.message);
  process.exit(1);
});