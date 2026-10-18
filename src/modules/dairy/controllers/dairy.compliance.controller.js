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
const complianceService = require('../services/dairy.compliance.service');

// //// Read ////

/** The stored record, for a partner editing their paperwork. */
const complianceDetail = catchAsync(async (req, res) => {
  const compliance = await complianceService.getOrCreateCompliance(req.outletId);
  res.send({ compliance });
});

/** Live standing, recomputed from the dates rather than read from the cache. */
const complianceSummary = catchAsync(async (req, res) => {
  const summary = await complianceService.getSummary(req.outletId);
  res.send({ summary });
});

/**
 * Outlets whose licence has lapsed or expires soon.
 *
 * Platform-wide, so it is admin-only rather than scoped to one business.
 */
const complianceExpiring = catchAsync(async (req, res) => {
  const records = await complianceService.listExpiring(req.query);
  res.send({ records, totalResults: records.length });
});

// //// Write ////

const licenceSet = catchAsync(async (req, res) => {
  const compliance = await complianceService.setLicence(req.outletId, req.body);
  res.send({ compliance });
});

const hygieneCheckRecord = catchAsync(async (req, res) => {
  const compliance = await complianceService.recordHygieneCheck(req.outletId, {
    ...req.body,
    // The operator is whoever is signed in, not whatever the body claims.
    checkedBy: req.user._id,
  });
  res.send({ compliance });
});

const documentAdd = catchAsync(async (req, res) => {
  const compliance = await complianceService.addDocument(req.outletId, req.body);
  res.send({ compliance });
});

/**
 * Re-derives every cached status.
 *
 * Meant for a scheduled sweep. Also the manual escape hatch after a bulk licence
 * import, where the cache would otherwise be wrong until the next run.
 */
const complianceRefresh = catchAsync(async (req, res) => {
  const result = await complianceService.refreshAllStatuses();
  res.send(result);
});

module.exports = {
  complianceDetail,
  complianceSummary,
  complianceExpiring,
  licenceSet,
  hygieneCheckRecord,
  documentAdd,
  complianceRefresh,
};
