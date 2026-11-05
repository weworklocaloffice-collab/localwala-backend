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
const inventoryService = require('./stores.inventory.service');

const RETURN_TRANSITIONS = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['picked_up', 'rejected', 'cancelled'],
  picked_up: ['received', 'cancelled'],
  received: ['refunded', 'cancelled'],
  refunded: [],
  rejected: [],
  cancelled: [],
};

const EXCHANGE_TRANSITIONS = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['picked_up', 'rejected', 'cancelled'],
  picked_up: ['received', 'cancelled'],
  received: ['exchanged', 'cancelled'],
  exchanged: [],
  rejected: [],
  cancelled: [],
};

const assertTransition = (from, to, type = 'return') => {
  const table = type === 'return' ? RETURN_TRANSITIONS : EXCHANGE_TRANSITIONS;
  const allowed = table[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_${type.toUpperCase()}_MOVE: ${from} -> ${to} is not allowed`);
  }
};

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const loadCustomerOrder = async (order, customer) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const orderDoc = await StoreOrder.findById(order);
  if (!orderDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (String(orderDoc.customer) !== String(customer)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'ORDER_NOT_OWNED: this order belongs to another customer');
  }
  if (!['delivered', 'completed'].includes(orderDoc.lifecycle)) {
    throw new ApiError(httpStatus.CONFLICT, 'ORDER_NOT_POST_SALE: returns and exchanges open after delivery');
  }
  return orderDoc;
};

const resolveWindowDays = async ({ chain, outlet, type, field, fallback }) => {
  const StorePolicy = mongoose.model('StorePolicy');
  const now = new Date();
  const policy = await StorePolicy.findOne({
    chain,
    type,
    isActive: true,
    $and: [
      { $or: [{ outlet }, { outlet: { $exists: false } }, { outlet: null }] },
      { $or: [{ effectiveFrom: { $exists: false } }, { effectiveFrom: null }, { effectiveFrom: { $lte: now } }] },
      { $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gte: now } }] },
    ],
  })
    .sort({ outlet: -1, version: -1 })
    .lean();

  const configured = policy && Number(policy[field]);
  return Number.isFinite(configured) ? configured : fallback;
};

const assertWindowOpen = async (orderDoc, type) => {
  const field = type === 'return' ? 'returnWindowDays' : 'exchangeWindowDays';
  const days = await resolveWindowDays({
    chain: orderDoc.chain,
    outlet: orderDoc.outlet,
    type,
    field,
    fallback: 7,
  });
  const anchor = orderDoc.deliveredAt || orderDoc.completedAt || orderDoc.updatedAt;
  const closesAt = new Date(new Date(anchor).getTime() + days * 24 * 60 * 60 * 1000);
  if (new Date() > closesAt) {
    throw new ApiError(
      httpStatus.UNPROCESSABLE_ENTITY,
      `${type.toUpperCase()}_WINDOW_CLOSED: the ${days}-day ${type} window has closed`
    );
  }
};

const priorQuantities = (requests, productKey, variantKey) => {
  const quantities = new Map();
  requests.forEach((request) => {
    (request.items || []).forEach((item) => {
      const key = `${item[productKey]}:${item[variantKey]}`;
      quantities.set(key, (quantities.get(key) || 0) + Number(item.quantity || 0));
    });
  });
  return quantities;
};

const createCustomerReturnRequest = async ({
  order,
  customer,
  items,
  reason,
  reasonCategory,
  images,
  notes,
}) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const orderDoc = await loadCustomerOrder(order, customer);
  await assertWindowOpen(orderDoc, 'return');

  const prior = await StoreReturnRequest.find({
    order: orderDoc._id,
    status: { $nin: ['cancelled', 'rejected'] },
  }).lean();
  const claimed = priorQuantities(prior, 'product', 'variant');

  const resolvedItems = items.map((requested) => {
    const line = orderDoc.items.find(
      (item) =>
        String(item.product) === String(requested.product) &&
        String(item.variant) === String(requested.variant)
    );
    if (!line) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'PRODUCT_NOT_IN_ORDER: this product is not part of the order');
    }

    const lineQuantity = Number(line.quantity) || Number(line.fulfilledQuantity) || 0;
    const fulfilled = Number(line.fulfilledQuantity) || lineQuantity;
    const alreadyRefunded = Number(line.refundedQuantity) || 0;
    const key = `${line.product}:${line.variant}`;
    const alreadyRequested = claimed.get(key) || 0;
    const quantity = Number(requested.quantity);
    const available = Math.max(0, fulfilled - alreadyRefunded - alreadyRequested);
    if (quantity < 1 || quantity > available) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `RETURN_QUANTITY_EXCEEDED: only ${available} unit(s) can still be returned`
      );
    }
    claimed.set(key, alreadyRequested + quantity);

    const ratio = lineQuantity > 0 ? quantity / lineQuantity : 1;
    return {
      product: line.product,
      variant: line.variant,
      name: line.variantName ? `${line.name} - ${line.variantName}` : line.name,
      sku: line.sku,
      quantity,
      unitPrice: Number(line.unitPrice) || 0,
      refundAmount: round2(Number(line.lineGrand || 0) * ratio),
      taxAmount: round2(Number(line.taxAmount || 0) * ratio),
      reason: requested.reason || reason,
      condition: requested.condition,
      notes: requested.notes,
      images: requested.images || [],
    };
  });

  return StoreReturnRequest.create({
    order: orderDoc._id,
    outlet: orderDoc.outlet,
    chain: orderDoc.chain,
    customer,
    items: resolvedItems,
    reason,
    reasonCategory,
    totalRefundAmount: round2(resolvedItems.reduce((sum, item) => sum + item.refundAmount, 0)),
    refundMethod: 'original_payment',
    images: images || [],
    notes,
    status: 'requested',
  });
};

const createCustomerExchangeRequest = async ({
  order,
  customer,
  items,
  reason,
  reasonCategory,
  images,
  notes,
}) => {
  const StoreExchangeRequest = mongoose.model('StoreExchangeRequest');
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const ChainProductVariant = mongoose.model('ChainProductVariant');
  const ChainProduct = mongoose.model('ChainProduct');
  const orderDoc = await loadCustomerOrder(order, customer);
  await assertWindowOpen(orderDoc, 'exchange');

  const prior = await StoreExchangeRequest.find({
    order: orderDoc._id,
    status: { $nin: ['cancelled', 'rejected'] },
  }).lean();
  const claimed = priorQuantities(prior, 'originalProduct', 'originalVariant');

  const resolvedItems = [];
  for (const requested of items) {
    const line = orderDoc.items.find(
      (item) =>
        String(item.product) === String(requested.originalProduct) &&
        String(item.variant) === String(requested.originalVariant)
    );
    if (!line) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'PRODUCT_NOT_IN_ORDER: this product is not part of the order');
    }

    const lineQuantity = Number(line.quantity) || Number(line.fulfilledQuantity) || 0;
    const fulfilled = Number(line.fulfilledQuantity) || lineQuantity;
    const key = `${line.product}:${line.variant}`;
    const alreadyRequested = claimed.get(key) || 0;
    const quantity = Number(requested.quantity);
    const available = Math.max(0, fulfilled - alreadyRequested);
    if (quantity < 1 || quantity > available) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `EXCHANGE_QUANTITY_EXCEEDED: only ${available} unit(s) can still be exchanged`
      );
    }
    claimed.set(key, alreadyRequested + quantity);

    const targetVariantId = requested.exchangeForVariant || line.variant;
    const replacesVariant = String(targetVariantId) !== String(line.variant);
    let exchangeForProduct = line.product;
    let exchangeForName = line.variantName ? `${line.name} - ${line.variantName}` : line.name;
    let exchangeForSku = line.sku;
    let priceDifference = 0;

    if (replacesVariant) {
      const variant = await ChainProductVariant.findOne({
        _id: targetVariantId,
        chain: orderDoc.chain,
        status: 'active',
      }).lean();
      if (!variant) {
        throw new ApiError(httpStatus.CONFLICT, 'EXCHANGE_UNAVAILABLE: the requested variant is not available');
      }
      const product = await ChainProduct.findOne({
        _id: variant.product,
        chain: orderDoc.chain,
        status: 'active',
      }).lean();
      if (!product) {
        throw new ApiError(httpStatus.CONFLICT, 'EXCHANGE_UNAVAILABLE: the requested product is not available');
      }
      exchangeForProduct = variant.product;
      exchangeForName = variant.name ? `${product.name} - ${variant.name}` : product.name;
      exchangeForSku = variant.sku;
      priceDifference = round2((Number(variant.price) - Number(line.unitPrice)) * quantity);
    }

    const stock = await StoreOutletStockItem.findOne({
      outlet: orderDoc.outlet,
      variant: targetVariantId,
    }).lean();
    if (!stock || Number(stock.availableQty) < quantity) {
      throw new ApiError(httpStatus.CONFLICT, 'EXCHANGE_UNAVAILABLE: the replacement is out of stock');
    }

    resolvedItems.push({
      originalProduct: line.product,
      originalVariant: line.variant,
      originalName: line.variantName ? `${line.name} - ${line.variantName}` : line.name,
      originalSku: line.sku,
      exchangeForProduct,
      exchangeForVariant: targetVariantId,
      exchangeForName,
      exchangeForSku,
      quantity,
      priceDifference,
      reason: requested.reason || reason,
      condition: requested.condition,
    });
  }

  const totalPriceDifference = round2(resolvedItems.reduce((sum, item) => sum + item.priceDifference, 0));
  const paymentRequired = totalPriceDifference > 0;

  return StoreExchangeRequest.create({
    order: orderDoc._id,
    outlet: orderDoc.outlet,
    chain: orderDoc.chain,
    customer,
    items: resolvedItems,
    reason,
    reasonCategory,
    totalPriceDifference,
    paymentRequired,
    paymentAmount: paymentRequired ? totalPriceDifference : 0,
    paymentStatus: paymentRequired ? 'pending' : 'not_required',
    images: images || [],
    notes,
    status: 'requested',
  });
};

const createReturnRequest = async ({ order, outlet, chain, customer, items, reason, reasonCategory, images, notes }) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const totalRefundAmount = items.reduce((sum, item) => sum + item.refundAmount, 0);

  return StoreReturnRequest.create({
    order,
    outlet,
    chain,
    customer,
    items,
    reason,
    reasonCategory,
    totalRefundAmount,
    refundMethod: 'original_payment',
    images,
    notes,
    status: 'requested',
  });
};

const transitionReturn = async (returnId, to, { actor, notes } = {}) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const req = await StoreReturnRequest.findById(returnId);
  if (!req) throw new ApiError(httpStatus.NOT_FOUND, 'Return request not found');

  assertTransition(req.status, to, 'return');

  req.status = to;
  const now = new Date();

  if (to === 'approved') { req.approvedAt = now; req.approvedBy = actor; }
  if (to === 'picked_up') req.pickedUpAt = now;
  if (to === 'received') req.receivedAt = now;
  if (to === 'refunded') req.refundedAt = now;
  if (to === 'rejected') { req.rejectedAt = now; req.rejectionReason = notes; }

  await req.save();
  return req;
};

const createExchangeRequest = async ({ order, outlet, chain, customer, items, reason, reasonCategory, images, notes }) => {
  const StoreExchangeRequest = mongoose.model('StoreExchangeRequest');
  const totalPriceDifference = items.reduce((sum, item) => sum + item.priceDifference, 0);
  const paymentRequired = totalPriceDifference > 0;

  return StoreExchangeRequest.create({
    order,
    outlet,
    chain,
    customer,
    items,
    reason,
    reasonCategory,
    totalPriceDifference,
    paymentRequired,
    paymentAmount: paymentRequired ? totalPriceDifference : 0,
    paymentStatus: paymentRequired ? 'pending' : 'not_required',
    images,
    notes,
    status: 'requested',
  });
};

const transitionExchange = async (exchangeId, to, { actor, notes } = {}) => {
  const StoreExchangeRequest = mongoose.model('StoreExchangeRequest');
  const req = await StoreExchangeRequest.findById(exchangeId);
  if (!req) throw new ApiError(httpStatus.NOT_FOUND, 'Exchange request not found');

  assertTransition(req.status, to, 'exchange');

  req.status = to;
  const now = new Date();

  if (to === 'approved') { req.approvedAt = now; req.approvedBy = actor; }
  if (to === 'picked_up') req.pickedUpAt = now;
  if (to === 'received') req.receivedAt = now;
  if (to === 'exchanged') req.exchangedAt = now;
  if (to === 'rejected') { req.rejectedAt = now; req.rejectionReason = notes; }

  await req.save();
  return req;
};

const processReturnRefund = async (returnId, { refundReference }) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const req = await StoreReturnRequest.findById(returnId);
  if (!req) throw new ApiError(httpStatus.NOT_FOUND, 'Return request not found');
  if (req.status !== 'received') throw new ApiError(httpStatus.CONFLICT, 'Return must be received before refund');

  for (const item of req.items) {
    await inventoryService.adjustStock({
      outlet: req.outlet,
      chain: req.chain,
      variant: item.variant,
      product: item.product,
      type: 'RETURNED',
      quantity: item.quantity,
      reason: 'Customer return',
      referenceType: 'return',
      referenceId: req._id,
    });
  }

  req.status = 'refunded';
  req.refundedAt = new Date();
  req.refundReference = refundReference;
  await req.save();
  return req;
};

const getReturnRequest = async (returnId) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const req = await StoreReturnRequest.findById(returnId)
    .populate('customer', 'name mobile email')
    .populate('order', 'orderNo grandTotal')
    .lean();
  if (!req) throw new ApiError(httpStatus.NOT_FOUND, 'Return request not found');
  return req;
};

const listReturns = async ({ outlet, customer, status, page = 1, limit = 20 }) => {
  const StoreReturnRequest = mongoose.model('StoreReturnRequest');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (customer) filter.customer = customer;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreReturnRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreReturnRequest.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const listExchanges = async ({ outlet, customer, status, page = 1, limit = 20 }) => {
  const StoreExchangeRequest = mongoose.model('StoreExchangeRequest');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (customer) filter.customer = customer;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreExchangeRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreExchangeRequest.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

module.exports = {
  createReturnRequest,
  createCustomerReturnRequest,
  transitionReturn,
  createExchangeRequest,
  createCustomerExchangeRequest,
  transitionExchange,
  processReturnRefund,
  getReturnRequest,
  listReturns,
  listExchanges,
  assertTransition,
  RETURN_TRANSITIONS,
  EXCHANGE_TRANSITIONS,
};