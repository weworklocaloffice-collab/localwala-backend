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

const { status: httpStatus } = require('http-status');
const {
  Business,
  DairyMilkProvider,
  DairyMilkCollection,
  DairyMilkBatch,
  DairyMilkRejectionReason,
  DairyBatchLedger,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');

/**
 * Procurement and quality control.
 *
 *   Milk Provider → Collection → Quality Check → Accept / Reject
 *                 → Milk Batch → FEFO allocation → Customer
 *
 * Two rules carry the whole slice:
 *
 *   1. **Only accepted milk becomes stock.** A rejected collection never produces
 *      a batch, which is what keeps batch quantities trustworthy.
 *   2. **FEFO, always.** Raw milk is perishable, so allocation takes the earliest
 *      expiry first regardless of which batch "belongs" to an order. Taking the
 *      newest batch instead leaves yesterday's milk to sour.
 */

const nextNumber = async (Model, field) => {
  const latest = await Model.findOne().sort({ [field]: -1 }).select(field);
  return latest && latest[field] ? latest[field] + 1 : 1;
};

const getQualityConfig = async (businessId) => {
  const business = await Business.findById(businessId).select('qualityConfig');
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  }
  return business.qualityConfig || {};
};

// //// Providers ////

const createProvider = async (param) => {
  const existing = await DairyMilkProvider.findOne({
    business: param.business,
    $or: [{ code: param.code }, { mobile: param.mobile }],
  });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Provider code or mobile already exists');
  }
  return DairyMilkProvider.create(param);
};

const listProviders = async (businessId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { business: businessId };
  if (options.status !== undefined) {
    query.status = options.status === 'true' || options.status === true;
  }
  if (options.search) {
    query.$or = [
      { name: { $regex: options.search, $options: 'i' } },
      { code: { $regex: options.search, $options: 'i' } },
    ];
  }

  const [providers, totalResults] = await Promise.all([
    DairyMilkProvider.find(query).sort({ name: 1 }).skip(skip).limit(limit),
    DairyMilkProvider.countDocuments(query),
  ]);

  return { providers, totalResults, page, limit };
};

