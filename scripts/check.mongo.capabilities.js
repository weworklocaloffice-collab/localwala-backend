/**
 * Reports whether the configured MongoDB deployment supports transactions.
 *
 * Multi-document transactions require a replica set or a mongos router. A
 * standalone mongod silently accepts the session but refuses to commit, which
 * is what broke the first run-lifecycle verification.
 *
 * This matters for the dairy vertical specifically: the can-ledger
 * reconciliation in `delivery.run.service.completeRun` must be atomic, or cans
 * go missing in reconciliation.
 *
 * Usage: node scripts/check.mongo.capabilities.js
 */

const mongoose = require('mongoose');

const run = async () => {
  require('dotenv').config();
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) {
    console.error('MONGODB_URL not set');
    process.exit(1);
  }

  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });
  const admin = mongoose.connection.db.admin();
  const info = await admin.command({ hello: 1 });

  console.log('deployment type :', info.setName ? `replicaset (${info.setName})` : info.msg || 'standalone');
  console.log('supports sessions:', !!(info.maxWireVersion >= 7));
  console.log('isWritablePrimary:', info.isWritablePrimary === true);

  const session = await mongoose.startSession();
  let transactions = false;
  try {
    await session.withTransaction(async () => {
      await mongoose.connection.db.collection('__dairy_tx_probe').insertOne({ ok: 1 }, { session });
    });
    transactions = true;
  } catch (e) {
    transactions = false;
    console.log('transaction probe error:', e.message);
  } finally {
    await mongoose.connection.db.collection('__dairy_tx_probe').drop().catch(() => {});
    await session.endSession();
  }

  console.log('supports transactions:', transactions);
  console.log('');

  if (transactions) {
    console.log('OK — multi-document transactions are available.');
  } else {
    console.log('WARNING — this is a standalone mongod.');
    console.log('Dairy can-ledger writes fall back to sequential writes and are NOT atomic.');
    console.log('');
    console.log('To enable transactions (required before production):');
    console.log('  1. mongod --replSet rs0 --bind_ip 127.0.0.1 --port 27017');
    console.log('  2. mongosh --eval "rs.initiate({_id:\'rs0\',members:[{_id:0,host:\'127.0.0.1:27017\'}]})"');
    console.log('  3. Add ?replicaSet=rs0 to MONGODB_URL');
  }

  await mongoose.disconnect();
  process.exit(transactions ? 0 : 2);
};

run().catch(async (e) => {
  console.error('probe failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});