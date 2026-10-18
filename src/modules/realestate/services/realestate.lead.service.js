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

const RealEstateLead = require('../models/realestate.lead.model');
const RealEstateLeadActivity = require('../models/realestate.lead.activity.model');
const RealEstateReferral = require('../models/realestate.referral.model');
const RealEstateExecutive = require('../models/realestate.executive.model');
const RealEstateProperty = require('../models/realestate.property.model');
const fcmNotificationService = require('../../../services/fcm.notification.service');

/**
 * Lead service — creation, assignment, reassignment, lifecycle.
 *
 * Exported functions:
 *   - createLeadFromEnquiry(payload)       → BR-06: enquiry creates a lead
 *   - createLeadFromReferral(payload)      → referral code attribution
 *   - reassignLead(leadId, newExecutiveId, actorId, reason)  → BR-07
 *   - recordActivity(leadId, action, actorId, metadata)      → audit trail
 *   - findLeads(filters)                  → list leads by criteria
 *   - getLeadDetail(leadId)                → lead + activity history
 *   - assignExecutive(leadId, executiveId) → assignment engine
 */

/**
 * Create a lead from a customer enquiry (BR-06).
 *
 * An enquiry is never a contact message — it always creates a Lead.
 * If a referral code is provided, a RealEstateReferral record is also created.
 *
 * @param {Object} payload — { property, customer, source?, referralCode?, referrer? }
 * @returns {Promise<Object>} the saved lead document
 */
async function createLeadFromEnquiry(payload) {
  const { property, customer, source = 'ENQUIRY', referralCode, referrer } = payload;

  // Validate property exists
  const prop = await RealEstateProperty.findById(property);
  if (!prop) {
    throw new Error('Property not found');
  }

  // Generate lead code
  const leadCode = `LEAD-${Date.now()}`;

  const lead = new RealEstateLead({
    leadCode,
    property,
    customer,
    vendor: prop.vendor,
    source,
    status: 'NEW',
    operationalZone: prop.operationalZone,
  });

  await lead.save();

  // Record creation activity
  await recordActivity(lead._id, 'CREATED', customer, 'CUSTOMER', {
    source,
    property: prop._id,
  });

  // If referral code provided, create referral record
  if (referralCode && referrer) {
    const referral = new RealEstateReferral({
      referralCode,
      referrer,
      lead: lead._id,
      property,
      customer,
      commissionRate: 10.0, // default rate, snapshot at time of use
      status: 'PENDING',
    });
    await referral.save();
    lead.referral = referral._id;
    await lead.save();
  }

  // Phase 10: customer-facing event. Never throws into lead creation.
  await fcmNotificationService.realEstateLeadCreated({
    userId: customer,
    recipientType: 'CUSTOMER',
    title: 'Enquiry received',
    body: `Your enquiry for ${prop.title || 'the property'} (${lead.leadCode}) is with our team.`,
    data: { leadId: String(lead._id), propertyId: String(property) },
  });

  return lead;
}

/**
 * Reassign a lead to a different executive (BR-07).
 *
 * The old executive is NOT overwritten — a LeadActivity row records
 * who was replaced, who replaced them, and why.
 *
 * @param {mongoose.Types.ObjectId} leadId
 * @param {mongoose.Types.ObjectId} newExecutiveId
 * @param {mongoose.Types.ObjectId} actorId — who is doing the reassignment
 * @param {string} reason — why
 * @returns {Promise<Object>} the updated lead document
 */
async function reassignLead(leadId, newExecutiveId, actorId, reason) {
  const lead = await RealEstateLead.findById(leadId);
  if (!lead) throw new Error('Lead not found');

  const oldExecutive = lead.executive;

  // Update the lead
  lead.executive = newExecutiveId;
  await lead.save();

  // Record the reassignment (BR-07)
  await recordActivity(lead._id, 'REASSIGNED', actorId, 'ADMIN', {
    reason,
    fromExecutive: oldExecutive,
    toExecutive: newExecutiveId,
  });

  // Phase 10: new assignee. Never throws into reassignment.
  const newExec = await RealEstateExecutive.findById(newExecutiveId).select('user').lean();
  await fcmNotificationService.realEstateLeadAssigned({
    userId: newExec && newExec.user,
    recipientType: 'EXECUTIVE',
    title: 'Lead reassigned to you',
    body: `Lead ${lead.leadCode} was reassigned to you.`,
    data: { leadId: String(lead._id) },
  });

  return lead;
}

