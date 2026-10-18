/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB)
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
 * Initiates the single-node replica set and proves transactions work.
 *
 * Run by `scripts/enable-replica-set.ps1` after it has edited `mongod.cfg` and
 * restarted the service. Kept separate because this half needs no administrator
 * rights — it is ordinary application code using the same driver and the same
 * `MONGODB_URL` as the API, which is the only connection path that actually matters.
 *
 * Why not `mongosh`:
 *   MongoDB 8.3 ships only `mongod.exe` and `mongos.exe`. There is no shell binary
 *   beside them, so the original version of the PowerShell script could never have
 *   completed its own verification — it would have exited asking for a manual
 *   `rs.initiate`. Using the driver removes that dependency entirely.
 *
 * Why this is the honest verification:
 *   Proving transactions inside the server (or in mongosh) only shows the *deployment*
 *   supports them. It does not show the *application's* connection can use them. A
 *   URI without `replicaSet=rs0` can be talked to as a single node, which accepts a
 *   session and then refuses to commit. Running the probe through the real
 *   `MONGODB_URL` is the only check that catches that.
 *
 * Steps:
 *   1. report the current deployment type
 *   2. if the set is not initiated, initiate it — and report a failure as a failure
 *   3. poll until this node is PRIMARY (an election happens; sleeping a fixed 4
 *      seconds and then probing reports a healthy set as broken on a slow machine)
 *   4. commit a real transaction through the app's own connection, then remove the
 *      probe database rather than leaving an empty one behind
 *
 * Usage: node scripts/mongo.replica-set.js
 * Exits 0 when transactions are confirmed working, 1 otherwise.
 */

const mongoose = require('mongoose');

const PROBE_DB = 'replset_probe';
const ELECTION_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 500;

/**
 * Waits for this node to finish its election.
 *
 * `myState` 1 is PRIMARY, 2 is SECONDARY, 0 means the set has no primary yet. Until
 * it is 1 a transaction cannot commit, which is exactly why a fixed sleep is the
 * wrong tool here.
 */
const waitForPrimary = async () => {
  const deadline = Date.now() + ELECTION_TIMEOUT_MS;
  let last = null;

  while (Date.now() < deadline) {
    try {
      const status = await mongoose.connection.db.admin().command({ replSetGetStatus: 1 });
      const mine = (status.members || []).find((m) => m.self === true);
      const state = mine ? mine.stateStr : 'unknown';
      last = state;

      if (mine && mine.state === 1) {
        return { ok: true, state, setName: status.set };
      }
      // state 0 = removed from the set, 6 = not yet caught up
      if (mine && (mine.state === 0 || mine.state === 6)) {
        return { ok: false, state, setName: status.set, reason: 'node is not usable' };
      }
    } catch (err) {
      last = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { ok: false, state: last || 'unknown', reason: `no PRIMARY within ${ELECTION_TIMEOUT_MS / 1000}s` };
};

/**
 * Commits a real multi-document transaction through this connection.
 *
 * Writes two documents so it is genuinely multi-document, and drops the whole probe
 * database afterwards rather than leaving an empty one behind.
 */
const probeTransactions = async () => {
  const db = mongoose.connection.useDb(PROBE_DB);
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      await db.collection('a').insertOne({ n: 1 }, { session });
      await db.collection('b').insertOne({ n: 2 }, { session });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await session.endSession().catch(() => {});
    // `db` is the PROBE_DB connection (via `useDb`), so this drops the probe
    // database itself rather than leaving an empty one behind.
    await db.dropDatabase().catch(() => {});
  }
};

const run = async () => {
  require('dotenv').config();

  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) {
    console.error('MONGODB_URL not set - cannot verify against the application connection');
    process.exit(1);
  }

  console.log('Connecting with the application MONGODB_URL');
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000, directConnection: undefined });

  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  console.log('  deployment type :', hello.setName ? `replicaset (${hello.setName})` : hello.msg || 'standalone');

  if (!hello.setName) {
    console.error('');
    console.error('This mongod is still standalone, so `replSetName` is not set in mongod.cfg');
    console.error('or the service has not been restarted since it was added.');
    console.error('');
    console.error('Check the config has an uncommented block like:');
    console.error('  replication:');
    console.error('    replSetName: rs0');
    await mongoose.disconnect();
    process.exit(1);
  }

  // ---- 2. Initiate if needed ------------------------------------------------
  let status = null;
  try {
    status = await mongoose.connection.db.admin().command({ replSetGetStatus: 1 });
  } catch {
    status = null;
  }

  if (status) {
    console.log('  set is already initiated');
  } else {
    console.log('  set is not initiated - calling rs.initiate()');
    try {
      const result = await mongoose.connection.db.admin().command({
        replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] },
      });
      if (result.ok !== 1) {
        // Reported rather than swallowed. The earlier version of this script caught
        // every error here and carried on to the probe, which then reported a set
        // that was never created as "the set is up".
        throw new Error(`replSetInitiate returned ok=${result.ok} (${JSON.stringify(result)})`);
      }
      console.log('  initiated');
    } catch (err) {
      console.error('');
      console.error('rs.initiate failed:', err.message);
      console.error('  The set does not exist. Fix the error above and run this again.');
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  // ---- 3. Wait for the election ---------------------------------------------
  console.log('  waiting for this node to become PRIMARY');
  const primary = await waitForPrimary();
  console.log('  node state:', primary.state);

  if (!primary.ok) {
    console.error('');
    console.error('The node did not become PRIMARY:', primary.reason);
    console.error('  Check: mongod.log, and confirm the host in the set matches how you connect.');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('  PRIMARY on set', primary.setName);

  // ---- 4. Prove transactions through this connection -----------------------
  const probe = await probeTransactions();
  if (!probe.ok) {
    console.error('');
    console.error('Transaction probe failed:', probe.error);
    console.error('');
    console.error('The set is up but this connection still cannot transact.');
    console.error('The usual cause is a URI without the set name. Try:');
    console.error('  mongodb://127.0.0.1:27017/foodbite?replicaSet=rs0');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('');
  console.log('OK - multi-document transactions are available through the application URL.');
  console.log('');
  console.log('Confirm and re-run the suites that depend on atomicity:');
  console.log('  node scripts/check.mongo.capabilities.js');
  console.log('  node scripts/verify.dairy.cans.js');
  console.log('  node scripts/verify.all.dairy.js');

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error('');
  console.error('mongo.replica-set.js could not run:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});