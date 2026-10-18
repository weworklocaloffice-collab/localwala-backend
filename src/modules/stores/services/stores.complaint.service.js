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
 * stores.complaint.service.js — complaint management.
 *
 * Handles creation, listing, and resolution of customer complaints (§29-30, §33-34).
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const COMPLAINT_TRANSITIONS = {
  open: ['in_progress', 'resolved', 'closed', 'escalated'],
  in_progress: ['resolved', 'closed', 'escalated', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
  escalated: ['in_progress', 'resolved', 'closed'],
};

const assertTransition = (from, to) => {
  const allowed = COMPLAINT_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_COMPLAINT_MOVE: ${from} -> ${to} is not allowed. Allowed: ${allowed?.join(', ') || 'none'}`);
  }
};

const createComplaint = async ({ customer, outlet, chain, order, product, category, subject, description, priority, images, attachments }) => {
  const StoreComplaint = mongoose.model('StoreComplaint');
  const StoreOrder = mongoose.model('StoreOrder');

  // Verify order if provided
  if (order) {
    const orderDoc = await StoreOrder.findById(order);
    if (!orderDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
    if (String(orderDoc.customer) !== String(customer)) throw new ApiError(httpStatus.FORBIDDEN, 'ORDER_NOT_OWNED');
  }

  const complaint = await StoreComplaint.create({
    customer,
    outlet,
    chain,
    order,
    product,
    category,
    subject,
    description,
    priority: priority || 'medium',
    images: images || [],
    attachments: attachments || [],
    status: 'open',
  });

  return complaint;
};

const getComplaint = async (complaintId, { outlet } = {}) => {
  const StoreComplaint = mongoose.model('StoreComplaint');
  const query = outlet ? { _id: complaintId, outlet } : { _id: complaintId };
  const complaint = await StoreComplaint.findOne(query)
    .populate('order', 'orderNo')
    .populate('product', 'name')
    .populate('customer', 'name email mobile')
    .populate('outlet', 'name outletCode')
    .populate('chain', 'name')
    .populate('resolvedBy', 'name')
    .populate('escalatedTo', 'name')
    .lean();
  if (!complaint) throw new ApiError(httpStatus.NOT_FOUND, 'Complaint not found');
  return complaint;
};

const listComplaints = async ({ outlet, chain, customer, status, category, priority, page = 1, limit = 20 }) => {
  const StoreComplaint = mongoose.model('StoreComplaint');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (chain) filter.chain = chain;
  if (customer) filter.customer = customer;
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (priority) filter.priority = priority;

  const [items, total] = await Promise.all([
    StoreComplaint.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('order', 'orderNo')
      .populate('product', 'name')
      .populate('customer', 'name email mobile')
      .populate('outlet', 'name outletCode')
      .populate('resolvedBy', 'name')
      .populate('escalatedTo', 'name')
      .lean(),
    StoreComplaint.countDocuments(filter),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const transitionComplaint = async (complaintId, to, { outlet, actor, resolution, resolutionNotes, escalatedTo } = {}) => {
  const StoreComplaint = mongoose.model('StoreComplaint');
  const query = outlet ? { _id: complaintId, outlet } : { _id: complaintId };
  const complaint = await StoreComplaint.findOne(query);
  if (!complaint) throw new ApiError(httpStatus.NOT_FOUND, 'Complaint not found');

  // Check if transition is allowed
  const allowed = {
    open: ['in_progress', 'resolved', 'closed', 'escalated'],
    in_progress: ['resolved', 'closed', 'escalated', 'open'],
    resolved: ['closed', 'open'],
    closed: ['open'],
    escalated: ['in_progress', 'resolved', 'closed'],
  };
  if (!allowed[complaint.status]?.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_COMPLAINT_MOVE: ${complaint.status} -> ${to} is not allowed`);
  }

  const from = complaint.status;
  complaint.status = to;

  if (resolution) complaint.resolution = resolution;
  if (resolutionNotes) complaint.resolutionNotes = resolutionNotes;
  if (escalatedTo) {
    complaint.escalatedTo = escalatedTo;
    complaint.escalatedAt = new Date();
  }
  if (to === 'resolved' || to === 'closed') {
    complaint.resolvedAt = new Date();
    complaint.resolvedBy = actor;
  }
  if (to === 'escalated') {
    complaint.escalatedAt = new Date();
    complaint.escalatedTo = escalatedTo;
  }

  complaint.history = complaint.history || [];
  complaint.history.push({ from, to, by: actor, at: new Date() });

  await complaint.save();
  return complaint;
};

const listCustomerComplaints = async (customerId, { page = 1, limit = 20 }) => {
  const StoreComplaint = mongoose.model('StoreComplaint');
  const [items, total] = await Promise.all([
    StoreComplaint.find({ customer: customerId }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('order', 'orderNo')
      .populate('product', 'name')
      .populate('outlet', 'name outletCode')
      .lean(),
    StoreComplaint.countDocuments({ customer: customerId }),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const getOpenComplaints = async (outletId) => {
  return mongoose.model('StoreComplaint').findOpen(outletId);
};

const getComplaintsByOutlet = async (outletId, { status } = {}) => {
  return mongoose.model('StoreComplaint').findByOutlet(outletId, { status });
};

module.exports = {
  createComplaint,
  getComplaint,
  listComplaints,
  transitionComplaint,
  listCustomerComplaints,
  getOpenComplaints,
  getComplaintsByOutlet,
  // Exported so callers (and suites) can validate client-side without a round trip.
  // Matches stores.warranty.service.js, which already exports its own table.
  assertTransition,
  COMPLAINT_TRANSITIONS,
};