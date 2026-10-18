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
const { DateTime } = require('luxon');
const {
  CronJobScheduler,
  BusinessSettings,
  UserPurchasedTiffinSubscription,
  Subscriber,
  Disbursement,
  DisbursementData,
  Driver,
  Restaurant,
  RestaurantDisbursement,
  DeliverymanDisbursement,
} = require('../models');
const config = require('../config/config');
const ordersService = require('./orders.service');
const fcmNotificationService = require('./fcm.notification.service');
const restaurantService = require('./restaurant.service');
const dairyManifestService = require('../modules/dairy/services/dairy.manifest.service');
const realEstateCronService = require('../modules/realestate/services/realestate.cron.service');
const reelsCronService = require('../modules/reels/workers/reels.cron.service');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const logger = require('../config/logger');

const scheduledTasks = []; // Array to store cron job references

const generateRestaurantDisbursement = async (disbursementId, minAmount) => {
  const minAmountOfDisbursement = parseFloat(minAmount);
  const validBalanceAccount = await Restaurant.aggregate([
    {
      $lookup: {
        from: 'wallets',
        localField: 'userId',
        foreignField: 'holderId',
        as: 'walletDetails',
      },
    },
    {
      $unwind: {
        path: '$walletDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        amount: {
          $divide: [{ $ifNull: ['$walletDetails.balance', 0] }, 100],
        },
      },
    },
    {
      $match: {
        'walletDetails.balance': { $gte: minAmountOfDisbursement },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: 1,
      },
    },
  ]);
  if (checkArrayNotEmpty(validBalanceAccount)) {
    const updatedData = validBalanceAccount.map((item) => ({
      ...item,
      disbursementId: `${disbursementId}`,
    }));
    const totalWalletBalance = validBalanceAccount.reduce((sum, item) => sum + item.amount, 0);
    const currentDisbursement = await DisbursementData.findById(disbursementId);
    if (currentDisbursement && currentDisbursement !== null && currentDisbursement.id) {
      const updateCurrentDisbursementParam = {
        totalAmount: totalWalletBalance,
      };
      Object.assign(currentDisbursement, updateCurrentDisbursementParam);
      await currentDisbursement.save();
    }
    if (updatedData !== null && checkArrayNotEmpty(updatedData)) {
      const bulkOps = updatedData.map((item) => ({
        insertOne: {
          document: {
            restaurant: item.id,
            disbursementId: item.disbursementId,
            restaurantPayoutMethod: null,
            withdrawalMethod: null,
            amount: item.amount,
            status: 'created',
          },
        },
      }));
      await RestaurantDisbursement.bulkWrite(bulkOps);
    }
  }
};

const generateDeliverymanDisbursement = async (disbursementId, minAmount) => {
  const minAmountOfDisbursement = parseFloat(minAmount);
  const validBalanceAccount = await Driver.aggregate([
    {
      $lookup: {
        from: 'wallets',
        localField: 'userId',
        foreignField: 'holderId',
        as: 'walletDetails',
      },
    },
    {
      $unwind: {
        path: '$walletDetails',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        amount: {
          $divide: [{ $ifNull: ['$walletDetails.balance', 0] }, 100],
        },
      },
    },
    {
      $match: {
        'walletDetails.balance': { $gte: minAmountOfDisbursement },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: 1,
        userId: 1,
      },
    },
  ]);
  if (checkArrayNotEmpty(validBalanceAccount)) {
    const updatedData = validBalanceAccount.map((item) => ({
      ...item,
      disbursementId: `${disbursementId}`,
    }));
    const totalWalletBalance = validBalanceAccount.reduce((sum, item) => sum + item.amount, 0);
    const currentDisbursement = await DisbursementData.findById(disbursementId);
    if (currentDisbursement && currentDisbursement !== null && currentDisbursement.id) {
      const updateCurrentDisbursementParam = {
        totalAmount: totalWalletBalance,
      };
      Object.assign(currentDisbursement, updateCurrentDisbursementParam);
      await currentDisbursement.save();
    }
    if (updatedData !== null && checkArrayNotEmpty(updatedData)) {
      const bulkOps = updatedData.map((item) => ({
        insertOne: {
          document: {
            userId: item.userId,
            disbursementId: item.disbursementId,
            deliverymanPayoutMethod: null,
            withdrawalMethod: null,
            amount: item.amount,
            status: 'created',
          },
        },
      }));
      await DeliverymanDisbursement.bulkWrite(bulkOps);
    }
  }
};

