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
 * stores.warranty.service.js — warranty request lifecycle.
 *
 * Handles creation, listing, status transitions, and expiry monitoring
 * for warranty requests (BR-21, §28-29).
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const WARRANTY_TRANSITIONS = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['in_repair', 'resolved', 'cancelled'],
  in_repair: ['resolved', 'rejected'],
  resolved: ['closed'],
  rejected: ['closed'],
  cancelled: [],
  closed: [],
};

const assertTransition = (from, to) => {
  const allowed = WARRANTY_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_WARRANTY_MOVE: ${from} -> ${to} is not allowed. Allowed: ${allowed?.join(', ') || 'none'}`);
  }
};

const createWarrantyRequest = async ({ customer, outlet, chain, order, product, variant, warrantyType, warrantyMonths, purchaseDate, warrantyExpiryDate, issueDescription, issueCategory, images, documents }) => {
  const StoreWarrantyRequest = mongoose.model('StoreWarrantyRequest');
  const StoreOrder = mongoose.model('StoreOrder');

  // Verify order exists and belongs to customer
  const orderDoc = await StoreOrder.findById(order);
  if (!orderDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (String(orderDoc.customer) !== String(customer)) throw new ApiError(httpStatus.FORBIDDEN, 'ORDER_NOT_OWNED: this order belongs to another customer');

  // Derive the merchant and product from the order. The customer body is not
  // trusted for any of these: a warranty may only cover something they bought.
  if (outlet && String(orderDoc.outlet) !== String(outlet)) {
    throw new ApiError(httpStatus.CONFLICT, 'OUTLET_MISMATCH: order belongs to a different outlet');
  }
  if (chain && String(orderDoc.chain) !== String(chain)) {
    throw new ApiError(httpStatus.CONFLICT, 'CHAIN_MISMATCH: order belongs to a different chain');
  }

  const item = orderDoc.items.find(
    (line) => String(line.product) === String(product) && (!variant || String(line.variant) === String(variant))
  );
  if (!item) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'PRODUCT_NOT_IN_ORDER: this product is not part of the order');
  }

  const resolvedPurchaseDate = purchaseDate || orderDoc.deliveredAt || orderDoc.completedAt || orderDoc.placedAt || orderDoc.createdAt;
  if (new Date(warrantyExpiryDate) <= new Date(resolvedPurchaseDate)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'INVALID_WARRANTY_WINDOW: expiry must be after the purchase date');
  }
  const resolvedProductName = item.variantName ? `${item.name} - ${item.variantName}` : item.name;

  const request = await StoreWarrantyRequest.create({
    order,
    outlet: orderDoc.outlet,
    chain: orderDoc.chain,
    customer,
    product: item.product,
    variant: item.variant,
    productName: resolvedProductName,
    sku: item.sku,
    warrantyType,
    warrantyMonths,
    purchaseDate: resolvedPurchaseDate,
    warrantyExpiryDate,
    issueDescription,
    issueCategory,
    status: 'requested',
    images: images || [],
    documents: documents || [],
  });

  return request;
};

const getWarrantyRequest = async (requestId, { outlet, customer } = {}) => {
  const StoreWarrantyRequest = mongoose.model('StoreWarrantyRequest');
  const query = { _id: requestId };
  if (outlet) query.outlet = outlet;
  if (customer) query.customer = customer;
  const request = await StoreWarrantyRequest.findOne(query)
    .populate('order', 'orderNo')
    .populate('product', 'name')
    .populate('variant', 'name')
    .populate('customer', 'name email mobile')
    .populate('outlet', 'name outletCode')
    .populate('chain', 'name')
    .lean();
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Warranty request not found');
  return request;
};

const listWarrantyRequests = async ({ outlet, customer, status, page = 1, limit = 20 }) => {
  const StoreWarrantyRequest = mongoose.model('StoreWarrantyRequest');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (customer) filter.customer = customer;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreWarrantyRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('order', 'orderNo')
      .populate('product', 'name')
      .populate('outlet', 'name outletCode')
      .lean(),
    StoreWarrantyRequest.countDocuments(filter),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const transitionWarranty = async (requestId, to, { outlet, customer, actor, notes, resolution, resolutionNotes, serviceCentreName, serviceCentreAddress, serviceCentreContact, repairCost, costBearer }) => {
  const StoreWarrantyRequest = mongoose.model('StoreWarrantyRequest');

  const query = { _id: requestId };
  if (outlet) query.outlet = outlet;
  if (customer) query.customer = customer;
  const request = await StoreWarrantyRequest.findOne(query);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Warranty request not found');

  // Customers may only withdraw their own request. Approval, repair and
  // resolution are outlet decisions and stay behind the partner route.
  if (customer && to !== 'cancelled') {
    throw new ApiError(httpStatus.FORBIDDEN, 'CUSTOMER_WARRANTY_SCOPE: customers may only cancel a warranty request');
  }

  assertTransition(request.status, to);

  const from = request.status;
  request.status = to;

  if (notes) request.notes = notes;
  if (resolution) request.resolution = resolution;
  if (resolutionNotes) request.resolutionNotes = resolutionNotes;
  if (serviceCentreName) request.serviceCentreName = serviceCentreName;
  if (serviceCentreAddress) request.serviceCentreAddress = serviceCentreAddress;
  if (serviceCentreContact) request.serviceCentreContact = serviceCentreContact;
  if (repairCost !== undefined) request.repairCost = repairCost;
  if (costBearer) request.costBearer = costBearer;

  if (to === 'approved') {
    request.approvedAt = new Date();
    request.approvedBy = actor;
  }
  if (['resolved', 'rejected'].includes(to)) {
    request.resolvedAt = new Date();
    request.resolvedBy = actor;
  }

  request.history = request.history || [];
  request.history.push({ from, to, by: actor, at: new Date(), notes });

  await request.save();
  return request;
};

const getExpiringWarranties = async ({ outlet, days = 30 }) => {
  const StoreWarrantyRequest = mongoose.model('StoreWarrantyRequest');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const filter = {
    warrantyExpiryDate: { $lte: cutoff, $gte: new Date() },
    status: { $in: ['approved', 'in_repair'] },
  };
  if (outlet) filter.outlet = outlet;
  return StoreWarrantyRequest.find(filter).populate('product', 'name').populate('outlet', 'name outletCode').lean();
};

const WATCHDOG_INTERVAL_DAYS = 30;

const startExpiryWatcher = () => {
  // This can be called from cron to check expiring warranties
  return async () => {
    try {
      const expiring = await getExpiringWarranties({ days: WATCHDOG_INTERVAL_DAYS });
      // Could send notifications here
      return expiring;
    } catch (error) {
      console.error('Warranty expiry watch failed:', error.message);
    }
  };
};

module.exports = {
  createWarrantyRequest,
  getWarrantyRequest,
  listWarrantyRequests,
  transitionWarranty,
  getExpiringWarranties,
  startExpiryWatcher,
  assertTransition,
  WARRANTY_TRANSITIONS,
};