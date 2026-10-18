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

/**
 * `reason` is a CONTROLLED value (see `StoreRefund.reason`) — callers are responsible for
 * mapping free text onto it, e.g. "changed mind" -> `customer_cancellation`.
 * `note` carries the human wording alongside it, so an enum-safe row does not mean the
 * customer's own explanation is thrown away.
 */
const createComponentRefund = async ({ order, componentKey, amount, reason, fundingSource, note }) => {
  const StoreRefund = mongoose.model('StoreRefund');
  await StoreRefund.assertRefundCeiling(order._id, amount);

  return StoreRefund.create({
    order: order._id,
    outlet: order.outlet,
    chain: order.chain,
    customer: order.customer,
    componentKey,
    amount,
    reason,
    note,
    fundingSource,
    status: 'REFUND_PENDING',
    timeline: [{ status: 'REFUND_PENDING', at: new Date() }],
  });
};

const createOrderRefunds = async (orderId, { reason, fundingSource = 'connected_account', note }) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const StoreRefund = mongoose.model('StoreRefund');

  const order = await StoreOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  const refunds = [];

  for (const item of order.items) {
    if (item.fulfilment === 'cancelled' || item.cancelledQuantity > 0) {
      const refundable = item.lineGrand - (item.discountAmount || 0);
      if (refundable > 0) {
        const refund = await createComponentRefund({
          order,
          componentKey: `item:${item.variant}`,
          amount: refundable,
          reason,
          note,
          fundingSource,
        });
        refunds.push(refund);
      }
    }
  }

  if (order.deliveryFee > 0) {
    const refund = await createComponentRefund({
      order,
      componentKey: 'delivery_fee',
      amount: order.deliveryFee,
      reason,
      note,
      fundingSource,
    });
    refunds.push(refund);
  }

  return refunds;
};

const transitionRefund = async (refundId, to, { actor, note } = {}) => {
  const StoreRefund = mongoose.model('StoreRefund');
  const refund = await StoreRefund.findById(refundId);
  if (!refund) throw new ApiError(httpStatus.NOT_FOUND, 'Refund not found');

  const allowed = {
    REFUND_PENDING: ['PROCESSING', 'REVERSED'],
    PROCESSING: ['REFUNDED', 'FAILED', 'REVERSED'],
    REFUNDED: ['REVERSED'],
    FAILED: ['PROCESSING'],
    REVERSED: [],
  };

  if (!allowed[refund.status]?.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_REFUND_MOVE: ${refund.status} -> ${to}`);
  }

  refund.status = to;
  refund.timeline.push({ status: to, at: new Date(), by: actor, note });

  if (to === 'REFUNDED') refund.timeline[refund.timeline.length - 1].note = note || 'Refund completed';
  if (to === 'FAILED') refund.failureReason = note;

  await refund.save();
  return refund;
};

const getRefund = async (refundId) => {
  const StoreRefund = mongoose.model('StoreRefund');
  const refund = await StoreRefund.findById(refundId)
    .populate('customer', 'name mobile email')
    .populate('order', 'orderNo grandTotal')
    .lean();
  if (!refund) throw new ApiError(httpStatus.NOT_FOUND, 'Refund not found');
  return refund;
};

const listRefunds = async ({ outlet, customer, status, page = 1, limit = 20 }) => {
  const StoreRefund = mongoose.model('StoreRefund');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (customer) filter.customer = customer;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreRefund.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreRefund.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const findFailedRefunds = async (outletId) => {
  const StoreRefund = mongoose.model('StoreRefund');
  return StoreRefund.findFailed(outletId);
};

module.exports = {
  createComponentRefund,
  createOrderRefunds,
  transitionRefund,
  getRefund,
  listRefunds,
  findFailedRefunds,
};