const generateDisbursement = async () => {
  const disbursement = await Disbursement.findOne({});
  if (disbursement) {
    if (
      disbursement &&
      disbursement.type !== null &&
      disbursement.type !== '' &&
      disbursement.type === 'auto'
    ) {
      let restaurantDisbursementFrom = 'daily';
      let restaurantDisbursementMinAmount = 1000;
      let restaurantDisbursementTime = '09:00 AM';

      let deliverymanDisbursementFrom = 'daily';
      let deliverymanDisbursementMinAmount = 1000;
      let deliverymanDisbursementTime = '09:00 AM';
      if (
        disbursement &&
        disbursement.restaurant &&
        disbursement.restaurant !== null &&
        disbursement.restaurant.from !== null &&
        disbursement.restaurant.from !== ''
      ) {
        restaurantDisbursementFrom = disbursement.restaurant.from;
      }
      if (
        disbursement &&
        disbursement.restaurant &&
        disbursement.restaurant !== null &&
        disbursement.restaurant.time !== null &&
        disbursement.restaurant.time !== ''
      ) {
        const time24 = disbursement.restaurant.time;
        restaurantDisbursementTime = DateTime.fromFormat(time24, 'HH:mm').toFormat('hh:mm a');
      }
      if (
        disbursement &&
        disbursement.restaurant &&
        disbursement.restaurant !== null &&
        disbursement.restaurant.minAmount !== null &&
        disbursement.restaurant.minAmount !== ''
      ) {
        restaurantDisbursementMinAmount = parseFloat(disbursement.restaurant.minAmount);
      }

      if (
        disbursement &&
        disbursement.driver &&
        disbursement.driver !== null &&
        disbursement.driver.from !== null &&
        disbursement.driver.from !== ''
      ) {
        deliverymanDisbursementFrom = disbursement.driver.from;
      }

      if (
        disbursement &&
        disbursement.driver &&
        disbursement.driver !== null &&
        disbursement.driver.time !== null &&
        disbursement.driver.time !== ''
      ) {
        const time24 = disbursement.driver.time;
        deliverymanDisbursementTime = DateTime.fromFormat(time24, 'HH:mm').toFormat('hh:mm a');
      }

      if (
        disbursement &&
        disbursement.driver &&
        disbursement.driver !== null &&
        disbursement.driver.minAmount !== null &&
        disbursement.driver.minAmount !== ''
      ) {
        deliverymanDisbursementMinAmount = disbursement.driver.minAmount;
      }

      const serverTimezone = await BusinessSettings.findOne({}, { timezone: 1 });
      let savedTimezone = '';
      if (
        serverTimezone !== null &&
        serverTimezone.timezone !== null &&
        checkArrayNotEmpty(serverTimezone.timezone.utc)
      ) {
        savedTimezone = serverTimezone.timezone.utc[0];
      } else {
        savedTimezone = config.timezone;
      }
      const now = DateTime.now().setZone(savedTimezone);
      const currentTime = now.toFormat('hh:mm a');
      if (restaurantDisbursementFrom === 'daily') {
        const currentTimeParsed = DateTime.fromFormat(currentTime, 'hh:mm a');
        const disbursementTimeParsed = DateTime.fromFormat(restaurantDisbursementTime, 'hh:mm a');

        if (currentTimeParsed >= disbursementTimeParsed) {
          const currentDay = now.toFormat('yyyy-MM-dd');
          const disbursementCronJobDateExist = await DisbursementData.findOne({
            cronJobDate: currentDay,
            disbursementType: 'restaurant',
          });
          if (!disbursementCronJobDateExist) {
            const disbursementCount = await DisbursementData.countDocuments();
            const disbursementNumber = 100000 + parseInt(disbursementCount, 10) + 1;
            const disbursementData = new DisbursementData({
              disbursementNo: disbursementNumber,
              generatedTime: currentTime,
              totalAmount: 0,
              cronJobDate: currentDay,
              disbursementType: 'restaurant',
            });
            const disbursementResult = await DisbursementData.create(disbursementData);
            if (
              disbursementResult &&
              disbursementResult !== null &&
              disbursementResult.id !== null &&
              disbursementResult.id !== ''
            ) {
              generateRestaurantDisbursement(
                disbursementResult.id,
                restaurantDisbursementMinAmount
              );
            }
          }
        }
      }
      if (restaurantDisbursementFrom === 'weekly') {
        let weekStart = 1;
        if (
          disbursement &&
          disbursement.restaurant &&
          disbursement.restaurant !== null &&
          disbursement.restaurant.weekStart !== null &&
          disbursement.restaurant.weekStart !== ''
        ) {
          weekStart = parseInt(disbursement.restaurant.weekStart, 10);
        }
        const now = DateTime.now().setZone(savedTimezone);
        const currentDayNumber = now.weekday;
        if (currentDayNumber === weekStart) {
          const currentTimeParsed = DateTime.fromFormat(currentTime, 'hh:mm a');
          const disbursementTimeParsed = DateTime.fromFormat(restaurantDisbursementTime, 'hh:mm a');
          if (currentTimeParsed >= disbursementTimeParsed) {
            const currentDay = now.toFormat('yyyy-MM-dd');
            const disbursementCronJobDateExist = await DisbursementData.findOne({
              cronJobDate: currentDay,
              disbursementType: 'restaurant',
            });
            if (!disbursementCronJobDateExist) {
              const disbursementCount = await DisbursementData.countDocuments();
              const disbursementNumber = 100000 + parseInt(disbursementCount, 10) + 1;
              const disbursementData = new DisbursementData({
                disbursementNo: disbursementNumber,
                generatedTime: currentTime,
                totalAmount: 0,
                cronJobDate: currentDay,
                disbursementType: 'restaurant',
              });
              const disbursementResult = await DisbursementData.create(disbursementData);
              if (
                disbursementResult &&
                disbursementResult !== null &&
                disbursementResult.id !== null &&
                disbursementResult.id !== ''
              ) {
                generateRestaurantDisbursement(
                  disbursementResult.id,
                  restaurantDisbursementMinAmount
                );
              }
            }
          }
        }
      }
      if (restaurantDisbursementFrom === 'monthly') {
        const now = DateTime.now().setZone(savedTimezone);
        const currentMonthDay = now.endOf('month').toFormat('yyyy-MM-dd');
        const currentDay = now.toFormat('yyyy-MM-dd');
        if (currentDay === currentMonthDay) {
          const currentTimeParsed = DateTime.fromFormat(currentTime, 'hh:mm a');
          const disbursementTimeParsed = DateTime.fromFormat(restaurantDisbursementTime, 'hh:mm a');
          if (currentTimeParsed >= disbursementTimeParsed) {
            const disbursementCronJobDateExist = await DisbursementData.findOne({
              cronJobDate: currentDay,
              disbursementType: 'restaurant',
            });
            if (!disbursementCronJobDateExist) {
              const disbursementCount = await DisbursementData.countDocuments();
              const disbursementNumber = 100000 + parseInt(disbursementCount, 10) + 1;
              const disbursementData = new DisbursementData({
                disbursementNo: disbursementNumber,
                generatedTime: currentTime,
                totalAmount: 0,
                cronJobDate: currentDay,
                disbursementType: 'restaurant',
              });
              const disbursementResult = await DisbursementData.create(disbursementData);
              if (
                disbursementResult &&
                disbursementResult !== null &&
                disbursementResult.id !== null &&
                disbursementResult.id !== ''
              ) {
                generateRestaurantDisbursement(
                  disbursementResult.id,
                  restaurantDisbursementMinAmount
                );
              }
            }
          }
        }
      }

      if (deliverymanDisbursementFrom === 'daily') {
        const currentTimeParsed = DateTime.fromFormat(currentTime, 'hh:mm a');
        const disbursementTimeParsed = DateTime.fromFormat(deliverymanDisbursementTime, 'hh:mm a');
        if (currentTimeParsed >= disbursementTimeParsed) {
          const currentDay = DateTime.now().setZone(savedTimezone).toFormat('yyyy-MM-dd');
          const disbursementCronJobDateExist = await DisbursementData.findOne({
            cronJobDate: currentDay,
            disbursementType: 'deliveryman',
          });
          if (!disbursementCronJobDateExist) {
            const disbursementCount = await DisbursementData.countDocuments();
            const disbursementNumber = 100000 + parseInt(disbursementCount, 10) + 1;
            const disbursementData = new DisbursementData({
              disbursementNo: disbursementNumber,
              generatedTime: currentTime,
              totalAmount: 0,
              cronJobDate: currentDay,
              disbursementType: 'deliveryman',
            });
            const disbursementResult = await DisbursementData.create(disbursementData);
            if (
              disbursementResult &&
              disbursementResult !== null &&
              disbursementResult.id !== null &&
              disbursementResult.id !== ''
            ) {
              generateDeliverymanDisbursement(
                disbursementResult.id,
                deliverymanDisbursementMinAmount
              );
            }
          }
        }
      }
      if (deliverymanDisbursementFrom === 'weekly') {
        let weekStart = 1;
        if (
          disbursement &&
          disbursement.driver &&
          disbursement.driver !== null &&
          disbursement.driver.weekStart !== null &&
          disbursement.driver.weekStart !== ''
        ) {
          weekStart = parseInt(disbursement.driver.weekStart, 10);
        }
        const now = DateTime.now().setZone(savedTimezone);
        const currentDayNumber = now.weekday;
        if (currentDayNumber === weekStart) {
          const currentTimeParsed = DateTime.fromFormat(currentTime, 'hh:mm a');
          const disbursementTimeParsed = DateTime.fromFormat(
            deliverymanDisbursementTime,
            'hh:mm a'
          );
          if (currentTimeParsed >= disbursementTimeParsed) {
            const currentDay = now.toFormat('yyyy-MM-dd');
            const disbursementCronJobDateExist = await DisbursementData.findOne({
              cronJobDate: currentDay,
              disbursementType: 'deliveryman',
            });
            if (!disbursementCronJobDateExist) {
              const disbursementCount = await DisbursementData.countDocuments();
              const disbursementNumber = 100000 + parseInt(disbursementCount, 10) + 1;
              const disbursementData = new DisbursementData({
                disbursementNo: disbursementNumber,
                generatedTime: currentTime,
                totalAmount: 0,
                cronJobDate: currentDay,
                disbursementType: 'deliveryman',
              });
              const disbursementResult = await DisbursementData.create(disbursementData);
              if (
                disbursementResult &&
                disbursementResult !== null &&
                disbursementResult.id !== null &&
                disbursementResult.id !== ''
              ) {
                generateDeliverymanDisbursement(
                  disbursementResult.id,
                  deliverymanDisbursementMinAmount
                );
              }
            }
          }
        }
      }
      if (deliverymanDisbursementFrom === 'monthly') {
        const now = DateTime.now().setZone(savedTimezone);

        const currentMonthDay = now.endOf('month').toFormat('yyyy-MM-dd');
        const currentDay = now.toFormat('yyyy-MM-dd');
        if (currentDay === currentMonthDay) {
          const currentTimeParsed = DateTime.fromFormat(currentTime, 'hh:mm a');
          const disbursementTimeParsed = DateTime.fromFormat(
            deliverymanDisbursementTime,
            'hh:mm a'
          );

          if (currentTimeParsed >= disbursementTimeParsed) {
            const disbursementCronJobDateExist = await DisbursementData.findOne({
              cronJobDate: currentDay,
              disbursementType: 'deliveryman',
            });
            if (!disbursementCronJobDateExist) {
              const disbursementCount = await DisbursementData.countDocuments();
              const disbursementNumber = 100000 + parseInt(disbursementCount, 10) + 1;
              const disbursementData = new DisbursementData({
                disbursementNo: disbursementNumber,
                generatedTime: currentTime,
                totalAmount: 0,
                cronJobDate: currentDay,
                disbursementType: 'deliveryman',
              });
              const disbursementResult = await DisbursementData.create(disbursementData);
              if (
                disbursementResult &&
                disbursementResult !== null &&
                disbursementResult.id !== null &&
                disbursementResult.id !== ''
              ) {
                generateDeliverymanDisbursement(
                  disbursementResult.id,
                  deliverymanDisbursementMinAmount
                );
              }
            }
          }
        }
      }
    }
  }
};

