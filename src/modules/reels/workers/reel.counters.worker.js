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

// Thin entry kept for the module map — the real implementation lives in
// reels.cron.service.js so the scheduler and any manual trigger share it.
const cronService = require('./reels.cron.service');

const reconcileCounters = () => cronService.reconcileCounters();

module.exports = {
  reconcileCounters,
};
