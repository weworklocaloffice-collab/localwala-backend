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
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const complaintService = require('../services/stores.complaint.service');

const createComplaint = catchAsync(async (req, res) => {
  const complaint = await complaintService.createComplaint({
    ...req.body,
    customer: req.user._id,
    outlet: req.outletId,
    chain: req.chainId,
  });
  res.status(httpStatus.CREATED).send({ complaint });
});

const getComplaint = catchAsync(async (req, res) => {
  const complaint = await complaintService.getComplaint(req.params.complaint, { outlet: req.outletId });
  res.status(httpStatus.OK).send({ complaint });
});

const listComplaints = catchAsync(async (req, res) => {
  const filter = { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 };
  if (req.outletId) filter.outlet = req.outletId;
  if (req.chainId) filter.chain = req.chainId;
  if (req.query.customer) filter.customer = req.query.customer;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.priority) filter.priority = req.query.priority;
  const result = await complaintService.listComplaints(filter);
  res.status(httpStatus.OK).send(result);
});

const transitionComplaint = catchAsync(async (req, res) => {
  const complaint = await complaintService.transitionComplaint(req.params.complaint, req.params.status, {
    outlet: req.outletId,
    actor: req.user._id,
    ...req.body,
  });
  res.status(httpStatus.OK).send({ complaint });
});

const listCustomerComplaints = catchAsync(async (req, res) => {
  const filter = { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 };
  const result = await complaintService.listCustomerComplaints(req.user._id, filter);
  res.status(httpStatus.OK).send(result);
});

const getOpenComplaints = catchAsync(async (req, res) => {
  const open = await complaintService.getOpenComplaints(req.outletId);
  res.status(httpStatus.OK).send({ open });
});

const getByOutlet = catchAsync(async (req, res) => {
  const complaints = await complaintService.getComplaintsByOutlet(req.outletId, { status: req.query.status });
  res.status(httpStatus.OK).send({ complaints });
});

module.exports = {
  createComplaint,
  getComplaint,
  listComplaints,
  transitionComplaint,
  listCustomerComplaints,
  getOpenComplaints,
  getByOutlet,
};