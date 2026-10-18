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

const cron = require('node-cron');
const logger = require('../config/logger');
const config = require('../config/config');
const zoneService = require('../services/delivery.zone.service');
const { City } = require('../models');

/**
 * zone.cron.js — the ungrouped-volume watch (Batch A-4).
 *
 * The only zone alert that pages: orders flowing from areas no zone covers.
 * Everything else is a dashboard glance. Runs unconditionally (unlike the
 * dispatch sweep, which waits on the cascade flag) because zone rot is
 * independent of the dispatch engine — manual and legacy paths create
 * ungrouped orders too.
 *
 * Registered from src/index.js inside the successful-mongo branch, so the
 * check never runs against an unreachable database.
 */
const startZoneCronJobs = () => {
  const schedule =
    (config.zone && config.zone.ungroupedCron) || '0 6 * * *';
  const threshold =
    config.zone && Number.isFinite(Number(config.zone.ungroupedThreshold))
      ? Number(config.zone.ungroupedThreshold)
      : 0.02;

  cron.schedule(schedule, async () => {
    try {
      const cities = await City.find({ status: true }, { _id: 1, name: 1 }).lean();
      for (const city of cities) {
        try {
          const result = await zoneService.checkUngroupedVolume(city._id, { threshold });
          if (result.alert) {
            logger.warn(
              `Ungrouped delivery volume in ${city.name}: ${result.ungrouped}/${result.total} ` +
                `orders (${(result.ratio * 100).toFixed(1)}%, threshold ${(threshold * 100).toFixed(1)}%) ` +
                `have no zone in the last 24h — review zone coverage.`
            );
          }
        } catch (error) {
          logger.error(`Ungrouped-volume check failed for city ${city._id}: ${error.message}`);
        }
      }
    } catch (error) {
      logger.error(`Zone ungrouped sweep failed: ${error.message}`);
    }
  });

  logger.info(`Zone ungrouped-volume watch scheduled (${schedule}).`);
};

module.exports = { startZoneCronJobs };
