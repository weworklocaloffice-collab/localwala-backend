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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const cron = require('node-cron');
const logger = require('../../config/logger');
const subscriptionService = require('./services/stores.subscription.service');
const customerSubscriptionService = require('./services/stores.customer.subscription.service');
const settlementService = require('./services/stores.settlement.service');
const organicService = require('./services/stores.organic.service');
const taxonomyService = require('./services/stores.admin.taxonomy.service');
const inventoryService = require('./services/stores.inventory.service');
const orderService = require('./services/stores.order.service');
const remittanceService = require('./services/stores.remittance.service');
const promotionService = require('./services/stores.promotion.service');

const startCronJobs = () => {
  cron.schedule('0 2 * * *', async () => {
    try {
      // Billing and dunning first. Order matters: a subscription that is overdue on BOTH
      // grace and the long-stop should be suspended by the grace sweep, then expired by a
      // later run — not expired in the same pass.
      await subscriptionService.processBillingSweep();
      await subscriptionService.processGracePeriodExpiry();
      await subscriptionService.processSuspendedExpiry();
      await subscriptionService.processTrialExpiry();
    } catch (error) {
      logger.error(`Subscription sweep failed: ${error.message}`);
    }
  });

  // §6.18.6: the customer recurring-box generator, nightly just after midnight so an
  // occurrence "for today" exists before the store's morning prep list is built. It is
  // idempotent by the (subscription, occurrenceDate) unique index, so an overlap with
  // the 02:00 billing sweep is safe, not a duplicate.
  cron.schedule('15 0 * * *', async () => {
    try {
      const summary = await customerSubscriptionService.generateOccurrences();
      logger.info(`[stores] recurring occurrence generation: generated=${summary.generated} skipped=${summary.skipped} advanced=${summary.advanced} failures=${summary.failures}`);
    } catch (error) {
      logger.error(`Recurring occurrence generation failed: ${error.message}`);
    }
  });

  cron.schedule('0 1 * * *', async () => {
    try {
      await organicService.expireCertifications();
    } catch (error) {
      logger.error(`Organic certification expiry failed: ${error.message}`);
    }

    try {
      await taxonomyService.expireBrandCertifications();
    } catch (error) {
      logger.error(`Brand certification expiry failed: ${error.message}`);
    }
  });

  // Promotions move on their own start/end clock. The customer reads already filter by
  // the window, but the stored status must agree or the partner/admin lists lie.
  cron.schedule('*/10 * * * *', async () => {
    try {
      await promotionService.syncPromotionLifecycle();
    } catch (error) {
      logger.error(`Promotion lifecycle sweep failed: ${error.message}`);
    }
  });

  cron.schedule('*/30 * * * *', async () => {
    try {
      const mongoose = require('mongoose');
      const StoreStockReservation = mongoose.model('StoreStockReservation');
      const StoreOrder = mongoose.model('StoreOrder');
      const expired = await StoreStockReservation.findExpired();
      const touchedOrders = new Set();
      for (const res of expired) {
        await inventoryService.releaseReservation({
          order: res.order,
          variant: res.variant,
          quantity: res.quantity,
          reason: 'expired',
        });
        touchedOrders.add(String(res.order));
      }
      // Unpaid orders whose stock has all timed out can never be fulfilled —
      // close them instead of leaving them in `created` forever. Gateway
      // orders use the standard reservation TTL; COD orders use the outlet's
      // codAcceptanceTimeoutMinutes, which belongs to the reservation TTL.
      // `created -> cancelled` is the only transition taken here; anything
      // else the order did since is untouched.
      for (const orderId of touchedOrders) {
        const order = await StoreOrder.findById(orderId).select('lifecycle paymentMode');
        if (!order) continue;
        // COD is not collected at creation either; it waits out the
        // outlet-configured reservation TTL before this cancel runs.
        if (!['created', 'payment_pending'].includes(order.lifecycle)) continue;
        const stillHeld = await StoreStockReservation.countDocuments({ order: order._id, status: 'held' });
        if (stillHeld > 0) continue;
        await orderService.transitionOrder(order._id, 'cancelled');
      }
    } catch (error) {
      logger.error(`Reservation expiry failed: ${error.message}`);
    }
  });

  // §6.5: the reconciliation sweep. Hourly, NOT nightly — availableQty guards the
  // oversell query in real time, so a drifted row is a live oversell window that
  // should be closed in minutes, not by the next morning.
  cron.schedule('5 * * * *', async () => {
    try {
      const summary = await inventoryService.reconcileStock();
      if (summary.corrected.length || summary.uncorrectable.length) {
        logger.warn(`[stores] stock reconciliation: corrected=${summary.corrected.length} uncorrectable=${summary.uncorrectable.length} scanned=${summary.scanned}`);
      }
    } catch (error) {
      logger.error(`Stock reconciliation failed: ${error.message}`);
    }
  });

  cron.schedule('0 5 * * *', async () => {
    // The sweep runs daily, but each chain's own cadence decides which window is
    // settled. `settlementPeriodFor` ages the window by `tPlusDays` and aligns weekly
    // and monthly boundaries, so a repeated call returns the same (from, to) and
    // `generateSettlement` dedupes it instead of writing a second payout.
    try {
      const mongoose = require('mongoose');
      const StoreSubscription = mongoose.model('StoreSubscription');
      const StoreOutlet = mongoose.model('StoreOutlet');
      const StoreChain = mongoose.model('StoreChain');

      const activeSubs = await StoreSubscription.find({ status: 'active' })
        .select('chain business')
        .lean();

      const chainIds = [...new Set(activeSubs.map((sub) => sub.chain).filter(Boolean).map(String))];
      const chains = await StoreChain.find({ _id: { $in: chainIds } })
        .select('settings.settlementConfig')
        .lean();
      const settlementConfigByChain = new Map(
        chains.map((chain) => [String(chain._id), chain.settings?.settlementConfig || {}])
      );

      for (const sub of activeSubs) {
        if (!sub.chain) continue;

        const config = settlementConfigByChain.get(String(sub.chain)) || {};
        const cadence = ['daily', 'weekly', 'monthly'].includes(config.cadence) ? config.cadence : 'daily';
        const tPlusDays = Number.isFinite(Number(config.tPlusDays)) ? Math.max(0, Number(config.tPlusDays)) : 2;
        const { from, to } = settlementService.settlementPeriodFor(cadence, tPlusDays);

        // A settlement belongs to ONE outlet (BR-18/BR-42: the outlet is the merchant
        // of record and holds the bank account). `chain.outlets` is not a populated
        // field on the subscription, so resolve the chain's outlets explicitly.
        const outlets = await StoreOutlet.find({ chain: sub.chain, status: 'active' })
          .select('_id')
          .lean();

        for (const outlet of outlets) {
          try {
            await settlementService.generateSettlement({
              vertical: 'stores',
              counterpartyType: 'store_owner',
              counterparty: sub.business,
              store: outlet._id,
              chain: sub.chain,
              settlementType: 'order_revenue',
              period: cadence,
              from,
              to,
            });
          } catch (error) {
            // One bad outlet must not stop the rest of the chain or the sweep.
            logger.error(`Settlement generation failed for outlet ${outlet._id}: ${error.message}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Settlement generation failed: ${error.message}`);
    }
  });

  // Remittance generation cron: runs at 3 AM daily for the previous day's COD collections
  cron.schedule('0 3 * * *', async () => {
    try {
      const mongoose = require('mongoose');
      const StoreDriver = mongoose.model('StoreDriver');
      const StoreOutlet = mongoose.model('StoreOutlet');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      const drivers = await StoreDriver.find({ status: 'active' }).lean();
      for (const driver of drivers) {
        const outlet = await StoreOutlet.findById(driver.store).select('chain').lean();
        if (!outlet) continue;
        await remittanceService.generateRemittanceForDriver(driver._id, driver.store, outlet.chain, yesterday);
      }
    } catch (error) {
      logger.error(`Remittance generation failed: ${error.message}`);
    }
  });

  // Reconciliation sweep: repair occurrences that have no order (crash recovery).
  cron.schedule('*/15 * * * *', async () => {
    try {
      const summary = await customerSubscriptionService.reconcileOccurrences();
      if (summary.repaired || summary.failed) {
        logger.info(`[stores] occurrence reconciliation: scanned=${summary.scanned} repaired=${summary.repaired} failed=${summary.failed}`);
      }
    } catch (error) {
      logger.error(`Occurrence reconciliation failed: ${error.message}`);
    }
  });
};

module.exports = { startCronJobs };