/**
 * Record an activity on a lead (audit trail).
 *
 * ## `toStatus` had to be added
 *
 * The function re-reads the lead and set **both** `fromStatus` and `toStatus` to the status
 * it found, so a status change recorded as "NEW -> NEW". It was accurate only for
 * non-transition actions, where both should be the same.
 *
 * That made BR-20 unauditable for the case that matters: the customer withdrawing an
 * enquiry produced a `LOST` row reading `fromStatus: NEW, toStatus: NEW`, which does not
 * record that the lead was ever anything else.
 *
 * Callers that only annotate (a visit recorded, an interest captured) omit `toStatus` and
 * keep the snapshot behaviour. Callers that are about to change the status pass it, and
 * must therefore call this **before** saving the new status — the function reads the
 * current value, which is why the ordering matters.
 *
 * @param {mongoose.Types.ObjectId} leadId
 * @param {string} action — one of the LeadActivity action enum values
 * @param {mongoose.Types.ObjectId} actorId
 * @param {string} actorType — CUSTOMER | VENDOR | EXECUTIVE | BANK | ADMIN | SYSTEM
 * @param {Object} metadata — action-specific data
 * @param {string} [toStatus] — target status, when this action is a transition
 * @returns {Promise<Object>} the saved activity document
 */
async function recordActivity(leadId, action, actorId, actorType, metadata = {}, toStatus) {
  const lead = await RealEstateLead.findById(leadId);
  if (!lead) throw new Error('Lead not found');

  const activity = new RealEstateLeadActivity({
    lead: leadId,
    action,
    fromStatus: action === 'CREATED' ? null : lead.status,
    toStatus: toStatus === undefined ? lead.status : toStatus,
    actor: actorId,
    actorType,
    metadata,
  });

  await activity.save();
  return activity;
}

/**
 * Assignment engine — find the best executive for a lead.
 *
 * Scoring:
 *   1. Same operational zone as the property
 *   2. Active load below maxConcurrentVisits
 *   3. `available` flag is true
 *   4. Round-robin on least-recently-assigned
 *
 * Falls back to any available executive in the city. If nobody is available,
 * returns null — the lead stays unassigned and admin is notified.
 *
 * @param {mongoose.Types.ObjectId} propertyId
 * @returns {Promise<Object|null>} the best executive document, or null
 */
async function findBestExecutive(propertyId) {
  const prop = await RealEstateProperty.findById(propertyId);
  if (!prop) throw new Error('Property not found');

  // Find available executives in the same operational zone
  const executives = await RealEstateExecutive.find({
    operationalZone: prop.operationalZone,
    available: true,
  }).lean();

  if (executives.length === 0) {
    // Fallback: any available executive in the city
    const cityExecutives = await RealEstateExecutive.find({
      'city': prop.city,
      available: true,
    }).lean();

    if (cityExecutives.length === 0) {
      return null; // nobody available
    }

    // Return least-recently-assigned
    return cityExecutives.sort((a, b) => {
      return (a.lastAssignedAt || 0) - (b.lastAssignedAt || 0);
    })[0];
  }

  // Score: same zone + below max load + least recently assigned
  const scored = await Promise.all(
    executives.map(async (exec) => {
      const activeLeads = await RealEstateLead.countDocuments({
        executive: exec._id,
        status: { $nin: ['SALE', 'LOST'] },
      });
      const score = {
        executive: exec,
        sameZone: true,
        belowLoad: activeLeads < (exec.maxConcurrentVisits || 5),
        activeLeads,
        lastAssignedAt: exec.lastAssignedAt || 0,
      };
      return score;
    })
  );

  // Filter to those below max load, sort by least recently assigned
  const eligible = scored
    .filter((s) => s.belowLoad)
    .sort((a, b) => a.lastAssignedAt - b.lastAssignedAt);

  return eligible.length > 0 ? eligible[0].executive : null;
}

/**
 * Assign an executive to a lead using the assignment engine.
 *
 * @param {mongoose.Types.ObjectId} leadId
 * @returns {Promise<Object>} the updated lead document
 */
