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
 * Re-transcode every reel that already has source media, regardless of status.
 * Use this when the ffmpeg transcode args change (e.g. we added `-pix_fmt yuv420p`
 * to fix a 10-bit HDR playback bug) and the existing renditions need re-encoding
 * without re-uploading the source video.
 *
 * Run:  node scripts/retranscode.reels.js
 */

const mongoose = require('mongoose');
const config = require('../src/config/config');
const { Reel } = require('../src/models');
const logger = require('../src/config/logger');
const mediaService = require('../src/modules/reels/admin/reels.media.service');

const BATCH = 5;

const run = async () => {
  const cursor = Reel.find({ 'media.sourceKey': { $exists: true, $ne: null } })
    .select('_id status media.sourceKey')
    .cursor();

  let scanned = 0;
  let retried = 0;
  let failed = 0;
  const buffer = [];

  const flush = async () => {
    if (!buffer.length) return;
    const results = await mediaService.pollProcessing({ limit: buffer.length });
    for (const row of results.results) {
      const reel = buffer.shift();
      if (row.status === 'READY') {
        retried += 1;
        logger.info(`retranscode: reel ${reel._id} READY`);
      } else {
        failed += 1;
        logger.error(`retranscode: reel ${reel._id} stuck at ${row.status}`);
      }
    }
  };

  for await (const doc of cursor) {
    scanned += 1;
    // Force back to PROCESSING so pollProcessing picks it up.
    await Reel.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'PROCESSING',
          'media.renditions': [],
          'media.thumbnailUrl': undefined,
          videoUrl: 'pending://retranscode',
          processing: { stage: 'PROCESSING', progress: 0 },
        },
      }
    );
    buffer.push(doc);
    if (buffer.length >= BATCH) {
      await flush();
    }
  }
  await flush();

  logger.info(`retranscode done — scanned=${scanned} retried=${retried} failed=${failed}`);
  console.log(`retranscode complete — scanned=${scanned} retried=${retried} failed=${failed}`);
};

(async () => {
  try {
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    await run();
  } catch (err) {
    logger.error(`retranscode script failed: ${err.message}`);
    console.error(`retranscode script failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
