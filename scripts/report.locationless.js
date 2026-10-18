/*
 * Reports dairy outlets that cannot be dispatched to.
 *
 * A business with no city or locality is invisible to delivery zoning: no run can be
 * routed there. Registration now refuses such an outlet outright, so anything still
 * missing predates that rule — or was written directly.
 *
 * This is read-only. It prints what it finds so a human can decide whether each row
 * is real data or a leftover, because the two need opposite handling and only someone
 * who knows the business can tell them apart.
 *
 * Usage: `node scripts/report.locationless.js`
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { Business, User, Wallet, DairyPartner, DairyOrder, DairySubscription } = require('../src/models');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const rows = await Business.find({
    vertical: 'dairy',
    $or: [{ city: null }, { locality: null }, { city: { $exists: false } }, { locality: { $exists: false } }],
  })
    .populate('owner', 'firstName lastName email mobile countryCode createdAt')
    .lean();

  console.log(`\nDairy outlets missing a city or a locality: ${rows.length}\n`);

  if (!rows.length) {
    console.log('  none — every dairy outlet can be dispatched to.');
    process.exit(0);
    return;
  }

  for (const b of rows) {
    const missing = [];
    if (!b.city) missing.push('city');
    if (!b.locality) missing.push('locality');

    // Whether deleting it would break anything, and whether anything real is
    // attached to it. A business with orders is a different proposition from an
    // empty shell.
    const [orders, subs, partner, wallet] = await Promise.all([
      DairyOrder.countDocuments({ business: b._id }),
      DairySubscription.countDocuments({ business: b._id }),
      DairyPartner.findOne({ business: b._id }).lean(),
      b.owner && b.owner._id ? Wallet.findOne({ holderId: b.owner._id }).lean() : null,
    ]);

    const ownerName = b.owner
      ? `${b.owner.firstName} ${b.owner.lastName}`.trim()
      : '(no owner)';
    const ownerCreated = b.owner && b.owner.createdAt ? b.owner.createdAt.toISOString().slice(0, 10) : '?';

    console.log(`  ${b.name}`);
    console.log(`    _id          ${b._id}`);
    console.log(`    owner        ${ownerName}  (${ownerCreated})`);
    console.log(`    phone        ${b.owner && b.owner.mobile ? `+${b.owner.countryCode || ''}${b.owner.mobile}` : '—'}`);
    console.log(`    email        ${(b.owner && b.owner.email) || '—'}`);
    console.log(`    missing      ${missing.join(' and ')}`);
    console.log(`    verified     ${b.verified === true}`);
    console.log(`    businessModel ${b.businessModel || '—'}`);
    console.log(`    address      ${b.address || '(none)'}`);
    console.log(`    orders       ${orders}`);
    console.log(`    subscriptions${subs === 0 ? ' ' : ' '}${subs}`);
    console.log(`    partner row  ${partner ? 'yes' : 'no'}`);
    console.log(`    wallet       ${wallet ? `yes, balance ${wallet.balance}` : 'no'}`);
    console.log('');
  }

  console.log(
    '  Nothing has been changed. Deleting an outlet with orders or a wallet is a\n' +
      '  different decision from removing an empty shell, so each needs a human.'
  );

  process.exit(0);
};

run().catch((error) => {
  console.error('report failed:', error.message);
  process.exit(1);
});