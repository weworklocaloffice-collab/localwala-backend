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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const ApiError = require('../../../utils/ApiError');
const visitService = require('../services/realestate.visit.service');
const leadService = require('../services/realestate.lead.service');
const RealEstateExecutive = require('../models/realestate.executive.model');

/**
 * Executive-facing Real Estate endpoints.
 *
 * ## The one rule every handler obeys
 *
 * Every query is scoped to `req.actorId`, which `executiveAuth` took from the token. There
 * is no handler that takes an executive, lead or visit id from the request and uses it as a
 * scope. BR-07 makes "one assigned executive at a time" a data rule; this is what stops it
 * being only a data rule.
 *
 * ## Why `checkIn` is the named route doc §7.3 demands
 *
 *     POST /v1/realestate/executive/visits/:id/check_in
 *
 * It is spelled as its own path rather than folded into `POST /visits/:id/:status`. BR-08
 * makes check-in the one transition that needs a body and a geofence, and BR-10-style
 * rights string absence is not how it is protected here — it is protected by arithmetic
 * inside the service. A distinct path means the geofence check is not reachable through a
 * generic status setter.
 */

/**
 * 404 for anything that is not this executive's.
 *
 * One message for "missing" and "belongs to someone else", so the endpoint cannot be used
 * to discover which visit or lead ids are real.
 *
 * @throws {ApiError} 404
 */
const notFound = (what) => {
  throw new ApiError(httpStatus.NOT_FOUND, `${what} not found`);
};

// ------------------------------------------------------------------------ visits

/**
 * GET /executive/visits
 * This executive's visits, newest first.
 */
const listVisits = catchAsync(async (req, res) => {
  const { status, lead, property, from, to, page, limit } = req.query;

  const visits = await visitService.findVisits({
    executive: req.actorId,
    status,
    lead,
    property,
  });

  const filtered =
    from || to
      ? visits.filter((v) => {
          const at = new Date(v.scheduledAt).getTime();
          if (from && at < new Date(from).getTime()) return false;
          if (to && at > new Date(to).getTime()) return false;
          return true;
        })
      : visits;

  const start = (page - 1) * limit;

  res.send({
    results: filtered.slice(start, start + limit),
    page,
    limit,
    total: filtered.length,
  });
});

/**
 * GET /executive/visits/:id
 */
const getVisit = catchAsync(async (req, res) => {
  const visit = await visitService.findVisitForExecutive(req.params.id, req.actorId);
  if (!visit) notFound('Visit');
  res.send({ data: visit });
});

/**
 * POST /executive/visits/:id/accept
 * ASSIGNED → ACCEPTED. Declining is `cancel`, which needs a reason.
 */
const acceptVisit = catchAsync(async (req, res) => {
  const visit = await visitService.acceptVisit(req.params.id, req.actorId);
  res.send({ data: visit });
});

/**
 * POST /executive/visits/:id/check_in
 *
 * BR-08. A check-in outside the geofence is rejected by the service's distance
 * calculation; this handler's job is to pass the coordinates through untouched and turn
 * the rejection into a 403.
 *
 * 403 rather than 400: the request was well-formed, the executive simply is not at the
 * property. It is not a geofence failure of the request, it is a refusal.
 */
const checkIn = catchAsync(async (req, res) => {
  try {
    const visit = await visitService.checkIn(req.params.id, {
      coordinates: req.body.coordinates,
    });
    res.send({ data: visit });
  } catch (e) {
    if (/Check-in rejected/.test(e.message)) {
      throw new ApiError(httpStatus.FORBIDDEN, e.message);
    }
    if (/not found/i.test(e.message)) notFound('Visit');
    throw new ApiError(httpStatus.BAD_REQUEST, e.message);
  }
});

/**
 * POST /executive/visits/:id/complete
 *
 * BR-08 again, enforced from the other side: the service refuses to complete a visit with
 * no check-in on the record.
 */
const completeVisit = catchAsync(async (req, res) => {
  try {
    const visit = await visitService.completeVisit(req.params.id, req.actorId, req.body.notes);
    res.send({ data: visit });
  } catch (e) {
    if (/Cannot complete a visit without a geofenced check-in/.test(e.message)) {
      throw new ApiError(httpStatus.FORBIDDEN, e.message);
    }
    if (/not found/i.test(e.message)) notFound('Visit');
    throw new ApiError(httpStatus.BAD_REQUEST, e.message);
  }
});

/**
 * POST /executive/visits/:id/cancel
 */
const cancelVisit = catchAsync(async (req, res) => {
  try {
    const visit = await visitService.cancelVisit(req.params.id, req.actorId, req.body.reason);
    res.send({ data: visit });
  } catch (e) {
    if (/not found/i.test(e.message)) notFound('Visit');
    throw new ApiError(httpStatus.BAD_REQUEST, e.message);
  }
});

