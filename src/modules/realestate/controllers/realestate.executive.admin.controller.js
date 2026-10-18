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
const RealEstateExecutive = require('../models/realestate.executive.model');
const RealEstateVisitRequest = require('../models/realestate.visit.request.model');
const RealEstateVisit = require('../models/realestate.visit.model');
const RealEstateAuditLog = require('../models/realestate.audit.log.model');
const assignmentService = require('../services/realestate.assignment.service');

/**
 * Admin executive management (plan §10.2 row 14 + row 15).
 *
 * The executive surface is read-only here — the executive themselves
 * update location/availability through their own authenticated routes.
 * Admin sees the pool (filterable by city/availability), can flip the
 * `available` flag, and can mark `status: ACTIVE | SUSPENDED | TERMINATED`.
 */

const listExecutives = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.available !== undefined) {
    filter.available = req.query.available === 'true';
  }
  if (req.query.city) filter.city = req.query.city;
  const list = await RealEstateExecutive.find(filter)
    .sort({ available: -1, lastAssignedAt: 1 })
    .limit(200)
    .lean();
  res.status(httpStatus.OK).send({ results: list });
});

const updateExecutiveAvailability = catchAsync(async (req, res) => {
  const updated = await RealEstateExecutive.findByIdAndUpdate(
    req.params.id,
    { $set: { available: !!req.body.available, updatedAt: new Date() } },
    { new: true }
  );
  if (!updated) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Executive not found' });
  }
  res.status(httpStatus.OK).send({ data: updated });
});

const updateExecutiveStatus = catchAsync(async (req, res) => {
  const updated = await RealEstateExecutive.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        status: req.body.status,
        statusReason: req.body.reason || '',
        updatedAt: new Date(),
      },
    },
    { new: true }
  );
  if (!updated) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Executive not found' });
  }
  res.status(httpStatus.OK).send({ data: updated });
});

module.exports = {
  listExecutives,
  updateExecutiveAvailability,
  updateExecutiveStatus,
};

/**
 * Assignment queue (plan §10.2 row 15, §10.3).
 *
 * PENDING_ASSIGNMENT visit requests with populated property/lead/
 * customer names — the backlog the auto-engine could not place plus
 * the items an admin may want to override. Paginated, newest first.
 */
const listVisitRequests = catchAsync(async (req, res) => {
  const filter = {};
  if (req.query.status) {
    filter.status = req.query.status;
  } else {
    filter.status = 'PENDING_ASSIGNMENT';
  }
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);
  const result = await RealEstateVisitRequest.paginate(filter, {
    page,
    limit,
    sort: { createdAt: -1 },
    populate: [
      { path: 'property', select: 'title propertyCode location operationalZone' },
      { path: 'lead', select: 'status customer property' },
      { path: 'customer', select: 'firstName lastName mobile' },
      { path: 'executive', select: 'name mobile' },
    ],
  });
  res.status(httpStatus.OK).send(result);
});

/**
 * Auto-assignment preview — what the engine *would* do, without writing.
 * Lets the admin see the pick before overriding it (§10.3).
 */
const previewAssignment = catchAsync(async (req, res) => {
  const request = await RealEstateVisitRequest.findById(req.params.id)
    .populate('property', 'operationalZone title propertyCode')
    .lean();
  if (!request) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Visit request not found' });
  }
  if (request.status !== 'PENDING_ASSIGNMENT') {
    return res.status(httpStatus.OK).send({ suggested: null, reason: `Request is ${request.status}` });
  }
  const zone = (request.property && request.property.operationalZone) || null;
  const suggested = await assignmentService.pickExecutive({ zone });
  if (!suggested) {
    return res.status(httpStatus.OK).send({ suggested: null, reason: 'No eligible executive' });
  }
  const active = await RealEstateVisit.countDocuments({
    executive: suggested._id,
    status: { $in: ['ASSIGNED', 'ACCEPTED', 'CHECK_IN', 'IN_PROGRESS'] },
  });
  res.status(httpStatus.OK).send({
    suggested: {
      _id: suggested._id,
      name: suggested.name,
      mobile: suggested.mobile,
      operationalZone: suggested.operationalZone,
      activeLoad: active,
      maxConcurrentVisits: suggested.maxConcurrentVisits || 5,
      lastAssignedAt: suggested.lastAssignedAt,
    },
    reason: zone ? 'same-zone match' : 'city fallback',
  });
});

/**
 * Manual override of auto-assignment (BR-07: reassignment recorded,
 * never silently overwritten).
 *
 * Only PENDING_ASSIGNMENT requests can be assigned here. The chosen
 * executive must be ACTIVE + available + below maxConcurrentVisits.
 * Creates the ASSIGNED visit via the shared path so cron/customer flows
 * cannot drift, then audits with actor=admin.
 */
const assignVisitRequestOverride = catchAsync(async (req, res) => {
  const request = await RealEstateVisitRequest.findById(req.params.id);
  if (!request) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Visit request not found' });
  }
  if (request.status !== 'PENDING_ASSIGNMENT') {
    return res
      .status(httpStatus.BAD_REQUEST)
      .send({ message: `Only PENDING_ASSIGNMENT requests can be assigned (is ${request.status})` });
  }
  const exec = await RealEstateExecutive.findById(req.body.executiveId);
  if (!exec) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Executive not found' });
  }
  if (exec.status !== 'ACTIVE' || !exec.available) {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Executive is not assignable (must be ACTIVE + available)' });
  }
  const active = await RealEstateVisit.countDocuments({
    executive: exec._id,
    status: { $in: ['ASSIGNED', 'ACCEPTED', 'CHECK_IN', 'IN_PROGRESS'] },
  });
  if (active >= (exec.maxConcurrentVisits || 5)) {
    return res.status(httpStatus.BAD_REQUEST).send({ message: 'Executive is at max concurrent visits' });
  }
  const RealEstateProperty = require('../models/realestate.property.model');
  const prop = await RealEstateProperty.findById(request.property).select('operationalZone');
  const visit = await RealEstateVisit.create({
    property: request.property,
    customer: request.customer,
    lead: request.lead,
    executive: exec._id,
    request: request._id,
    status: 'ASSIGNED',
    scheduledAt: request.preferredDate || new Date(),
    checkInRadiusMeters: request.checkInRadiusMeters || 200,
  });
  const prevExec = request.executive || null;
  request.status = 'ASSIGNED';
  request.executive = exec._id;
  request.visit = visit._id;
  await request.save();
  exec.lastAssignedAt = new Date();
  await exec.save();
  try {
    await RealEstateAuditLog.create({
      eventType: prevExec ? 'EXECUTIVE_REASSIGNED' : 'EXECUTIVE_ASSIGNED',
      targetType: 'Visit',
      targetId: visit._id,
      actor: req.user && (req.user._id || req.user.id) ? req.user._id || req.user.id : undefined,
      actorType: 'ADMIN',
      reason: 'manual assignment override',
      before: { executive: prevExec, status: 'PENDING_ASSIGNMENT' },
      after: { executive: exec._id, status: 'ASSIGNED' },
      metadata: { request: request._id, visit: visit._id },
    });
  } catch (e) {
    /* audit-only */
  }
  res.status(httpStatus.OK).send({ request, visit });
});

module.exports.listVisitRequests = listVisitRequests;
module.exports.previewAssignment = previewAssignment;
module.exports.assignVisitRequestOverride = assignVisitRequestOverride;
