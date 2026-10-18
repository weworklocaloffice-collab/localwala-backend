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
 * Backfill `users.phoneHash` for every user that already has a mobile number.
 *
 * The pre-save hook on the User schema keeps the field in sync going forward.
 * This script fills the gap for rows that existed before the field landed, so
 * the contact-matching service can stop doing a full user-table scan and use
 * the new sparse unique index instead.
 *
 * Run:  node scripts/migrate.user.phonehash.js
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('../src/config/config');
const { User } = require('../src/models');
const logger = require('../src/config/logger');

const BATCH = 1000;

const hashFor = (countryCode, mobile) => {
  const digits = (countryCode || '').toString() + (mobile || '').toString();
  const normalized = digits.replace(/\D/g, '').replace(/^0+/, '');
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

const migrate = async () => {
  const cursor = User.find({
    mobile: { $exists: true, $ne: null, $ne: '' },
    $or: [{ phoneHash: null }, { phoneHash: { $exists: false } }],
  })
    .select('_id countryCode mobile')
    .cursor();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const buffer = [];

  const flush = async () => {
    if (!buffer.length) return;
    const result = await User.bulkWrite(
      buffer.map((op) => ({
        updateOne: {
          filter: { _id: op._id, phoneHash: null },
          update: { $set: { phoneHash: op.phoneHash } },
        },
      })),
      { ordered: false }
    );
    updated += result.modifiedCount || 0;
    buffer.length = 0;
  };

  for await (const doc of cursor) {
    scanned += 1;
    const hash = hashFor(doc.countryCode, doc.mobile);
    if (!hash) {
      skipped += 1;
      continue;
    }
    buffer.push({ _id: doc._id, phoneHash: hash });
    if (buffer.length >= BATCH) {
      await flush();
    }
  }
  await flush();

  logger.info(`phoneHash backfill: scanned=${scanned} updated=${updated} skipped=${skipped}`);
  console.log(`phoneHash backfill complete — scanned=${scanned} updated=${updated} skipped=${skipped}`);
};

(async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    await migrate();
  } catch (error) {
    logger.error(`phoneHash backfill failed: ${error.message}`);
    console.error(`phoneHash backfill failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
