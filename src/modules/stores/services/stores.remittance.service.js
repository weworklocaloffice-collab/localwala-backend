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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const generateRemittanceForDriver = async (driverId, outletId, chainId, date = new Date()) => {
  const StoreDelivery = mongoose.model('StoreDelivery');
  const StoreDriverRemittance = mongoose.model('StoreDriverRemittance');
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  // Sum the cash actually taken at doors: `codCollected`, written by `collectCod`
  // alongside `codStatus: 'collected'`. The previous revision read `codAmount`, which
  // lives on StoreOrder (what was owed) and on jhatka's models — never on a store
  // delivery — so the filter matched nothing and every remittance said the driver
  // owed zero regardless of the day's COD take.
  const deliveries = await StoreDelivery.find({
    driver: driverId,
    status: 'delivered',
    deliveredAt: { $gte: start, $lte: end },
    codCollected: { $gt: 0 },
  }).select('codCollected').lean();

  const expected = deliveries.reduce((sum, d) => sum + (d.codCollected || 0), 0);

  let remittance = await StoreDriverRemittance.findOne({ driver: driverId, date: start });
  if (remittance) {
    remittance.expected = expected;
    await remittance.save();
    return remittance;
  }

  return StoreDriverRemittance.create({
    driver: driverId,
    outlet: outletId,
    chain: chainId,
    date: start,
    expected,
    collected: 0,
    remitted: 0,
    variance: 0,
    status: 'pending',
  });
};

const submitRemittance = async ({ remittanceId, collected, remitted, notes, actor }) => {
  const StoreDriverRemittance = mongoose.model('StoreDriverRemittance');
  const remittance = await StoreDriverRemittance.findById(remittanceId);
  if (!remittance) throw new ApiError(httpStatus.NOT_FOUND, 'Remittance not found');
  if (remittance.status === 'disputed') throw new ApiError(httpStatus.CONFLICT, 'REMITTANCE_DISPUTED');
  if (remittance.status === 'reconciled') throw new ApiError(httpStatus.CONFLICT, 'REMITTANCE_ALREADY_RECONCILED');

  remittance.collected = collected;
  remittance.remitted = remitted;
  remittance.variance = collected - remitted;
  remittance.notes = notes;
  if (remittance.variance === 0) {
    remittance.status = 'reconciled';
    remittance.reconciledBy = actor;
    remittance.reconciledAt = new Date();
  } else if (remittance.variance > 0) {
    remittance.status = 'disputed';
  }
  await remittance.save();
  return remittance;
};

const reconcileRemittance = async ({ remittanceId, actor, notes }) => {
  const StoreDriverRemittance = mongoose.model('StoreDriverRemittance');
  const remittance = await StoreDriverRemittance.findById(remittanceId);
  if (!remittance) throw new ApiError(httpStatus.NOT_FOUND, 'Remittance not found');
  if (remittance.status === 'reconciled') return remittance;
  if (remittance.variance !== 0) throw new ApiError(httpStatus.CONFLICT, 'VARIANCE_EXISTS: cannot reconcile without zero variance');
  remittance.status = 'reconciled';
  remittance.reconciledBy = actor;
  remittance.reconciledAt = new Date();
  remittance.notes = notes;
  await remittance.save();
  return remittance;
};

const listRemittances = async ({ outlet, driver, status, dateFrom, dateTo, page = 1, limit = 20 }) => {
  const StoreDriverRemittance = mongoose.model('StoreDriverRemittance');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (driver) filter.driver = driver;
  if (status) filter.status = status;
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo) filter.date.$lte = new Date(dateTo);
  }
  const [items, total] = await Promise.all([
    StoreDriverRemittance.find(filter).sort({ date: -1 }).skip((page - 1) * limit).limit(limit).populate('driver', 'driverCode name').populate('outlet', 'name outletCode').lean(),
    StoreDriverRemittance.countDocuments(filter),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const getPendingRemittances = async (outletId) => {
  const StoreDriverRemittance = mongoose.model('StoreDriverRemittance');
  return StoreDriverRemittance.find({ outlet: outletId, status: 'pending' }).populate('driver', 'driverCode name').lean();
};

module.exports = {
  generateRemittanceForDriver,
  submitRemittance,
  reconcileRemittance,
  listRemittances,
  getPendingRemittances,
};