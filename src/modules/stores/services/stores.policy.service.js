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

/**
 * stores.policy.service.js — policy management.
 *
 * Handles creation, listing, and retrieval of store policies (BR-19, BR-20, BR-21).
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const createPolicy = async ({ chain, outlet, type, title, content, returnWindowDays, exchangeWindowDays, warrantyDefaultMonths, cancellationWindowHours, effectiveFrom, effectiveTo }) => {
  const StorePolicy = mongoose.model('StorePolicy');
  const policy = await StorePolicy.create({
    chain,
    outlet,
    type,
    title,
    content,
    returnWindowDays: returnWindowDays || 7,
    exchangeWindowDays: exchangeWindowDays || 7,
    warrantyDefaultMonths: warrantyDefaultMonths || 0,
    cancellationWindowHours: cancellationWindowHours || 24,
    effectiveFrom: effectiveFrom || new Date(),
    effectiveTo,
  });
  return policy;
};

const getPolicy = async (policyId, { outlet } = {}) => {
  const StorePolicy = mongoose.model('StorePolicy');
  const query = outlet ? { _id: policyId, outlet } : { _id: policyId };
  const policy = await StorePolicy.findOne(query)
    .populate('chain', 'name')
    .populate('outlet', 'name outletCode')
    .lean();
  if (!policy) throw new ApiError(httpStatus.NOT_FOUND, 'Policy not found');
  return policy;
};

const listPolicies = async ({ chain, outlet, type, isActive, page = 1, limit = 20 }) => {
  const StorePolicy = mongoose.model('StorePolicy');
  const filter = {};
  if (chain) filter.chain = chain;
  if (outlet) filter.outlet = outlet;
  if (type) filter.type = type;
  if (isActive !== undefined) filter.isActive = isActive;

  const [items, total] = await Promise.all([
    StorePolicy.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('chain', 'name')
      .populate('outlet', 'name outletCode')
      .lean(),
    StorePolicy.countDocuments(filter),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const updatePolicy = async (policyId, updates, { outlet } = {}) => {
  const StorePolicy = mongoose.model('StorePolicy');
  const query = outlet ? { _id: policyId, outlet } : { _id: policyId };
  const policy = await StorePolicy.findOneAndUpdate(query, updates, { new: true });
  if (!policy) throw new ApiError(httpStatus.NOT_FOUND, 'Policy not found');
  return policy;
};

const archivePolicy = async (policyId, { outlet } = {}) => {
  return updatePolicy(policyId, { isActive: false }, { outlet });
};

const getActivePolicy = async (chainId, type) => {
  const StorePolicy = mongoose.model('StorePolicy');
  return StorePolicy.findActive(chainId, type);
};

module.exports = {
  createPolicy,
  getPolicy,
  listPolicies,
  updatePolicy,
  archivePolicy,
  getActivePolicy,
};