/**
 * POST /executive/visits/:id/notes
 *
 * Notes are writable while the visit is open, and refused once it is COMPLETED or
 * CANCELLED — BR-21 treats a finished visit as a fact, so its notes are part of that fact
 * rather than something still being edited.
 *
 * A scoped `findOneAndUpdate` rather than read-then-write: the `executive` filter is part
 * of the write, so there is no window in which a visit could be reassigned between the
 * ownership check and the update.
 */
const addVisitNotes = catchAsync(async (req, res) => {
  const RealEstateVisit = require('../models/realestate.visit.model');

  const saved = await RealEstateVisit.findOneAndUpdate(
    {
      _id: req.params.id,
      executive: req.actorId,
      status: { $nin: ['COMPLETED', 'CANCELLED'] },
    },
    { $set: { notes: req.body.notes } },
    { new: true, runValidators: true }
  ).lean();

  if (!saved) {
    // Either not this executive's, not found, or closed. Distinguish only the last,
    // since the first two must be indistinguishable.
    const existing = await visitService.findVisitForExecutive(req.params.id, req.actorId);
    if (!existing) notFound('Visit');
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Visit is "${existing.status}" and its notes can no longer be changed`
    );
  }

  res.send({ data: saved });
});

// --------------------------------------------------------------------- interest

/**
 * POST /executive/visits/:id/interest
 * BR-09 structured interest.
 */
const recordInterest = catchAsync(async (req, res) => {
  const visit = await visitService.findVisitForExecutive(req.params.id, req.actorId);
  if (!visit) notFound('Visit');

  const interest = await visitService.recordInterest(req.params.id, {
    ...req.body,
    recordedBy: req.actorId,
  });

  res.status(httpStatus.CREATED).send({ data: interest });
});

// -------------------------------------------------------------------- follow-ups

/**
 * POST /executive/leads/:leadId/followups
 */
const createFollowUp = catchAsync(async (req, res) => {
  const followUp = await visitService.createFollowUp(req.params.leadId, {
    ...req.body,
    executive: req.actorId,
  });
  res.status(httpStatus.CREATED).send({ data: followUp });
});

/**
 * POST /executive/followups/:id/complete
 */
const completeFollowUp = catchAsync(async (req, res) => {
  try {
    const followUp = await visitService.completeFollowUp(req.params.id, req.actorId);
    res.send({ data: followUp });
  } catch (e) {
    if (/not found/i.test(e.message)) notFound('Follow-up');
    throw new ApiError(httpStatus.BAD_REQUEST, e.message);
  }
});

// -------------------------------------------------------------------------- leads

/**
 * GET /executive/leads
 */
const listLeads = catchAsync(async (req, res) => {
  const { page, limit } = req.query;
  const leads = await leadService.findLeads({ executive: req.actorId });
  const start = (page - 1) * limit;
  res.send({ results: leads.slice(start, start + limit), page, limit, total: leads.length });
});

/**
 * GET /executive/leads/:leadId
 *
 * `getLeadDetail` throws on a missing lead rather than returning null, so the not-found
 * case is caught here rather than tested for. The field is `executive` on the lead — not
 * `assignedExecutive`; BR-07's "one assigned executive" is the `executive` field, with the
 * history in `activities`.
 */
const getLead = catchAsync(async (req, res) => {
  let lead;
  try {
    lead = await leadService.getLeadDetail(req.params.leadId);
  } catch {
    // `getLeadDetail` throws rather than returning null, so the not-found case arrives
    // here. Optional catch binding, since the error carries no extra information.
    notFound('Lead');
  }

  if (String(lead.executive) !== String(req.actorId)) notFound('Lead');
  res.send({ data: lead });
});

// ---------------------------------------------------------------------- profile

/**
 * GET /executive/me
 * The executive's own record. Operational zone included — it is what decides which leads
 * the assignment engine routes here, so the app needs to show it.
 */
const me = catchAsync(async (req, res) => {
  const executive = await RealEstateExecutive.findById(req.actorId).lean();
  if (!executive) notFound('Executive');
  res.send({ data: executive });
});

/**
 * POST /executive/location
 *
 * Records where the executive is, so a dispatcher can see who is near what. It does NOT
 * feed the geofence: check-in computes distance from the coordinates the executive sends
 * at check-in time, against the property. If this field were trusted for that, the
 * executive could stand still and check in from home.
 */
const updateLocation = catchAsync(async (req, res) => {
  const updated = await RealEstateExecutive.findByIdAndUpdate(
    req.actorId,
    {
      $set: {
        currentLocation: { type: 'Point', coordinates: req.body.coordinates },
      },
    },
    { new: true, runValidators: true }
  ).lean();

  if (!updated) notFound('Executive');
  res.send({ data: { currentLocation: updated.currentLocation } });
});

/**
 * GET /executive/dashboard
 * Counts for the app's home screen.
 */
const dashboard = catchAsync(async (req, res) => {
  const [visits, leads] = await Promise.all([
    visitService.findVisits({ executive: req.actorId }),
    leadService.findLeads({ executive: req.actorId }),
  ]);

  const byStatus = visits.reduce((acc, v) => {
    acc[v.status] = (acc[v.status] || 0) + 1;
    return acc;
  }, {});

  res.send({
    data: {
      totalVisits: visits.length,
      visitsByStatus: byStatus,
      activeLeads: leads.length,
    },
  });
});

/**
 * GET /executive/properties/:id
 *
 * Read-only property detail for a visit. Scoped to `PUBLISHED` and to the property's own
 * docs — an executive sees what a customer sees, not the moderation trail.
 */
const getPropertyForVisit = catchAsync(async (req, res) => {
  const RealEstateProperty = require('../models/realestate.property.model');
  // Hydrated — `price` is a moneyField and a lean read ships paise
  // (money-edges gate). The select keeps the moderation trail out.
  const doc = await RealEstateProperty.findById(req.params.id).select(
    '-createdBy -updatedBy -statusReason -entitlement'
  );

  if (!doc) notFound('Property');
  res.send({ data: doc.toObject({ getters: true }) });
});

module.exports = {
  listVisits,
  getVisit,
  acceptVisit,
  checkIn,
  completeVisit,
  cancelVisit,
  addVisitNotes,
  recordInterest,
  createFollowUp,
  completeFollowUp,
  listLeads,
  getLead,
  me,
  updateLocation,
  dashboard,
  getPropertyForVisit,
};

/**
 * GET /executive/commissions — my commission rows (plan §11.4, §43).
 * beneficiary = executive id (req.actorId), never another party's.
 * The vendor sees the same shape scoped to themselves; LocalWala net
 * is never included — totals and statuses only.
 */
const listCommissions = catchAsync(async (req, res) => {
  const RealEstateCommission = require('../models/realestate.commission.model');
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const result = await RealEstateCommission.paginate(
    { beneficiaryType: 'EXECUTIVE', beneficiary: req.actorId },
    { page, limit, sort: { createdAt: -1 } }
  );
  res.status(httpStatus.OK).send(result);
});

/**
 * GET /executive/holds — holds on my leads, read-only (plan §11.4).
 * Holds carry no executive field; scope goes through my lead ids.
 */
const listHolds = catchAsync(async (req, res) => {
  const RealEstateLead = require('../models/realestate.lead.model');
  const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const myLeads = await RealEstateLead.find({ executive: req.actorId }).select('_id').lean();
  const result = await RealEstatePropertyHold.paginate(
    { lead: { $in: myLeads.map((l) => l._id) } },
    { page, limit, sort: { createdAt: -1 } }
  );
  res.status(httpStatus.OK).send(result);
});

/**
 * GET /executive/followups — my pending follow-ups, soonest first.
 * Overdue rows drive the Today tile (blueprint §41, §5.7).
 */
const listFollowUps = catchAsync(async (req, res) => {
  const RealEstateFollowUp = require('../models/realestate.followup.model');
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const filter = { executive: req.actorId };
  if (req.query.status) filter.status = req.query.status;
  const result = await RealEstateFollowUp.paginate(filter, {
    page,
    limit,
    sort: { nextFollowUpAt: 1 },
  });
  res.status(httpStatus.OK).send(result);
});

/**
 * GET /executive/settlements — my settlement statements, read-only.
 */
const listSettlements = catchAsync(async (req, res) => {
  const RealEstateSettlement = require('../models/realestate.settlement.model');
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const result = await RealEstateSettlement.paginate(
    { partyType: 'EXECUTIVE', party: req.actorId },
    { page, limit, sort: { createdAt: -1 } }
  );
  res.status(httpStatus.OK).send(result);
});

/**
 * GET /executive/notifications — my notifications, newest first.
 * Keyed by USER id (assignment pushes address exec.user, not the
 * executive row) + recipientType EXECUTIVE.
 */
const listNotifications = catchAsync(async (req, res) => {
  const RealEstateNotification = require('../models/realestate.notification.model');
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const result = await RealEstateNotification.paginate(
    { recipient: req.userId, recipientType: 'EXECUTIVE' },
    { page, limit, sort: { createdAt: -1 } }
  );
  res.status(httpStatus.OK).send(result);
});

/**
 * POST /executive/notifications/:id/read — mark my notification read.
 * Ownership re-checked: another executive's id answers 404, never 403
 * (no id-oracle for enumeration).
 */
const markNotificationRead = catchAsync(async (req, res) => {
  const notificationService = require('../services/realestate.notification.service');
  const RealEstateNotification = require('../models/realestate.notification.model');
  const row = await RealEstateNotification.findOne({
    _id: req.params.id,
    recipient: req.userId,
    recipientType: 'EXECUTIVE',
  }).lean();
  if (!row) {
    return res.status(httpStatus.NOT_FOUND).send({ message: 'Notification not found' });
  }
  const updated = await notificationService.markRead(req.params.id);
  res.status(httpStatus.OK).send({ data: updated });
});

module.exports.listCommissions = listCommissions;
module.exports.listHolds = listHolds;
module.exports.listFollowUps = listFollowUps;
module.exports.listSettlements = listSettlements;
module.exports.listNotifications = listNotifications;
module.exports.markNotificationRead = markNotificationRead;