const updateProvider = async (providerId, param) => {
  const provider = await DairyMilkProvider.findById(providerId);
  if (!provider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(provider, param);
  await provider.save();
  return provider;
};

// //// Rejection reasons ////

const createRejectionReason = async (param) => {
  return DairyMilkRejectionReason.create(param);
};

const listRejectionReasons = async (businessId) => {
  return DairyMilkRejectionReason.find({ business: businessId, status: true }).sort({ sortOrder: 1, name: 1 });
};

/**
 * Finds or creates the system reason for a failed check, so automatic rejections
 * carry a real reason reference rather than leaving the field empty.
 */
const ensureSystemReason = async (businessId, code, name) => {
  const existing = await DairyMilkRejectionReason.findOne({ business: businessId, code });
  if (existing) return existing;
  return DairyMilkRejectionReason.create({ business: businessId, code, name, system: true });
};

// //// Collection and quality check ////

/**
 * Evaluates fat, SNF and temperature against the outlet's thresholds.
 *
 * Returns a verdict rather than applying it, so an operator can override a
 * borderline judgement — but a hard reject is reported as such so the override is
 * a deliberate act.
 *
 * @param {Object} quality  business qualityConfig
 * @param {Object} reading  { fat, snf, temperature }
 */
const evaluateQuality = (quality, reading) => {
  const failures = [];
  const warnings = [];

  const minSnf = quality.minSnfPercentage ?? 8.5;
  const minFat = quality.minFatPercentage ?? 3.5;
  const maxSnf = quality.maxSnfPercentage ?? 10;
  const maxFat = quality.maxFatPercentage ?? 7;
  const rejectBelowSnf = quality.rejectBelowSnf ?? 8;
  const rejectBelowFat = quality.rejectBelowFat ?? 3;
  const maxTemp = quality.maxIntakeTemperature ?? 27;

  if (reading.snf < rejectBelowSnf) {
    failures.push({ code: 'low_snf', message: `SNF ${reading.snf}% is below the reject floor of ${rejectBelowSnf}%` });
  } else if (reading.snf < minSnf) {
    warnings.push({ code: 'low_snf', message: `SNF ${reading.snf}% is below the ${minSnf}% acceptance target` });
  }

  if (reading.fat < rejectBelowFat) {
    failures.push({ code: 'low_fat', message: `Fat ${reading.fat}% is below the reject floor of ${rejectBelowFat}%` });
  } else if (reading.fat < minFat) {
    warnings.push({ code: 'low_fat', message: `Fat ${reading.fat}% is below the ${minFat}% acceptance target` });
  }

  if (reading.fat > maxFat) {
    warnings.push({ code: 'high_fat', message: `Fat ${reading.fat}% is above the ${maxFat}% expected maximum` });
  }
  if (reading.snf > maxSnf) {
    warnings.push({ code: 'high_snf', message: `SNF ${reading.snf}% is above the ${maxSnf}% expected maximum` });
  }
  if (reading.temperature !== undefined && reading.temperature !== null && reading.temperature > maxTemp) {
    failures.push({
      code: 'high_temperature',
      message: `Intake ${reading.temperature}°C exceeds the ${maxTemp}°C limit`,
    });
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
  };
};

/**
 * Records a collection event and runs it through QC immediately.
 *
 * QC runs at intake rather than as a separate step because a collection that
 * auto-rejects should not sit in a pending queue pretending to be usable. A
 * borderline result stays `pending` for an operator.
 *
 * @param {Object} param
 */
const recordCollection = async (param) => {
  const provider = await DairyMilkProvider.findById(param.provider);
  if (!provider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Provider not found');
  }
  if (provider.status !== true) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This provider is not active');
  }
  if (!param.quantityL || param.quantityL <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Quantity must be greater than zero');
  }
  if (param.fat === undefined || param.snf === undefined) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Fat and SNF readings are required');
  }

  const quality = await getQualityConfig(provider.business);
  const verdict = evaluateQuality(quality, param);

  const collectionNo = await nextNumber(DairyMilkCollection, 'collectionNo');
  const rate = param.ratePerLitre !== undefined ? param.ratePerLitre : provider.ratePerLitre;

  const collection = await DairyMilkCollection.create({
    collectionNo,
    business: provider.business,
    provider: provider._id,
    quantityL: param.quantityL,
    fat: param.fat,
    snf: param.snf,
    fatSnfPercentage: Number((param.fat + param.snf).toFixed(2)),
    temperature: param.temperature,
    ratePerLitre: rate,
    amount: Number((rate * param.quantityL).toFixed(2)),
    collectedAt: param.collectedAt || new Date(),
    recordedBy: param.recordedBy,
    deviceId: param.deviceId,
    qualityStatus: 'pending',
    qualityNotes:
      verdict.warnings.length > 0
        ? verdict.warnings.map((w) => w.message).join('; ')
        : undefined,
  });

  // Provider totals track everything that arrived, accepted or not.
  provider.stats.totalCollectedLitres += param.quantityL;
  await provider.save();

  // A hard failure is auto-rejected. Anything ambiguous goes to the operator.
  if (!verdict.passed) {
    await rejectCollection(collection._id, {
      reasonCode: verdict.failures[0].code,
      reasonName: verdict.failures.map((f) => f.message).join('; '),
      automatic: true,
      recordedBy: param.recordedBy,
    });
  } else if (verdict.warnings.length > 0) {
    // Left pending deliberately so a human confirms a marginal lot.
    collection.qualityNotes = verdict.warnings.map((w) => w.message).join('; ');
    await collection.save();
  }

  return { collection: await DairyMilkCollection.findById(collection._id), verdict };
};

/**
 * Accepts a collection and turns it into a batch.
 *
 * This is the only path by which raw milk enters stock.
 *
 * @param {Object} param
 */
const acceptCollection = async (collectionId, param) => {
  const collection = await DairyMilkCollection.findById(collectionId);
  if (!collection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (collection.qualityStatus === 'accepted') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Collection already accepted');
  }
  if (collection.qualityStatus === 'rejected') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A rejected collection cannot be accepted');
  }

  const quality = await getQualityConfig(collection.business);
  const collectedAt = collection.collectedAt || new Date();
  const shelfLifeHours = quality.shelfLifeHours ?? 12;
  const expiry = new Date(collectedAt.getTime() + shelfLifeHours * 60 * 60 * 1000);

  const batchNo = await nextNumber(DairyMilkBatch, 'batchNo');
  const batch = await DairyMilkBatch.create({
    batchNo,
    business: collection.business,
    provider: collection.provider,
    sourceCollection: collection._id,
    quantityL: collection.quantityL,
    availableQtyL: collection.quantityL,
    consumedQtyL: 0,
    shrinkageL: 0,
    fat: collection.fat,
    snf: collection.snf,
    collectedAt,
    expiry,
    storageTank: param.storageTank,
    status: 'source',
  });

  collection.qualityStatus = 'accepted';
  collection.batch = batch._id;
  if (param.note) {
    collection.qualityNotes = param.note;
  }
  await collection.save();

  await DairyBatchLedger.create({
    batch: batch._id,
    business: collection.business,
    eventType: 'created',
    quantityL: collection.quantityL,
    note: `Accepted from collection #${collection.collectionNo}`,
    createdBy: param.recordedBy,
  });

  const provider = await DairyMilkProvider.findById(collection.provider);
  if (provider) {
    provider.stats.totalAcceptedLitres += collection.quantityL;
    provider.stats.totalPayable += collection.amount;
    await provider.save();
  }

  return batch;
};