const startCronJobScheduler = {
  async startCronJob() {
    /// ////// Live Code //////////
    await CronJobScheduler.deleteMany({});
    const cronLog = new CronJobScheduler({
      jobName: 'HourlyTask',
      startTime: new Date(),
      status: 'success', // Assume success initially
    });
    cronLog.endTime = new Date();
    cronLog.status = 'success'; // Task completed successfully
    await cronLog.save();
    scheduledTasks.forEach((job) => {
      job.stop(); // Stop the cron job
    });
    scheduledTasks.length = 0; // Clear the array
    // Schedule the cron job to run every hour
    // cron.schedule('0 * * * *', async () => {
    // Hour 0 * * * *
    // Minute == * * * * *
    const job = cron.schedule('0 * * * *', async () => {
      await this.performScheduledTask();
    });
scheduledTasks.push(job); // Store the reference to the scheduled job

    // Dairy manifest job.
    //
    // Runs at 03:00 rather than hourly because milk is delivered in a hard
    // morning window: routes must be built the night before so riders can see
    // their manifest before they set out. The generator is idempotent — it keys
    // on (subscription, occurrenceDate) — so a retry after a partial failure
    // cannot duplicate deliveries.
    const dairyJob = cron.schedule(
      process.env.CRON_DAIRY_MANIFEST || '0 3 * * *',
      async () => {
        await dairyManifestService.runManifestJob();
      }
    );
    scheduledTasks.push(dairyJob);

    // Real Estate jobs. Same pattern as dairy: logic lives in the
    // module's cron service, the scheduler only holds cadence.
    // Every job is idempotent (status-keyed), so a retry after a
    // partial failure cannot duplicate an expiry, refund or stat row.
    const reExpiryJob = cron.schedule(
      process.env.CRON_REALESTATE_EXPIRY || '0 1 * * *',
      async () => {
        await realEstateCronService.expireListings();
      }
    );
    scheduledTasks.push(reExpiryJob);
    const reHoldExpiryJob = cron.schedule(
      process.env.CRON_REALESTATE_HOLD_EXPIRY || '30 * * * *',
      async () => {
        await realEstateCronService.expireHolds();
      }
    );
    scheduledTasks.push(reHoldExpiryJob);
    const reRemindersJob = cron.schedule(
      process.env.CRON_REALESTATE_REMINDERS || '0 */2 * * *',
      async () => {
        await realEstateCronService.sendReminders();
      }
    );
    scheduledTasks.push(reRemindersJob);
    const reAssignmentJob = cron.schedule(
      process.env.CRON_REALESTATE_ASSIGNMENT || '*/10 * * * *',
      async () => {
        await realEstateCronService.sweepAssignments();
      }
    );
    scheduledTasks.push(reAssignmentJob);
    const reComplianceJob = cron.schedule(
      process.env.CRON_REALESTATE_COMPLIANCE || '0 2 * * 0',
      async () => {
        await realEstateCronService.complianceRollup();
      }
    );
    scheduledTasks.push(reComplianceJob);

    // Reels jobs. Same pattern: logic lives in the module's cron service,
    // the scheduler only holds cadence. Every job is idempotent (status-keyed),
    // so a retry after a partial failure cannot double-publish or double-count.
    const reelsPublishJob = cron.schedule(
      process.env.CRON_REELS_PUBLISH || '*/5 * * * *',
      async () => {
        await reelsCronService.publishDueReels();
      }
    );
    scheduledTasks.push(reelsPublishJob);
    const reelsProcessingJob = cron.schedule(
      process.env.CRON_REELS_PROCESSING || '*/10 * * * *',
      async () => {
        await reelsCronService.sweepProcessing();
      }
    );
    scheduledTasks.push(reelsProcessingJob);
    const reelsCountersJob = cron.schedule(
      process.env.CRON_REELS_COUNTERS || '0 4 * * *',
      async () => {
        await reelsCronService.reconcileCounters();
      }
    );
    scheduledTasks.push(reelsCountersJob);

    // Payments: reconcile stuck Razorpay `initiated` intents (CustomUI/Standard).
    // Idempotent — only marks rows whose order has a captured payment at Razorpay.
    // Webhook is the fast path; this sweep covers app-kill / missed-callback.
    const paymentsReconcileJob = cron.schedule(
      process.env.CRON_PAYMENTS_RECONCILE || '*/15 * * * *',
      async () => {
        try {
          const { reconcileStuckRazorpayPayments } = require('../controllers/payment.initiation.controller');
          const olderThanMin = parseInt(process.env.PAYMENTS_RECONCILE_MIN || '30', 10);
          const result = await reconcileStuckRazorpayPayments(olderThanMin, 50);
          logger.info(`payments reconcile: ${JSON.stringify(result)}`);
        } catch (e) {
          logger.error(`payments reconcile failed: ${e && e.message}`);
        }
      }
    );
    scheduledTasks.push(paymentsReconcileJob);

    // Payments: pre-expiry reminder for pending-payment orders (~5 min left).
    // Window-matched (each order reminded once), fire-and-forget per order.
    const paymentsReminderJob = cron.schedule(
      process.env.CRON_PAYMENTS_REMINDER || '*/5 * * * *',
      async () => {
        try {
          const { remindPendingPayments } = require('../controllers/payment.initiation.controller');
          const windowMin = parseInt(process.env.PAYMENTS_WINDOW_MIN || '30', 10);
          const result = await remindPendingPayments(windowMin, windowMin - 5, 100);
          logger.info(`payments reminder: ${JSON.stringify(result)}`);
        } catch (e) {
          logger.error(`payments reminder failed: ${e && e.message}`);
        }
      }
    );
    scheduledTasks.push(paymentsReminderJob);
    /// ////// Live Code //////////
  },

  async performScheduledTask() {
    const cronLog = new CronJobScheduler({
      jobName: 'HourlyTask',
      startTime: new Date(),
      status: 'success', // Assume success initially
    });
    try {
      logger.info(`CRON JOB`);
      cronLog.endTime = new Date();
      cronLog.status = 'success'; // Task completed successfully
      const serverTimezone = await BusinessSettings.findOne({}, { timezone: 1 });
      let savedTimezone = '';
      if (
        serverTimezone !== null &&
        serverTimezone.timezone !== null &&
        checkArrayNotEmpty(serverTimezone.timezone.utc)
      ) {
        savedTimezone = serverTimezone.timezone.utc[0];
      } else {
        savedTimezone = config.timezone;
      }
      const now = DateTime.now().setZone(savedTimezone);

      const currentDate = now.toJSDate(); // JS Date
      const currentDay = now.toFormat('cccc').toLowerCase(); // day name
      const currentTime = now.toFormat('HH:mm'); // 24h time
      logger.info(`savedTimezone --> ${savedTimezone}`);
      logger.info(`currentDate --> ${currentDate}`);
      logger.info(`currentDay --> ${currentDay}`);
      logger.info(`currentTime --> ${currentTime}`);

      const tomorrowStart = now.plus({ days: 1 }).startOf('day').toJSDate();
      const todayStart = now.startOf('day').toJSDate();
      const subscriptions = await UserPurchasedTiffinSubscription.aggregate([
        {
          $match: {
            status: 'created',
            $expr: {
              $and: [
                {
                  $lte: [
                    {
                      $dateFromParts: {
                        year: { $year: '$startDate' },
                        month: { $month: '$startDate' },
                        day: { $dayOfMonth: '$startDate' },
                      },
                    },
                    currentDate,
                  ],
                },
              ],
            },
            offDays: { $ne: currentDay },
            requestedOffDates: {
              $not: {
                $elemMatch: {
                  $eq: tomorrowStart,
                },
              },
            },
            orderAt: { $gte: currentTime }, // Ensure correct time format
            ordersDates: {
              $not: todayStart,
            },
          },
        },
        {
          $addFields: {
            orderCount: { $size: '$ordersDates' },
          },
        },
        {
          $match: {
            $expr: { $lt: ['$orderCount', '$totalOrder'] },
          },
        },
      ]);
      const expiredPackages = await Subscriber.aggregate([
        {
          $match: {
            $or: [{ trialEndDate: { $lt: currentDate } }, { endDate: { $lt: currentDate } }],
            cronJobDates: {
              $not: { $elemMatch: { $eq: todayStart } },
            },
          },
        },
        {
          $project: {
            _id: 0,
            id: '$_id',
            restaurant: 1,
          },
        },
      ]);
      if (checkArrayNotEmpty(expiredPackages)) {
        const restaurantIds = [];
        expiredPackages.forEach((element) => {
          restaurantIds.push(element.restaurant);
        });
        await restaurantService.blockExpiredSubscriptionRestaurants(restaurantIds);
      }
      const currentDateRange = new Date();
      currentDateRange.setHours(0, 0, 0, 0);
      const nextThreeDays = new Date();
      nextThreeDays.setDate(nextThreeDays.getDate() + 3); // For Next Three Days
      nextThreeDays.setHours(23, 59, 59, 999);
      const expiringSoon = await Subscriber.aggregate([
        {
          $match: {
            $or: [
              {
                trialEndDate: {
                  $gte: currentDateRange,
                  $lte: nextThreeDays,
                },
              },
              {
                endDate: {
                  $gte: currentDateRange,
                  $lte: nextThreeDays,
                },
              },
            ],
            cronJobDates: {
              $not: { $elemMatch: { $eq: todayStart } },
            },
          },
        },
        {
          $project: {
            _id: 0,
            id: '$_id',
            restaurant: 1,
          },
        },
      ]);
      if (checkArrayNotEmpty(expiringSoon)) {
        const restaurantIds = [];
        expiringSoon.forEach((element) => {
          restaurantIds.push(element.restaurant);
        });
        await restaurantService.getExpiringSoonRestaurants(restaurantIds);
      }
      logger.info(`-----------******----------`);
      logger.info(`${subscriptions.length}`);
      logger.info(`-----------******----------`);
      const updatePromises = subscriptions.map(async (element) => {
        /// //// Make Live ////////

        function convertTo12Hour(time24) {
          const [hours, minutes] = time24.split(':');
          const period = +hours >= 12 ? 'PM' : 'AM';
          const hours12 = +hours % 12 || 12;
          return `${hours12}:${minutes} ${period}`;
        }
        const orderTime = convertTo12Hour(element.orderAt);
        function convertPrice(price) {
          return Number((price / 100).toFixed(2));
        }
        await UserPurchasedTiffinSubscription.updateOne(
          { _id: element._id },
          { $push: { ordersDates: todayStart } }
        );
        const totalPlacedOrder = await UserPurchasedTiffinSubscription.findOne(
          { _id: element._id },
          { ordersDates: 1, totalOrder: 1 }
        );
        if (totalPlacedOrder !== null && totalPlacedOrder.ordersDates) {
          if (totalPlacedOrder.ordersDates.length === totalPlacedOrder.totalOrder) {
            await UserPurchasedTiffinSubscription.updateOne(
              { _id: element._id },
              { status: 'completed' }
            );
          }
        }
        logger.info(`paraparapparaparapararpararp --${element._id} ------ ${element.user}`);
        const orderParam = {
          user: element.user,
          payment: element.payment,
          restaurant: element.restaurant,
          addons: element.addons,
          foods: element.foods,
          orderTo: element.orderTo,
          cookingInstruction: element.cookingInstruction,
          deliveryInstruction: element.deliveryInstruction,
          deliveryAddress: element.orderTo === 'homedelivery' ? element.deliveryAddress : '',
          deliveryAddressRaw: element.orderTo === 'homedelivery' ? element.deliveryAddressRaw : '',
          receiverName: element.receiverName,
          countryCode: element.countryCode,
          receiverContact: element.receiverContact,
          cartItemRaw: element.cartItemRaw,
          orderAt: DateTime.now().setZone(savedTimezone).toFormat('hh:mm a'),
          scheduleTime: orderTime,
          itemTotal: convertPrice(element.itemTotal),
          foodServiceCharge: convertPrice(element.foodServiceCharge),
          serviceCharge: convertPrice(element.serviceCharge),
          packageCharge: convertPrice(element.packageCharge),
          packageChargeTax: convertPrice(element.packageChargeTax),
          extraCharge: convertPrice(element.extraCharge),
          grandTotal: convertPrice(element.grandTotal),
          subscriptionOrder: true,
          purchasedTiffinSubscription: element._id,
          tiffinSubscription: element.subscriptionPackage,
          status: 'created',
          orderFrom: 'subscription',
          instantOrder: false,
          scheduleOrder: true,
          scheduleDate: currentDate,
          restaurantCampaign: null,
          foodCampaign: null,
        };
        const orderResponse = await ordersService.createOrder(orderParam);
        if (orderResponse !== null && orderResponse.id !== null) {
          await fcmNotificationService.restaurantNewOrder(
            orderResponse.id,
            element.restaurant,
            element.user
          );
        }
        /// //// Make Live ////////
      });
      const updateExpiredPackagesPromises = expiredPackages.map(async (element) => {
        await Subscriber.updateOne(
          { _id: element.id },
          { $addToSet: { cronJobDates: todayStart } }
        );
      });
      const updateExpiringPackagesPromises = expiringSoon.map(async (element) => {
        await Subscriber.updateOne(
          { _id: element.id },
          { $addToSet: { cronJobDates: todayStart } }
        );
      });
      // Disbursement //
      await generateDisbursement();
      // Disbursement //
      await Promise.all([
        ...updatePromises,
        ...updateExpiredPackagesPromises,
        ...updateExpiringPackagesPromises,
      ]);
    } catch (error) {
      cronLog.endTime = new Date();
      cronLog.status = 'failure';
      cronLog.errorMessage = error.message;
    } finally {
      if (cronLog.status === 'failure') {
        try {
          // Delete all documents in the collection if the task failed
          await CronJobScheduler.deleteMany({});
          scheduledTasks.forEach((job) => {
            job.stop(); // Stop the cron job
          });
          scheduledTasks.length = 0; // Clear the array
          await startCronJobScheduler.startCronJob();
        } catch (deleteError) {
          logger.info('Error deleting documents:');
          logger.info(deleteError);
        }
      } else {
        await cronLog.save();
      }
    }
  },
};

const stopAllCronJobsScheduler = {
  stopCronJob() {
    scheduledTasks.forEach((job) => {
      job.stop(); // Stop the cron job
    });
    scheduledTasks.length = 0; // Clear the array
    this.deleteCollection();
  },

  async deleteCollection() {
    try {
      // Delete all documents in the collection if the task failed
      await CronJobScheduler.deleteMany({});
      // eslint-disable-next-line no-unused-vars
    } catch (deleteError) {
      logger.info('Error deleting documents:');
    }
  },
};

const getSchedulerInfo = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const query = [
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        startTime: 1,
        endTime: 1,
        status: 1,
      },
    },
  ];
  const results = await CronJobScheduler.aggregate(query);
  const totalResults = await CronJobScheduler.countDocuments();
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
      isRunning: scheduledTasks.length > 0,
    };
    return Promise.resolve(result);
  });
};

module.exports = {
  generateRestaurantDisbursement,
  generateDeliverymanDisbursement,
  startCronJobScheduler,
  stopAllCronJobsScheduler,
  getSchedulerInfo,
  generateDisbursement,
};

