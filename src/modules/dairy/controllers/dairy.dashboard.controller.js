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

const catchAsync = require('../../../utils/catchAsync');
const dashboardService = require('../services/dairy.dashboard.service');

/**
 * The partner's home screen, in one response.
 *
 * Six panels behind one call, because this is the first thing an operator sees
 * and on rural mobile data six round trips before first paint is a visible wait.
 *
 * Each panel is gathered independently and reported as unavailable rather than
 * failing the request, so one broken query cannot cost the operator the whole
 * dashboard — see the note in `dairy.dashboard.service`.
 *
 * @returns {Object} dashboard
 */
const dashboard = catchAsync(async (req, res) => {
  const result = await dashboardService.getDashboard(req.outletId, req.query);
  res.send({ dashboard: result });
});

module.exports = {
  dashboard,
};