/**
 * Rejects a collection. Rejected milk never becomes a batch and is never payable.
 */
const rejectCollection = async (collectionId, param) => {
  const collection = await DairyMilkCollection.findById(collectionId);
  if (!collection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (collection.qualityStatus === 'accepted') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Accepted milk cannot be rejected — reverse the batch first');
  }

  let reasonRef;
  if (param.reason) {
    reasonRef = param.reason;
  } else if (param.reasonCode) {
    const reason = await ensureSystemReason(
      collection.business,
      param.reasonCode,
      param.reasonName || param.reasonCode
    );
    reasonRef = reason._id;
  }

  collection.qualityStatus = 'rejected';
  collection.rejectionReason = reasonRef;
  collection.rejectedAt = new Date();
  if (param.note || param.reasonName) {
    collection.qualityNotes = param.note || param.reasonName;
  }
  await collection.save();

  const provider = await DairyMilkProvider.findById(collection.provider);
  if (provider) {
    provider.stats.totalRejectedLitres += collection.quantityL;
    await provider.save();
  }

  return collection;
};

// //// Batches and FEFO ////

/**
 * FEFO allocation — **First Expiry, First Out**.
 *
 * Walks batches in expiry order and takes the earliest usable one, splitting
 * across batches when the first cannot cover the whole quantity. Raw milk is
 * perishable, so taking the newest batch and leaving yesterday's to sour is the
 * failure this prevents.
 *
 * Expired batches are skipped and marked `expired` rather than silently ignored,
 * so a stock report never claims usable litres that are not there.
 *
 * @param {string} businessId
 * @param {number} quantityL
 * @param {Object} [param]  optional, for ledger authorship
 * @returns {Promise<Array<{batch: Object, quantityL: number}>>}
 */
const allocateByFEFO = async (businessId, quantityL, param) => {
  const now = new Date();
  let remaining = Number((quantityL || 0).toFixed(2));
  if (remaining <= 0) return [];

  // The whole point: sorted by expiry ascending.
  const batches = await DairyMilkBatch.find({
    business: businessId,
    status: { $in: ['source', 'blended'] },
    availableQtyL: { $gt: 0 },
  }).sort({ expiry: 1 });

  const allocations = [];

  for (const batch of batches) {
    if (remaining <= 0) break;

    if (batch.expiry <= now) {
      // Found expired stock. Remove it from usable litres so reports stay honest.
      const expiredQty = batch.availableQtyL;
      batch.status = 'expired';
      batch.availableQtyL = 0;
      await batch.save();
      await DairyBatchLedger.create({
        batch: batch._id,
        business: batch.business,
        eventType: 'expired',
        quantityL: -expiredQty,
        note: 'Past expiry at allocation time',
        createdBy: param && param.recordedBy,
      });
      logger.warn(`dairy FEFO: batch ${batch.batchNo} expired and was withdrawn (${expiredQty}L)`);
      continue;
    }

    const take = Math.min(batch.availableQtyL, remaining);
    allocations.push({ batch, quantityL: Number(take.toFixed(2)) });
    remaining -= take;
  }

  return allocations;
};

/**
 * Commits allocations, decrementing stock and writing the ledger.
 *
 * Separated from `allocateByFEFO` so a caller can preview the plan before
 * committing — an order should never discover mid-checkout that the milk ran out.
 *
 * @param {Array} allocations  from `allocateByFEFO`
 * @param {Object} param
 */
const commitAllocations = async (allocations, param) => {
  const committed = [];

  for (const allocation of allocations) {
    const { batch, quantityL } = allocation;
    if (batch.availableQtyL < quantityL) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Batch ${batch.batchNo} no longer has ${quantityL}L available`
      );
    }

    batch.availableQtyL = Number((batch.availableQtyL - quantityL).toFixed(2));
    batch.consumedQtyL = Number((batch.consumedQtyL + quantityL).toFixed(2));
    if (batch.availableQtyL <= 0) {
      batch.status = 'consumed';
    }
    await batch.save();

    await DairyBatchLedger.create({
      batch: batch._id,
      business: batch.business,
      eventType: 'consumed',
      quantityL: -quantityL,
      order: param.order,
      stop: param.stop,
      note: param.note,
      createdBy: param.recordedBy,
    });

    committed.push({ batchId: batch._id, batchNo: batch.batchNo, quantityL, expiry: batch.expiry });
  }

  return committed;
};

/**
 * Writes off shrinkage — spillage, curdling, processing loss.
 *
 * Tracked separately from consumption so wastage is visible rather than absorbed
 * into an apparently healthy sales figure.
 */
const recordShrinkage = async (batchId, quantityL, param) => {
  const batch = await DairyMilkBatch.findById(batchId);
  if (!batch) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (quantityL <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Shrinkage must be greater than zero');
  }
  if (quantityL > batch.availableQtyL) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot write off ${quantityL}L from a batch holding ${batch.availableQtyL}L`
    );
  }

  batch.availableQtyL = Number((batch.availableQtyL - quantityL).toFixed(2));
  batch.shrinkageL = Number((batch.shrinkageL + quantityL).toFixed(2));
  if (batch.availableQtyL <= 0) {
    batch.status = 'consumed';
  }
  await batch.save();

  await DairyBatchLedger.create({
    batch: batch._id,
    business: batch.business,
    eventType: 'shrinkage',
    quantityL: -quantityL,
    shrinkageReason: param.reason,
    note: param.note,
    createdBy: param.recordedBy,
  });

  return batch;
};