async function assignExecutive(leadId) {
  const lead = await RealEstateLead.findById(leadId);
  if (!lead) throw new Error('Lead not found');

  const executive = await findBestExecutive(lead.property);
  if (!executive) {
    // Nobody available — lead stays unassigned, admin notified elsewhere
    return lead;
  }

  const oldExecutive = lead.executive;
  lead.executive = executive._id;
  await lead.save();

  // Update executive's last assigned timestamp
  await RealEstateExecutive.findByIdAndUpdate(executive._id, {
    lastAssignedAt: new Date(),
  });

  // Record the assignment
  await recordActivity(lead._id, oldExecutive ? 'REASSIGNED' : 'CREATED', executive._id, 'SYSTEM', {
    fromExecutive: oldExecutive,
    toExecutive: executive._id,
    autoAssigned: true,
  });

  // Phase 10: the assignee's queue changed. Never throws into assignment.
  await fcmNotificationService.realEstateLeadAssigned({
    userId: executive.user,
    recipientType: 'EXECUTIVE',
    title: 'New lead assigned',
    body: `Lead ${lead.leadCode} was assigned to you.`,
    data: { leadId: String(lead._id) },
  });

  return lead;
}

/**
 * Find leads by criteria.
 *
 * @param {Object} filters — { status, vendor, executive, customer, property }
 * @returns {Promise<Array>} array of lead documents
 */
async function findLeads(filters = {}) {
  const criteria = {};
  if (filters.status) criteria.status = filters.status;
  if (filters.vendor) criteria.vendor = filters.vendor;
  if (filters.executive) criteria.executive = filters.executive;
  if (filters.customer) criteria.customer = filters.customer;
  if (filters.property) criteria.property = filters.property;

  return RealEstateLead.find(criteria)
    .sort({ createdAt: -1 })
    // Customer + property are populated (names and titles for list rows).
    // `vendor` / `executive` stay raw ids on purpose: the controllers compare
    // them with String() for ownership, and a populated doc would break that.
    // Only non-money fields are selected, so lean stays paise-free.
    .populate('customer', 'firstName lastName mobile')
    .populate('property', 'title propertyCode')
    .lean();
}

/**
 * Get a lead with its full activity history plus the crossroads every
 * detail screen renders: visits, follow-ups, hold, sale and loan requests.
 *
 * `hold`, `sale` and loan requests carry moneyFields, so they are read
 * hydrated (`toObject({ getters: true })`) — a lean read would ship paise
 * (money-edges gate). Everything else is lean: no money, no getters.
 * `vendor` / `executive` stay raw ids — the controllers compare them with
 * String() for ownership.
 *
 * @param {mongoose.Types.ObjectId} leadId
 * @returns {Promise<Object>} lead + activities + visits + followUps + hold + sale + loanRequests
 */
async function getLeadDetail(leadId) {
  const lead = await RealEstateLead.findById(leadId)
    .populate('customer', 'firstName lastName mobile')
    .populate('property', 'title propertyCode')
    .lean();
  if (!lead) throw new Error('Lead not found');

  // Required inside the function, not at the top: visit.service already
  // requires this file, so top-level requires would circulate.
  const RealEstateVisit = require('../models/realestate.visit.model');
  const RealEstateFollowUp = require('../models/realestate.followup.model');
  const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
  const RealEstateSale = require('../models/realestate.sale.model');
  const RealEstateLoanRequest = require('../models/realestate.loan.request.model');

  const [activities, visits, followUps, holdDoc, saleDoc, loanDocs] = await Promise.all([
    RealEstateLeadActivity.find({ lead: leadId }).sort({ createdAt: -1 }).lean(),
    RealEstateVisit.find({ lead: leadId })
      .sort({ scheduledAt: -1 })
      .populate('executive', 'name mobile')
      .lean(),
    RealEstateFollowUp.find({ lead: leadId }).sort({ nextFollowUpAt: 1 }).lean(),
    lead.hold ? RealEstatePropertyHold.findById(lead.hold) : Promise.resolve(null),
    lead.sale ? RealEstateSale.findById(lead.sale) : Promise.resolve(null),
    RealEstateLoanRequest.find({ lead: leadId }).sort({ createdAt: -1 }),
  ]);

  return {
    ...lead,
    activities,
    visits,
    followUps,
    hold: holdDoc ? holdDoc.toObject({ getters: true }) : null,
    sale: saleDoc ? saleDoc.toObject({ getters: true }) : null,
    loanRequests: loanDocs.map((d) => d.toObject({ getters: true })),
  };
}

module.exports = {
  createLeadFromEnquiry,
  reassignLead,
  recordActivity,
  findBestExecutive,
  assignExecutive,
  findLeads,
  getLeadDetail,
};
