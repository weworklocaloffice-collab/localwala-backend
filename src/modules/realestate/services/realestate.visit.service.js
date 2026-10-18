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

const RealEstateVisit = require('../models/realestate.visit.model');
const RealEstateVisitRequest = require('../models/realestate.visit.request.model');
const RealEstateInterest = require('../models/realestate.interest.model');
const RealEstateFollowUp = require('../models/realestate.followup.model');
const RealEstateProperty = require('../models/realestate.property.model');
const RealEstateLead = require('../models/realestate.lead.model');
const geographicService = require('../../../kernel/geographic/services/geographic.service');
const fcmNotificationService = require('../../../services/fcm.notification.service');
const leadService = require('./realestate.lead.service');
const assignmentService = require('./realestate.assignment.service');
// Aliased: this file has its own `canTransition(from, to)` for
// VISIT_TRANSITIONS — the state-machine import serves LEAD_TRANSITIONS.
const { LEAD_TRANSITIONS, canTransition: canLeadTransition } = require('../utils/realestate.state.machine');
const ApiError = require('../../../utils/ApiError');
const { status: httpStatus } = require('http-status');

/**
 * Best-effort customer notify for a visit. Resolves customer via the
 * visit's lead; every failure is swallowed — a notification must never
 * break a visit action (Phase 10).
 */
async function notifyVisitCustomer(visit, eventType, title, body) {
  try {
    const RealEstateLead = require('../models/realestate.lead.model');
    const lead = visit.lead && (await RealEstateLead.findById(visit.lead).select('customer').lean());
    if (!lead || !lead.customer) return;
    await fcmNotificationService[eventType === 'VISIT_COMPLETED' ? 'realEstateVisitCompleted' : 'realEstateVisitAssigned']({
      userId: lead.customer,
      recipientType: 'CUSTOMER',
      title,
      body,
      data: { visitId: String(visit._id), leadId: String(visit.lead) },
    });
  } catch (e) {
    /* notify-only */
  }
}


/**
 * Visit service — check-in, interest, follow-up.
 *
 * Exported functions:
 *   - checkIn(visitId, executiveLocation)      → BR-08 geofenced check-in
 *   - recordInterest(visitId, payload)         → BR-09 structured interest
 *   - createFollowUp(leadId, payload)         → follow-up task
 *   - completeFollowUp(followUpId, executiveId) → mark complete
 *   - findVisits(filters)                     → list visits
 */

/**
 * Geofenced check-in (BR-08).
 *
 * An executive cannot self-report a visit without a geolocation-verified
 * check-in. The check-in coordinates must be inside `checkInRadiusMeters`
 * of the property.
 *
 * @param {mongoose.Types.ObjectId} visitId
 * @param {Object} executiveLocation — { coordinates: [lng, lat] }
 * @returns {Promise<Object>} the updated visit document
 */
async function checkIn(visitId, executiveLocation) {
  const visit = await RealEstateVisit.findById(visitId);
  if (!visit) throw new Error('Visit not found');

  if (visit.status !== 'ACCEPTED') {
    throw new Error(`Cannot check in to a visit in "${visit.status}" status`);
  }

  const prop = await RealEstateProperty.findById(visit.property);
  if (!prop) throw new Error('Property not found');

  // Compute distance using haversine
  const distanceMeters = geographicService.haversineMeters(
    executiveLocation.coordinates[1], // lat
    executiveLocation.coordinates[0], // lng
    prop.location.coordinates[1],     // lat
    prop.location.coordinates[0]      // lng
  );

  if (distanceMeters > visit.checkInRadiusMeters) {
    throw new Error(
      `Check-in rejected: ${Math.round(distanceMeters)}m from property, ` +
      `max allowed ${visit.checkInRadiusMeters}m`
    );
  }

  visit.status = 'CHECK_IN';
  visit.checkIn = {
    coordinates: executiveLocation.coordinates,
    timestamp: new Date(),
    distanceMeters: Math.round(distanceMeters),
  };
  visit.startedAt = new Date();

  await visit.save();
  return visit;
}

