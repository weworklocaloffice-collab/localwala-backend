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

const RealEstateExecutive = require('../models/realestate.executive.model');
const RealEstateVisit = require('../models/realestate.visit.model');
const RealEstateProperty = require('../models/realestate.property.model');
const fcmNotificationService = require('../../../services/fcm.notification.service');
const { DEFAULT_CHECK_IN_RADIUS_METERS } = require('../utils/realestate.geo');

/**
 * Assignment engine (plan §5.5): score eligible executives by
 * (a) same operational zone, (b) active load below
 * maxConcurrentVisits, (c) available flag, (d) round-robin on
 * least-recently-assigned. Falls back to any available executive in
 * the city. Nobody available → stays PENDING_ASSIGNMENT, admin
 * notified — never silently fails.
 */
async function pickExecutive({ zone, city }) {
  const base = { status: 'ACTIVE', available: true };
  let candidates = await RealEstateExecutive.find(zone ? { ...base, operationalZone: zone } : base)
    .sort({ lastAssignedAt: 1 })
    .limit(20);
  if (!candidates.length && zone) {
    candidates = await RealEstateExecutive.find(base).sort({ lastAssignedAt: 1 }).limit(20);
  }
  for (const c of candidates) {
    const active = await RealEstateVisit.countDocuments({
      executive: c._id,
      status: { $in: ['ASSIGNED', 'ACCEPTED', 'CHECK_IN', 'IN_PROGRESS'] },
    });
    if (active < (c.maxConcurrentVisits || 5)) return c;
  }
  return null;
}

/**
 * Assign one PENDING_ASSIGNMENT visit request: pick an executive,
 * create the ASSIGNED visit, flip the request, bump the executive's
 * round-robin cursor.
 *
 * Shared by the cron sweep (`realestate.cron.service.sweepAssignments`)
 * and the customer's visit-request creation path, so an immediate
 * assignment and the background sweep can never drift into two
 * different assignment behaviours.
 *
 * Returns the created visit, or `null` when nobody is eligible — the
 * request then stays PENDING_ASSIGNMENT and the admin dashboard shows
 * the backlog (never a silent failure).
 *
 * The executive's FCM push is best-effort: a push failure must not
 * undo an assignment that is already persisted.
 *
 * @param {Object} request — a RealEstateVisitRequest document
 * @returns {Promise<Object|null>} the created visit
 */
async function assignVisitRequest(request) {
  const prop = await RealEstateProperty.findById(request.property).select('operationalZone');
  const exec = await pickExecutive({ zone: (prop && prop.operationalZone) || null });
  if (!exec) return null;

  const visit = await RealEstateVisit.create({
    property: request.property,
    customer: request.customer,
    lead: request.lead,
    executive: exec._id,
    request: request._id,
    status: 'ASSIGNED',
    scheduledAt: request.preferredDate || new Date(),
    checkInRadiusMeters: request.checkInRadiusMeters || DEFAULT_CHECK_IN_RADIUS_METERS,
  });
  request.status = 'ASSIGNED';
  request.executive = exec._id;
  request.visit = visit._id;
  await request.save();
  exec.lastAssignedAt = new Date();
  await exec.save();

  // Phase 10: the assignee's queue changed. Notify-only — the
  // assignment above is already committed.
  try {
    await fcmNotificationService.realEstateVisitAssigned({
      userId: exec.user,
      recipientType: 'EXECUTIVE',
      title: 'Visit assigned',
      body: 'A site visit was assigned to you.',
      data: { visitId: String(visit._id), requestId: String(request._id) },
    });
  } catch (e) {
    /* notify-only */
  }
  return visit;
}

const realEstateAssignmentService = { pickExecutive, assignVisitRequest };

module.exports = realEstateAssignmentService;