/**
 * Batch stock report for an outlet.
 */
const getBatchReport = async (businessId, options) => {
  const query = { business: businessId };
  if (options.status) {
    query.status = options.status;
  }
  if (options.provider) {
    query.provider = options.provider;
  }

  const batches = await DairyMilkBatch.find(query)
    .populate('provider', 'name code milkType')
    .sort({ expiry: 1 });

  const now = new Date();
  const summary = batches.reduce(
    (acc, batch) => {
      const key = batch.usableQtyL(now) > 0 ? 'usable' : batch.status === 'expired' ? 'expired' : batch.status;
      const entry = acc[key] || { batches: 0, litres: 0, consumed: 0, shrinkage: 0 };
      entry.batches += 1;
      entry.litres += batch.usableQtyL(now);
      entry.consumed += batch.consumedQtyL;
      entry.shrinkage += batch.shrinkageL;
      return { ...acc, [key]: entry };
    },
    { usable: { batches: 0, litres: 0, consumed: 0, shrinkage: 0 } }
  );

  return { batches, summary };
};

/**
 * Wastage rate across a period — the number a dairy unit is judged on.
 */
const getShrinkageReport = async (businessId, options) => {
  const match = { business: businessId };
  if (options.from || options.to) {
    match.createdAt = {};
    if (options.from) match.createdAt.$gte = new Date(options.from);
    if (options.to) match.createdAt.$lte = new Date(options.to);
  }

  const rows = await DairyBatchLedger.aggregate([
    { $match: { ...match, eventType: 'shrinkage' } },
    { $group: { _id: '$shrinkageReason', litres: { $sum: { $multiply: ['$quantityL', -1] } }, count: { $sum: 1 } } },
    { $sort: { litres: -1 } },
  ]);

  const intake = await DairyMilkCollection.aggregate([
    { $match: { business: businessId, qualityStatus: 'accepted' } },
    { $group: { _id: null, litres: { $sum: '$quantityL' } } },
  ]);

  const totalAccepted = intake[0] ? intake[0].litres : 0;
  const totalShrinkage = rows.reduce((sum, r) => sum + r.litres, 0);

  return {
    totalAcceptedLitres: totalAccepted,
    totalShrinkageLitres: Number(totalShrinkage.toFixed(2)),
    shrinkageRatePercentage:
      totalAccepted > 0 ? Number(((totalShrinkage / totalAccepted) * 100).toFixed(2)) : 0,
    byReason: rows,
  };
};

/**
 * Provider payable: accepted, unsettled collections.
 */
const getProviderPayable = async (businessId, options) => {
  const match = { business: businessId, qualityStatus: 'accepted' };
  if (options.provider) {
    match.provider = options.provider;
  }
  if (options.payableStatus) {
    match.payableStatus = options.payableStatus;
  } else {
    match.payableStatus = 'pending';
  }

  const rows = await DairyMilkCollection.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$provider',
        litres: { $sum: '$quantityL' },
        amount: { $sum: '$amount' },
        collections: { $sum: 1 },
      },
    },
  ]);

  const providers = await DairyMilkProvider.find({ _id: { $in: rows.map((r) => r._id) } }).select('name code mobile');

  return rows.map((row) => {
    const provider = providers.find((p) => p._id.equals(row._id));
    return {
      provider: provider ? provider._id : row._id,
      name: provider ? provider.name : null,
      code: provider ? provider.code : null,
      litres: row.litres,
      amount: Number((row.amount / 100).toFixed(2)),
      collections: row.collections,
    };
  });
};

module.exports = {
  createProvider,
  listProviders,
  updateProvider,
  createRejectionReason,
  listRejectionReasons,
  evaluateQuality,
  recordCollection,
  acceptCollection,
  rejectCollection,
  allocateByFEFO,
  commitAllocations,
  recordShrinkage,
  getBatchReport,
  getShrinkageReport,
  getProviderPayable,
  ensureSystemReason,
  getQualityConfig,
};