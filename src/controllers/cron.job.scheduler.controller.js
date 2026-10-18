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

const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { cronJobSchedulerService } = require('../services');

const startScheduler = catchAsync(async (req, res) => {
  cronJobSchedulerService.startCronJobScheduler.startCronJob();
  res.send({ success: true });
});

const stopScheduler = catchAsync(async (req, res) => {
  cronJobSchedulerService.stopAllCronJobsScheduler.stopCronJob();
  res.send({ success: true });
});

const getSchedulerInfo = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await cronJobSchedulerService.getSchedulerInfo(options);
  res.send(result);
});

module.exports = {
  startScheduler,
  stopScheduler,
  getSchedulerInfo,
};

