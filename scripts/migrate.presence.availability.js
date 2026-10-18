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
 * Normalise `agentpresences.availability` (and drop the impossible
 * `online: true` + `availability: 'offline'` pairing).
 *
 * `availability` is compared as a literal string everywhere: the assignment
 * filter (`availability: { $in: ['available', null] }`), the transfer roster and
 * the supervisor roster's ternary chain. Mongoose does NOT run enum validators
 * on update paths, so a value that was once written as 'Available' or 'busy '
 * fails every one of those comparisons at once — the agent is skipped by
 * auto-assign and rendered "offline" to their supervisor while working.
 * The schema now lowercases/trims on write, but rows written before that
 * setter existed keep their old bytes until someone touches them, so this
 * script rewrites them once.
 *
 * The second pass is the pairing the manual toggle used to leave behind:
 * `presenceStatus('offline')` set `online: false`, then the next heartbeat set
 * `online: true` back, leaving a row that says online-but-offline. Reading that
 * as "offline" hides an agent who is actually at their desk, so `online` is
 * forced false here to match the declared state.
 *
 * Dry run (default):  node scripts/migrate.presence.availability.js
 * Apply:             node scripts/migrate.presence.availability.js --apply
 */

const mongoose = require('mongoose');
const config = require('../src/config/config');
const { AgentPresence } = require('../src/models');
const logger = require('../src/config/logger');

const CANONICAL = ['available', 'busy', 'offline'];
const BATCH = 500;

const canonicalFor = (value) => {
  const normalized = String(value == null ? '' : value)
    .trim()
    .toLowerCase();
  return CANONICAL.includes(normalized) ? normalized : 'available';
};

const migrate = async (apply) => {
  const scanned = await AgentPresence.countDocuments();
  const rogue = await AgentPresence.find({
    $or: [
      { availability: { $nin: CANONICAL } },
      { availability: { $exists: false } },
      { availability: null },
      { online: true, availability: 'offline' },
    ],
  })
    .select('_id online availability')
    .lean();

  const ops = [];
  for (const doc of rogue) {
    const availability = canonicalFor(doc.availability);
    const online = availability === 'offline' ? false : !!doc.online;
    const before = `online=${doc.online} availability=${JSON.stringify(doc.availability)}`;
    const after = `online=${online} availability=${JSON.stringify(availability)}`;
    if (before === after) continue;
    console.log(`  ${String(doc._id)}: ${before} -> ${after}`);
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { availability, online } },
      },
    });
  }

  let modified = 0;
  for (let i = 0; i < ops.length; i += BATCH) {
    const result = await AgentPresence.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    modified += result.modifiedCount || 0;
  }

  const summary = `presence availability: scanned=${scanned} fixed=${modified} dryRun=${!apply}`;
  logger.info(summary);
  console.log(`${apply ? 'complete' : 'DRY RUN complete'} — ${summary}`);
  if (!apply && modified) console.log('Re-run with --apply to write these changes.');
};

(async () => {
  const apply = process.argv.includes('--apply');
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    await migrate(apply);
  } catch (error) {
    logger.error(`presence availability migration failed: ${error.message}`);
    console.error(`presence availability migration failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