/**
 * Record structured customer interest (BR-09).
 *
 * @param {mongoose.Types.ObjectId} visitId
 * @param {Object} payload — { level, reason?, reasonText?, recordedBy }
 * @returns {Promise<Object>} the saved interest document
 */
async function recordInterest(visitId, payload) {
  const { level, reason, reasonText, recordedBy } = payload;

  // Validate reason requirements
  if ((level === 'NOT_INTERESTED' || level === 'MAYBE_FOLLOW_UP') && !reason) {
    throw new Error(`Reason is required for interest level "${level}"`);
  }
  if (reason === 'OTHER' && !reasonText) {
    throw new Error('reasonText is required when reason is OTHER');
  }

  const visit = await RealEstateVisit.findById(visitId);
  if (!visit) throw new Error('Visit not found');

  const interest = new RealEstateInterest({
    visit: visitId,
    lead: visit.lead,
    level,
    reason,
    reasonText,
    recordedBy,
  });

  await interest.save();
  // Phase 10: vendor sees structured interest on their listing. Best-effort.
  try {
    const RealEstateLead = require('../models/realestate.lead.model');
    const lead = visit.lead && (await RealEstateLead.findById(visit.lead).select('vendor property').lean());
    const RealEstateVendor = require('../models/realestate.vendor.model');
    const vendor = lead && lead.vendor && (await RealEstateVendor.findById(lead.vendor).select('user').lean());
    if (vendor && vendor.user) {
      await fcmNotificationService.realEstateInterestRecorded({
        userId: vendor.user,
        recipientType: 'VENDOR',
        title: 'Customer interest recorded',
        body: `Interest ${level} recorded on your listing.`,
        data: { visitId: String(visitId), leadId: String(visit.lead) },
      });
    }
  } catch (e) {
    /* notify-only */
  }
  return interest;
}

/**
 * Create a follow-up task.
 *
 * @param {mongoose.Types.ObjectId} leadId
 * @param {Object} payload — { executive, nextFollowUpAt, mode, notes? }
 * @returns {Promise<Object>} the saved follow-up document
 */
async function createFollowUp(leadId, payload) {
  const { executive, nextFollowUpAt, mode, notes } = payload;

  const followUp = new RealEstateFollowUp({
    lead: leadId,
    executive,
    nextFollowUpAt,
    mode,
    notes,
    status: 'PENDING',
  });

  await followUp.save();
  return followUp;
}

/**
 * Complete a follow-up.
 *
 * @param {mongoose.Types.ObjectId} followUpId
 * @param {mongoose.Types.ObjectId} executiveId
 * @returns {Promise<Object>} the updated follow-up document
 */
async function completeFollowUp(followUpId, executiveId) {
  const followUp = await RealEstateFollowUp.findById(followUpId);
  if (!followUp) throw new Error('Follow-up not found');

  if (followUp.status !== 'PENDING') {
    throw new Error(`Cannot complete a follow-up in "${followUp.status}" status`);
  }

  followUp.status = 'COMPLETED';
  followUp.completedAt = new Date();
  followUp.completedBy = executiveId;

  await followUp.save();
  return followUp;
}

/**
 * Allowed visit status transitions.
 *
 * Doc §0.0: "State transitions live in a table in the service, are allow-listed a second
 * time in Joi, and the target state is a route parameter." This is the service-side table;
 * `realestate.executive.validation.js` holds the second copy.
 *
 * `ASSIGNED → ACCEPTED` is the executive accepting an assigned slot. Check-in then requires
 * `ACCEPTED`, which is what makes BR-08 meaningful: there is no path from `ASSIGNED` to
 * `COMPLETED`, so a visit cannot be reported without passing the geofence first.
 *
 * `CANCELLED` is terminal, and `COMPLETED` is terminal — a finished site visit is a fact,
 * not a state that gets edited. Correcting one is a compensating record, never an update
 * (BR-21: nothing with a visit against it is ever hard-deleted).
 */
