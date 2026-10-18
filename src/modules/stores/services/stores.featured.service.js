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
 * stores.featured.service.js — featured placement management.
 *
 * Handles creation, listing, and status management of featured placements (§31, §12).
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const createFeaturedPlacement = async ({ subjectType, outlet, chain, product, slot, startsAt, endsAt, amount }) => {
  const StoreFeaturedPlacement = mongoose.model('StoreFeaturedPlacement');
  const placement = await StoreFeaturedPlacement.create({
    subjectType,
    outlet,
    chain,
    product,
    slot,
    startsAt,
    endsAt,
    amount,
    status: 'pending_payment',
  });
  return placement;
};

const getFeaturedPlacement = async (placementId, { outlet } = {}) => {
  const StoreFeaturedPlacement = mongoose.model('StoreFeaturedPlacement');
  const query = outlet ? { _id: placementId, outlet } : { _id: placementId };
  const placement = await StoreFeaturedPlacement.findOne(query)
    .populate('product', 'name images')
    .populate('outlet', 'name outletCode')
    .populate('chain', 'name')
    .lean();
  if (!placement) throw new ApiError(httpStatus.NOT_FOUND, 'Featured placement not found');
  return placement;
};

const listFeaturedPlacements = async ({ outlet, chain, subjectType, status, slot, page = 1, limit = 20 }) => {
  const StoreFeaturedPlacement = mongoose.model('StoreFeaturedPlacement');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (chain) filter.chain = chain;
  if (subjectType) filter.subjectType = subjectType;
  if (status) filter.status = status;
  if (slot) filter.slot = slot;

  const [items, total] = await Promise.all([
    StoreFeaturedPlacement.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('product', 'name images')
      .populate('outlet', 'name outletCode')
      .populate('chain', 'name')
      .lean(),
    StoreFeaturedPlacement.countDocuments(filter),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const updateFeaturedPlacement = async (placementId, updates, { outlet } = {}) => {
  const StoreFeaturedPlacement = mongoose.model('StoreFeaturedPlacement');
  const query = outlet ? { _id: placementId, outlet } : { _id: placementId };
  const placement = await StoreFeaturedPlacement.findOneAndUpdate(query, updates, { new: true });
  if (!placement) throw new ApiError(httpStatus.NOT_FOUND, 'Featured placement not found');
  return placement;
};

const approveFeaturedPlacement = async (placementId, { outlet, actor } = {}) => {
  const StoreFeaturedPlacement = mongoose.model('StoreFeaturedPlacement');
  const query = outlet ? { _id: placementId, outlet } : { _id: placementId };
  const placement = await StoreFeaturedPlacement.findOne(query);
  if (!placement) throw new ApiError(httpStatus.NOT_FOUND, 'Featured placement not found');
  if (placement.status !== 'paid') throw new ApiError(httpStatus.CONFLICT, 'Placement must be paid before approval');
  placement.status = 'approved';
  placement.approvedBy = actor;
  placement.approvedAt = new Date();
  await placement.save();
  return placement;
};

const rejectFeaturedPlacement = async (placementId, { outlet, actor, reason } = {}) => {
  const StoreFeaturedPlacement = mongoose.model('StoreFeaturedPlacement');
  const query = outlet ? { _id: placementId, outlet } : { _id: placementId };
  const placement = await StoreFeaturedPlacement.findOne(query);
  if (!placement) throw new ApiError(httpStatus.NOT_FOUND, 'Featured placement not found');
  placement.status = 'rejected';
  await placement.save();
  return placement;
};

const getLivePlacements = async (outletId) => {
  return mongoose.model('StoreFeaturedPlacement').findLive(outletId);
};

const getPendingApprovals = async () => {
  return mongoose.model('StoreFeaturedPlacement').findPendingApproval();
};

module.exports = {
  createFeaturedPlacement,
  getFeaturedPlacement,
  listFeaturedPlacements,
  updateFeaturedPlacement,
  approveFeaturedPlacement,
  rejectFeaturedPlacement,
  getLivePlacements,
  getPendingApprovals,
};