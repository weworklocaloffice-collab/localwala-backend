/**
 * Reconcile stuck Razorpay initiations (enterprise sweep).
 * Finds `initiated` rows older than --min (default 30) with a stored
 * razorpay_order_id, checks orders/{id}/payments at Razorpay, marks
 * captured ones paid via the shared dispatch.
 *
 * Run (test DB only, never prod without care):
 *   node scripts/reconcile.stuck.payments.js --mongo mongodb://localhost:27017/localwala_test --min 30 --limit 50
 *   node scripts/reconcile.stuck.payments.js --dry
 *
 * Exit: 0 ok, 1 error.
 */
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry');
const mongoArg = process.argv.includes('--mongo') ? process.argv[process.argv.indexOf('--mongo') + 1] : null;
const minArg = process.argv.includes('--min') ? parseInt(process.argv[process.argv.indexOf('--min') + 1], 10) : 30;
const limitArg = process.argv.includes('--limit') ? parseInt(process.argv[process.argv.indexOf('--limit') + 1], 10) : 50;

async function main() {
  const uri = mongoArg || process.env.MONGO_URL || process.env.MONGODB_URL;
  if (!uri) {
    console.error('Usage: node scripts/reconcile.stuck.payments.js --mongo <MONGO_URL> [--min 30] [--limit 50]');
    process.exit(1);
  }
  await mongoose.connect(uri);
  // Require after connect so config/env loads in script context.
  const { reconcileStuckRazorpayPayments } = require('../src/controllers/payment.initiation.controller');
  if (DRY) {
    const { PaymentInitiation } = require('../src/models');
    const cutoff = new Date(Date.now() - minArg * 60 * 1000);
    const count = await PaymentInitiation.countDocuments({
      status: 'initiated',
      createdAt: { $lt: cutoff },
      'payResponse.razorpay_order_id': { $exists: true, $ne: '' },
    });
    console.log(JSON.stringify({ dry: true, stuckOlderThanMin: minArg, count }));
    await mongoose.disconnect();
    return;
  }
  const result = await reconcileStuckRazorpayPayments(minArg, limitArg);
  console.log(JSON.stringify({ success: true, ...result }));
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(JSON.stringify({ success: false, error: e && e.message }));
  try {
    await mongoose.disconnect();
  } catch (discErr) {
    void discErr;
  }
  process.exit(1);
});
