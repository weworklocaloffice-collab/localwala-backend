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
const subscriptionService = require('./services/stores.subscription.service');
const settlementService = require('./services/stores.settlement.service');
const organicService = require('./services/stores.organic.service');
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
      console.error('Subscription sweep failed:', error.message);
    }
  });

  cron.schedule('0 1 * * *', async () => {
    try {
      await organicService.expireCertifications();
    } catch (error) {
      console.error('Organic certification expiry failed:', error.message);
    }
  });

  // Promotions move on their own start/end clock. The customer reads already filter by
  // the window, but the stored status must agree or the partner/admin lists lie.
  cron.schedule('*/10 * * * *', async () => {
    try {
      await promotionService.syncPromotionLifecycle();
    } catch (error) {
      console.error('Promotion lifecycle sweep failed:', error.message);
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
      console.error('Reservation expiry failed:', error.message);
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
            console.error(
              `Settlement generation failed for outlet ${outlet._id}:`,
              error.message,
            );
          }
        }
      }
    } catch (error) {
      console.error('Settlement generation failed:', error.message);
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
      console.error('Remittance generation failed:', error.message);
    }
  });

  console.log('Stores cron jobs scheduled');
};

module.exports = { startCronJobs };