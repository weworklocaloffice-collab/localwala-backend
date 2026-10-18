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
    try {
      const StoreSubscription = require('mongoose').model('StoreSubscription');
      const activeSubs = await StoreSubscription.find({ status: 'active' });
      for (const sub of activeSubs) {
        await settlementService.generateSettlement({
          vertical: 'stores',
          counterpartyType: 'store_owner',
          counterparty: sub.business,
          store: sub.chain?.outlets?.[0],
          chain: sub.chain,
          settlementType: 'order_revenue',
          period: 'daily',
          from: new Date(Date.now() - 24 * 60 * 60 * 1000),
          to: new Date(),
        });
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