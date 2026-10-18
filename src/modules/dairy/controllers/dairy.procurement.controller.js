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
const pick = require('../../../utils/pick');
const procurementService = require('../services/dairy.procurement.service');
const { DairyMilkCollection } = require('../../../models');

// //// Providers ////

const providerCreate = catchAsync(async (req, res) => {
  const provider = await procurementService.createProvider({
    ...req.body,
    location: req.body.coordinates ? { type: 'Point', coordinates: req.body.coordinates } : undefined,
  });
  res.send({ provider });
});

const providerList = catchAsync(async (req, res) => {
    // Scoped to the caller's own outlet, with `:id` narrowing to one provider.
    // Passing a business id here used to be the only scope, which meant the
    // endpoint answered for whichever outlet the query named.
    const result = await procurementService.listProviders(req.outletId, {
      ...req.query,
      provider: req.params.id,
    });
    res.send(pick(result, ['providers', 'totalResults', 'page', 'limit']));
  });

const providerUpdate = catchAsync(async (req, res) => {
  const provider = await procurementService.updateProvider(req.params.provider, req.body);
  res.send({ provider });
});

// //// Rejection reasons ////

const rejectionReasonCreate = catchAsync(async (req, res) => {
  const reason = await procurementService.createRejectionReason({ ...req.body, business: req.outletId });
  res.send({ reason });
});

const rejectionReasonList = catchAsync(async (req, res) => {
  const reasons = await procurementService.listRejectionReasons(req.outletId);
  res.send({ reasons, totalResults: reasons.length });
});

// //// Collection and quality check ////

/**
 * Records an intake and grades it immediately. A hard QC failure is auto-rejected;
 * a borderline reading stays pending for an operator.
 */
const collectionCreate = catchAsync(async (req, res) => {
  // The operator is whoever is signed in. This route carries no `:id` segment, so
  // reading a path param here recorded `undefined` against every milk intake.
  const result = await procurementService.recordCollection({ ...req.body, recordedBy: req.user._id });
  res.send({
    collection: result.collection,
    verdict: result.verdict,
    autoRejected: result.collection.qualityStatus === 'rejected',
  });
});

const collectionList = catchAsync(async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
  const page = req.query.page ? parseInt(req.query.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { business: req.outletId };
  if (req.query.qualityStatus) query.qualityStatus = req.query.qualityStatus;
  if (req.query.provider) query.provider = req.query.provider;
  if (req.query.payableStatus) query.payableStatus = req.query.payableStatus;
  if (req.query.from || req.query.to) {
    query.collectedAt = {};
    if (req.query.from) query.collectedAt.$gte = new Date(req.query.from);
    if (req.query.to) query.collectedAt.$lte = new Date(req.query.to);
  }

  const [collections, totalResults] = await Promise.all([
    DairyMilkCollection.find(query)
      .populate('provider', 'name code milkType ratePerLitre')
      .populate('batch', 'batchNo expiry availableQtyL')
      .sort({ collectedAt: -1 })
      .skip(skip)
      .limit(limit),
    DairyMilkCollection.countDocuments(query),
  ]);

  res.send(pick({ collections, totalResults, page, limit }, ['collections', 'totalResults', 'page', 'limit']));
});

/** Accepts a collection and creates its batch. The only path into stock. */
const collectionAccept = catchAsync(async (req, res) => {
  const batch = await procurementService.acceptCollection(req.params.collection, {
    ...req.body,
    recordedBy: req.user._id,
  });
  res.send({ batch });
});

const collectionReject = catchAsync(async (req, res) => {
  const collection = await procurementService.rejectCollection(req.params.collection, {
    ...req.body,
    recordedBy: req.user._id,
  });
  res.send({ collection });
});

// //// Batches and FEFO ////

const batchList = catchAsync(async (req, res) => {
  const report = await procurementService.getBatchReport(req.outletId, req.query);
  res.send(report);
});

/**
 * FEFO preview. Returns which batches a quantity would draw from, oldest expiry
 * first, without committing anything.
 */
const fefoPreview = catchAsync(async (req, res) => {
  const allocations = await procurementService.allocateByFEFO(req.outletId, req.body.quantityL);
  res.send({
    quantityL: req.body.quantityL,
    covered: Number(allocations.reduce((s, a) => s + a.quantityL, 0).toFixed(2)),
    complete: allocations.reduce((s, a) => s + a.quantityL, 0) >= req.body.quantityL,
    allocations: allocations.map((a) => ({
      batchId: a.batch._id,
      batchNo: a.batch.batchNo,
      expiry: a.batch.expiry,
      availableQtyL: a.batch.availableQtyL,
      quantityL: a.quantityL,
    })),
  });
});

const shrinkageRecord = catchAsync(async (req, res) => {
  const batch = await procurementService.recordShrinkage(req.params.batch, req.body.quantityL, {
    ...req.body,
    recordedBy: req.user._id,
  });
  res.send({ batch });
});

const shrinkageReport = catchAsync(async (req, res) => {
  const report = await procurementService.getShrinkageReport(req.outletId, req.query);
  res.send({ report });
});

const providerPayable = catchAsync(async (req, res) => {
  const payables = await procurementService.getProviderPayable(req.outletId, req.query);
  res.send({ payables, totalResults: payables.length });
});

module.exports = {
  providerCreate,
  providerList,
  providerUpdate,
  rejectionReasonCreate,
  rejectionReasonList,
  collectionCreate,
  collectionList,
  collectionAccept,
  collectionReject,
  batchList,
  fefoPreview,
  shrinkageRecord,
  shrinkageReport,
  providerPayable,
};