const VISIT_TRANSITIONS = {
  ASSIGNED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['CHECK_IN', 'CANCELLED'],
  CHECK_IN: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Whether `from → to` is a legal move.
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function canTransition(from, to) {
  const allowed = VISIT_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Assert a transition, or throw with the reachable states named.
 *
 * The message lists what *was* allowed on purpose: "cannot go to COMPLETED" tells an
 * executive debugging a flaky app nothing, whereas "try one of CHECK_IN, IN_PROGRESS"
 * tells them what the API will accept next.
 *
 * @param {string} from
 * @param {string} to
 * @throws {Error}
 */
function assertTransition(from, to) {
  if (canTransition(from, to)) return;
  const allowed = VISIT_TRANSITIONS[from] || [];
  throw new Error(
    allowed.length
      ? `Cannot move a visit from "${from}" to "${to}". Allowed from "${from}": ${allowed.join(', ')}.`
      : `Visit is already "${from}" and cannot change.`
  );
}

/**
 * Accept an assigned visit.
 *
 * @param {mongoose.Types.ObjectId} visitId
 * @param {mongoose.Types.ObjectId} executiveId — must own the visit
 * @returns {Promise<Object>}
 */
async function acceptVisit(visitId, executiveId) {
  const visit = await RealEstateVisit.findById(visitId);
  if (!visit) throw new Error('Visit not found');

  if (String(visit.executive) !== String(executiveId)) {
    throw new Error('This visit is assigned to a different executive');
  }

  assertTransition(visit.status, 'ACCEPTED');
  visit.status = 'ACCEPTED';
  await visit.save();
  await notifyVisitCustomer(visit, 'VISIT_ASSIGNED', 'Visit accepted', 'Your site visit was accepted by the executive.');
  return visit;
}

/**
 * Complete a visit.
 *
 * Refuses unless a geofenced check-in is already on the record — BR-08. The check is here
 * rather than only in `checkIn` so that no future route can complete a visit by writing
 * `status` directly.
 *
 * @param {mongoose.Types.ObjectId} visitId
 * @param {mongoose.Types.ObjectId} executiveId
 * @param {string} [notes]
 * @returns {Promise<Object>}
 */
async function completeVisit(visitId, executiveId, notes) {
  const visit = await RealEstateVisit.findById(visitId);
  if (!visit) throw new Error('Visit not found');

  if (String(visit.executive) !== String(executiveId)) {
    throw new Error('This visit is assigned to a different executive');
  }

  if (!visit.checkIn || !visit.checkIn.timestamp) {
    throw new Error('Cannot complete a visit without a geofenced check-in (BR-08)');
  }

  assertTransition(visit.status, 'COMPLETED');
  visit.status = 'COMPLETED';
  visit.completedAt = new Date();
  if (notes !== undefined) visit.notes = notes;
  await visit.save();
  await notifyVisitCustomer(visit, 'VISIT_COMPLETED', 'Visit completed', 'Your site visit is complete. Record your interest with the executive.');
  return visit;
}

/**
 * Cancel a visit.
 *
 * @param {mongoose.Types.ObjectId} visitId
 * @param {mongoose.Types.ObjectId} actorId
 * @param {string} reason
 * @returns {Promise<Object>}
 */
async function cancelVisit(visitId, actorId, reason) {
  const visit = await RealEstateVisit.findById(visitId);
  if (!visit) throw new Error('Visit not found');

  if (String(visit.executive) !== String(actorId)) {
    throw new Error('This visit is assigned to a different executive');
  }

  if (!reason) throw new Error('A cancellation reason is required');

  assertTransition(visit.status, 'CANCELLED');
  visit.status = 'CANCELLED';
  visit.cancellationReason = reason;
  await visit.save();
  return visit;
}

/**
 * Find visits by criteria.
 *
 * @param {Object} filters — { lead, executive, customer, property, status }
 * @returns {Promise<Array>} array of visit documents
 */
async function findVisits(filters = {}) {
  const criteria = {};
  if (filters.lead) criteria.lead = filters.lead;
  if (filters.executive) criteria.executive = filters.executive;
  if (filters.customer) criteria.customer = filters.customer;
  if (filters.property) criteria.property = filters.property;
  if (filters.status) criteria.status = filters.status;

  // Vendor filter resolves to "visits on properties this vendor owns".
  // The visit does not carry a `vendor` field directly, so the
  // lookup goes through the property collection in a single
  // subquery — never a multi-query fan-out, never a $lookup.
  if (filters.vendor) {
    const RealEstateProperty = require('../models/realestate.property.model');
    const propertyIds = await RealEstateProperty.find({ vendor: filters.vendor })
      .select('_id')
      .lean();
    criteria.property = { $in: propertyIds.map((p) => p._id) };
  }

  return RealEstateVisit.find(criteria)
    .sort({ scheduledAt: -1 })
    // Customer + property names for list rows. Only non-money fields are
    // selected, so lean stays paise-free (money-edges gate).
    .populate('customer', 'firstName lastName mobile')
    .populate('property', 'title addressLine mapAddress')
    .lean();
}

/**
 * One visit, scoped to the executive who owns it.
 *
 * Scoping in the query rather than after the fetch means a wrong id yields the same 404
 * as a missing id, so the endpoint cannot be used to probe which visit ids exist.
 *
 * @param {mongoose.Types.ObjectId} visitId
 * @param {mongoose.Types.ObjectId} executiveId
 * @returns {Promise<Object|null>}
 */
async function findVisitForExecutive(visitId, executiveId) {
  // Populated for the detail screen (property address, customer contact).
  // Only non-money fields are selected, so lean stays paise-free.
  return RealEstateVisit.findOne({ _id: visitId, executive: executiveId })
    .populate('customer', 'firstName lastName mobile')
    .populate('property', 'title addressLine mapAddress location')
    .populate('lead', 'leadCode status')
    .lean();
}

/**
 * One visit request, scoped to the customer who created it.
 *
 * Same 404-for-wrong-owner rule as the lead endpoints: scoping in
 * the query means a foreign id cannot be probed.
 *
 * @param {mongoose.Types.ObjectId} requestId
 * @param {mongoose.Types.ObjectId} customerId
 * @returns {Promise<Object|null>} populated request or null
 */
async function findVisitRequestForCustomer(requestId, customerId) {
  // Hydrated — populated `property.price` in rupees (money-edges gate [10j]).
  const doc = await RealEstateVisitRequest.findOne({ _id: requestId, customer: customerId })
    .populate({
      path: 'visit',
      select: 'status scheduledAt checkIn startedAt completedAt cancellationReason executive',
      populate: { path: 'executive', select: 'name mobile' },
    })
    .populate('property', 'title price pricePeriod transactionType availability locality city media')
    .populate('lead', 'leadCode status');
  return doc ? doc.toObject({ getters: true }) : null;
}

/**
 * This customer's visit requests, newest preferred date first.
 *
 * A request is the customer's view of a visit: it exists from the
 * moment the customer asks (PENDING_ASSIGNMENT) through every visit
 * state, so one list serves both "upcoming" and "past" without a
 * second query against the visits collection.
 *
 * @param {mongoose.Types.ObjectId} customerId
 * @param {Object} opts — { page, limit }
 * @returns {Promise<Object>} { results, page, limit, total }
 */
async function listVisitRequestsForCustomer(customerId, { page = 1, limit = 20 } = {}) {
  const filter = { customer: customerId };
  const [docs, total] = await Promise.all([
    RealEstateVisitRequest.find(filter)
      .sort({ preferredDate: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: 'visit',
        select: 'status scheduledAt checkIn startedAt completedAt cancellationReason executive',
        populate: { path: 'executive', select: 'name mobile' },
      })
      .populate('property', 'title price pricePeriod transactionType availability locality city media')
      .populate('lead', 'leadCode status'),
    RealEstateVisitRequest.countDocuments(filter),
  ]);
  // Hydrated, not `.lean()` — the populated `property.price` is a moneyField
  // and a lean read ships it in paise. Getters apply to populated subdocs
  // too (money-edges gate [10i]).
  const results = docs.map((d) => d.toObject({ getters: true }));
  return { results, page, limit, total };
}

/**
 * Statuses that mean "this lead already has a live visit in flight".
 * A second request while one of these is open would create two
 * executives racing to the same doorstep.
 */
const OPEN_REQUEST_STATUSES = ['PENDING_ASSIGNMENT', 'ASSIGNED', 'ACCEPTED', 'CHECK_IN', 'IN_PROGRESS'];

/**
 * Customer asks to visit a property behind one of their leads.
 *
 * What happens, in order:
 *   1. Ownership: the lead must belong to this customer (404 otherwise).
 *   2. One open request per lead (409) — no double-booking.
 *   3. No past dates (400) — the form offers today and later.
 *   4. Property must still be available (409) — SOLD/RENTED cannot be visited.
 *   5. The request row is created PENDING_ASSIGNMENT.
 *   6. Lead activity `VISIT_REQUESTED` is recorded; the lead's status
 *      advances only when LEAD_TRANSITIONS sanctions the move (BR-03) —
 *      a NEW lead records the activity without inventing a hop.
 *   7. Immediate assignment when `autoAssignVisitRequests` is on;
 *      any failure leaves the row queued for the cron sweep.
 *   8. Customer confirmation push — best-effort, never throws.
 *
 * @param {Object} payload — { customer, leadId, preferredDate, preferredTimeSlot, note? }
 * @returns {Promise<Object>} the created visit request document
 */
async function createVisitRequest({ customer, leadId, preferredDate, preferredTimeSlot, note = '' }) {
  const lead = await RealEstateLead.findOne({ _id: leadId, customer });
  if (!lead) throw new ApiError(httpStatus.NOT_FOUND, 'Enquiry not found');

  if (['LOST', 'SALE'].includes(lead.status)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `This enquiry is already "${lead.status}" and cannot request a visit`
    );
  }

  const open = await RealEstateVisitRequest.findOne({
    lead: lead._id,
    status: { $in: OPEN_REQUEST_STATUSES },
  });
  if (open) {
    throw new ApiError(httpStatus.CONFLICT, 'You already have an open visit request for this enquiry');
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (new Date(preferredDate) < startOfToday) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A visit cannot be requested for a past date');
  }

  const prop = await RealEstateProperty.findById(lead.property).select('title availability');
  if (prop && ['SOLD', 'RENTED'].includes(prop.availability)) {
    throw new ApiError(httpStatus.CONFLICT, 'This property is no longer available to visit');
  }

  const request = await RealEstateVisitRequest.create({
    property: lead.property,
    customer,
    lead: lead._id,
    preferredDate,
    preferredTimeSlot,
  });

  // The status flip happens only for a table-sanctioned move; for
  // every other lead state the activity is an annotation (toStatus
  // omitted → snapshot of the current status), which is exactly the
  // shape `recordActivity` documents for annotate-only callers.
  const advancing = canLeadTransition(LEAD_TRANSITIONS, lead.status, 'VISIT_REQUESTED');
  await leadService.recordActivity(
    lead._id,
    'VISIT_REQUESTED',
    customer,
    'CUSTOMER',
    { visitRequest: request._id, preferredDate, preferredTimeSlot, note },
    advancing ? 'VISIT_REQUESTED' : undefined
  );
  if (advancing) {
    lead.status = 'VISIT_REQUESTED';
    await lead.save();
  }

  // Immediate assignment — settings-gated, best-effort. On any
  // failure the request stays PENDING_ASSIGNMENT and the cron
  // sweep retries, so the customer's request is never lost.
  try {
    const RealEstateSetting = require('../models/realestate.setting.model');
    const settings = await RealEstateSetting.findOne();
    if (!settings || settings.autoAssignVisitRequests !== false) {
      await assignmentService.assignVisitRequest(request);
    }
  } catch (e) {
    /* queued for the sweep */
  }

  try {
    await fcmNotificationService.realEstateVisitRequested({
      userId: customer,
      recipientType: 'CUSTOMER',
      title: 'Visit request received',
      body: `We received your visit request for ${prop && prop.title ? prop.title : 'the property'}.`,
      data: { visitRequestId: String(request._id), leadId: String(lead._id) },
    });
  } catch (e) {
    /* notify-only */
  }

  return request;
}

module.exports = {
  VISIT_TRANSITIONS,
  canTransition,
  assertTransition,
  checkIn,
  acceptVisit,
  completeVisit,
  cancelVisit,
  recordInterest,
  createFollowUp,
  completeFollowUp,
  findVisits,
  findVisitForExecutive,
  createVisitRequest,
  listVisitRequestsForCustomer,
  findVisitRequestForCustomer,
};
