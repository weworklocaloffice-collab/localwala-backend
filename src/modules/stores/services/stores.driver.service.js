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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const createDriver = async ({ user, outlet, chain, driverCode, vehicle, licenseNumber, licenseExpiry, aadhaarLast4, panNumber, bankDetails, payoutMode }) => {
  const StoreDriver = mongoose.model('StoreDriver');
  const existing = await StoreDriver.findOne({ user, outlet });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'Driver already exists for this user at this outlet');

  return StoreDriver.create({
    user,
    outlet,
    chain,
    driverCode,
    vehicle,
    licenseNumber,
    licenseExpiry,
    aadhaarLast4,
    panNumber,
    bankDetails,
    payoutMode: payoutMode || 'business_pays',
    status: 'active',
  });
};

const updateDriver = async (driverId, updates) => {
  const StoreDriver = mongoose.model('StoreDriver');
  const driver = await StoreDriver.findById(driverId);
  if (!driver) throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found');

  const allowed = ['vehicle', 'licenseNumber', 'licenseExpiry', 'bankDetails', 'payoutMode', 'isAvailable'];
  for (const key of allowed) {
    if (updates[key] !== undefined) driver[key] = updates[key];
  }
  await driver.save();
  return driver;
};

const deactivateDriver = async (driverId, { reason, deactivatedBy }) => {
  const StoreDriver = mongoose.model('StoreDriver');
  const driver = await StoreDriver.findById(driverId);
  if (!driver) throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found');

  driver.status = 'inactive';
  driver.isAvailable = false;
  driver.deactivatedAt = new Date();
  driver.deactivatedBy = deactivatedBy;
  driver.deactivationReason = reason;
  await driver.save();
  return driver;
};

const suspendDriver = async (driverId, { reason }) => {
  const StoreDriver = mongoose.model('StoreDriver');
  const driver = await StoreDriver.findById(driverId);
  if (!driver) throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found');

  driver.status = 'suspended';
  driver.isAvailable = false;
  driver.suspensionReason = reason;
  await driver.save();
  return driver;
};

const reactivateDriver = async (driverId) => {
  const StoreDriver = mongoose.model('StoreDriver');
  const driver = await StoreDriver.findById(driverId);
  if (!driver) throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found');

  driver.status = 'reactivated';
  driver.isAvailable = true;
  await driver.save();
  return driver;
};

const getDriver = async (driverId) => {
  const StoreDriver = mongoose.model('StoreDriver');
  const driver = await StoreDriver.findById(driverId)
    .populate('user', 'name mobile email')
    .populate('outlet', 'name outletCode')
    .populate('vehicle', 'vehicleType registrationNumber')
    .lean();
  if (!driver) throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found');
  return driver;
};

const listDrivers = async ({ outlet, chain, status, page = 1, limit = 20 }) => {
  const StoreDriver = mongoose.model('StoreDriver');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (chain) filter.chain = chain;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreDriver.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreDriver.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const toggleAvailability = async (driverId, isAvailable) => {
  const StoreDriver = mongoose.model('StoreDriver');
  return StoreDriver.findByIdAndUpdate(driverId, { $set: { isAvailable } }, { new: true });
};

module.exports = {
  createDriver,
  updateDriver,
  deactivateDriver,
  suspendDriver,
  reactivateDriver,
  getDriver,
  listDrivers,
  toggleAvailability,
};