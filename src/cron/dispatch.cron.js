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
const dispatchService = require('../services/dispatch.service');

/**
 * The dispatch clock.
 *
 * Offers used to have no expiry and there was no sweeper, which is the whole
 * reason an order whose rider simply did not answer sat at `driverAssign: 'ideal'`
 * indefinitely — invisible to both the rider app and the operations queue. This
 * sweep is what gives an offer a deadline.
 *
 * Registered from src/index.js inside the successful-mongo branch, so no sweep
 * ever runs against an unreachable database.
 */
const startDispatchCronJobs = () => {
  // Off until the ladder has been compared against real assignments in shadow
  // mode. Registering the sweep anyway would churn writes on offers created by
  // the legacy path, which have `expiresAt: null` and are correctly skipped.
  if (!dispatchService.isCascadeEnabled()) {
    logger.info('Dispatch cascade disabled; offer-expiry sweep not started.');
    return;
  }

  const schedule = (config.dispatch && config.dispatch.cronExpiry) || '* * * * *';

  cron.schedule(schedule, async () => {
    try {
      const result = await dispatchService.expireOffers();
      if (result.swept) {
        logger.info(
          `Dispatch expiry: ${result.swept} offer(s) expired, ${result.escalated} order(s) escalated, ` +
            `${result.terminal} terminal`
        );
      }
    } catch (error) {
      logger.error(`Dispatch expiry sweep failed: ${error.message}`);
    }
  });

  logger.info(`Dispatch offer-expiry sweep scheduled (${schedule}).`);
};

module.exports = { startDispatchCronJobs };
