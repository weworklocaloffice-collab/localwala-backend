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
 * Real Estate state machines — every transition table in one place.
 *
 * Rule: transitions live in a table here AND in the owning service
 * (which requires this file, so there is still exactly one table),
 * are allow-listed a second time in Joi, and the target state is a
 * route parameter. `status` (moderation) and `availability`
 * (commerce) never cross-write (BR-11).
 *
 * Property tables are copied verbatim from
 * `realestate.property.service.js` STATUS_TRANSITIONS,
 * AVAILABILITY_TRANSITIONS and STATUS_ACTORS. Visit table is copied
 * verbatim from `realestate.visit.service.js` VISIT_TRANSITIONS.
 * Do not edit one without the other — the service requires this file.
 */

// Moderation: DRAFT → SUBMITTED → IN_REVIEW → APPROVED → PUBLISHED …
const PROPERTY_STATUS_TRANSITIONS = Object.freeze({
  DRAFT: ['SUBMITTED', 'ARCHIVED'],
  SUBMITTED: ['IN_REVIEW', 'CHANGES_REQUIRED', 'REJECTED', 'ARCHIVED'],
  IN_REVIEW: ['APPROVED', 'CHANGES_REQUIRED', 'REJECTED', 'ARCHIVED'],
  APPROVED: ['PUBLISHED', 'CHANGES_REQUIRED', 'REJECTED', 'ARCHIVED'],
  CHANGES_REQUIRED: ['SUBMITTED', 'REJECTED', 'ARCHIVED'],
  PUBLISHED: ['SUSPENDED', 'EXPIRED', 'SOLD', 'RENTED', 'ARCHIVED'],
  SUSPENDED: ['PUBLISHED', 'ARCHIVED'],
  EXPIRED: ['PUBLISHED', 'ARCHIVED'],
  REJECTED: ['ARCHIVED'],
  SOLD: ['ARCHIVED'],
  RENTED: ['ARCHIVED'],
  ARCHIVED: [],
});

// Commerce (BR-11, blueprint §49). Independent of moderation.
const PROPERTY_AVAILABILITY_TRANSITIONS = Object.freeze({
  AVAILABLE: ['ON_HOLD', 'SOLD', 'RENTED', 'UNAVAILABLE', 'SUSPENDED'],
  ON_HOLD: ['AVAILABLE', 'SOLD', 'RENTED', 'UNAVAILABLE', 'SUSPENDED'],
  UNAVAILABLE: ['AVAILABLE'],
  SUSPENDED: ['AVAILABLE'],
  SOLD: [],
  RENTED: [],
});

// Which actor may set which moderation target. Vendor may only
// submit their own listing; every review-side move is admin-only.
const PROPERTY_STATUS_ACTORS = Object.freeze({
  SUBMITTED: ['vendor', 'admin'],
  IN_REVIEW: ['admin'],
  APPROVED: ['admin'],
  CHANGES_REQUIRED: ['admin'],
  REJECTED: ['admin'],
  PUBLISHED: ['admin'],
  SUSPENDED: ['admin'],
  EXPIRED: ['system', 'admin'],
  SOLD: ['admin', 'system'],
  RENTED: ['admin', 'system'],
  ARCHIVED: ['vendor', 'admin'],
});

// Lead lifecycle (plan §5.4). LOST reachable from any pre-SALE state;
// only admin may reopen a LOST lead, with a recorded reason.
const LEAD_TRANSITIONS = Object.freeze({
  NEW: ['CONTACTED', 'LOST'],
  CONTACTED: ['VISIT_REQUESTED', 'FOLLOW_UP', 'LOST'],
  VISIT_REQUESTED: ['VISIT_SCHEDULED', 'LOST'],
  VISIT_SCHEDULED: ['VISIT_COMPLETED', 'LOST'],
  VISIT_COMPLETED: ['FOLLOW_UP', 'HOLD', 'SALE', 'LOST'],
  FOLLOW_UP: ['VISIT_REQUESTED', 'VISIT_SCHEDULED', 'HOLD', 'SALE', 'LOST'],
  HOLD: ['SALE', 'FOLLOW_UP', 'LOST'],
  SALE: [],
  LOST: [],
});

// Visit request → visit (plan §5.5). Assignment engine moves
// PENDING_ASSIGNMENT → ASSIGNED; the rest follows the visit table.
const VISIT_REQUEST_TRANSITIONS = Object.freeze({
  PENDING_ASSIGNMENT: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['CHECK_IN', 'CANCELLED'],
  CHECK_IN: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
});

// Site visit. CHECK_IN is required before COMPLETED (BR-08) —
// enforced by schema, mirrored here so error messages name the
// next legal move.
const VISIT_TRANSITIONS = Object.freeze({
  ASSIGNED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['CHECK_IN', 'CANCELLED'],
  CHECK_IN: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
});

// Follow-up (plan §5.7). RESCHEDULED creates a new PENDING row;
// the original keeps the link.
const FOLLOW_UP_TRANSITIONS = Object.freeze({
  PENDING: ['COMPLETED', 'RESCHEDULED', 'CANCELLED'],
  COMPLETED: [],
  RESCHEDULED: [],
  CANCELLED: [],
});

// Hold lifecycle (plan §4.3.2, §6). FUTURE — model lands in Batch 3.
const HOLD_TRANSITIONS = Object.freeze({
  PENDING_PAYMENT: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  ACTIVE: ['EXPIRED', 'CANCELLED', 'CONVERTED_TO_SALE', 'REFUND_PENDING'],
  EXPIRED: ['REFUND_PENDING', 'REFUNDED'],
  CANCELLED: ['REFUND_PENDING', 'REFUNDED'],
  REFUND_PENDING: ['REFUNDED', 'ADJUSTED'],
  CONVERTED_TO_SALE: ['ADJUSTED'],
  REFUNDED: [],
  ADJUSTED: [],
});

// Loan pipeline (plan §5.8). SANCTIONED / REJECTED / DISBURSED are
// bank-only (BR-10) — enforced by rights-string absence, mirrored
// here so the service can reject early with a clear message.
const LOAN_TRANSITIONS = Object.freeze({
  NOT_REQUIRED: [],
  REQUIRED: ['CUSTOMER_WILL_APPLY', 'LOAN_LEAD_CREATED', 'WITHDRAWN'],
  CUSTOMER_WILL_APPLY: ['LOAN_LEAD_CREATED', 'WITHDRAWN'],
  LOAN_LEAD_CREATED: ['OFFERS_PENDING', 'WITHDRAWN'],
  OFFERS_PENDING: ['OFFERS_RECEIVED', 'WITHDRAWN'],
  OFFERS_RECEIVED: ['CUSTOMER_SELECTING', 'WITHDRAWN'],
  CUSTOMER_SELECTING: ['BANK_SELECTED', 'WITHDRAWN'],
  BANK_SELECTED: ['APPLICATION_STARTED', 'WITHDRAWN'],
  APPLICATION_STARTED: ['DOCUMENTS_PENDING', 'WITHDRAWN'],
  DOCUMENTS_PENDING: ['UNDER_BANK_REVIEW', 'WITHDRAWN'],
  UNDER_BANK_REVIEW: ['SANCTIONED', 'REJECTED', 'WITHDRAWN'],
  SANCTIONED: ['DISBURSED', 'REJECTED', 'WITHDRAWN'],
  DISBURSED: [],
  REJECTED: [],
  WITHDRAWN: [],
});

// Bank-only targets. The service checks this AND the route carries
// a rights string that exists only in the `bank` role array.
const BANK_ONLY_LOAN_TARGETS = Object.freeze(['SANCTIONED', 'REJECTED', 'DISBURSED']);

// Commission / settlement (plan §5.9, §5.11). FUTURE — Batch 2.
const COMMISSION_TRANSITIONS = Object.freeze({
  PENDING: ['VERIFIED', 'REVERSED'],
  VERIFIED: ['EARNED', 'REVERSED'],
  EARNED: ['SETTLEMENT_CREATED', 'REVERSED'],
  SETTLEMENT_CREATED: ['PAID', 'REVERSED'],
  PAID: [],
  REVERSED: [],
});

const SETTLEMENT_TRANSITIONS = Object.freeze({
  PENDING: ['VERIFIED'],
  VERIFIED: ['EARNED'],
  EARNED: ['SETTLEMENT_CREATED'],
  SETTLEMENT_CREATED: ['PAID'],
  PAID: [],
});

/**
 * Whether `from → to` is legal in the given table.
 */
function canTransition(table, from, to) {
  const allowed = table[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Assert a transition or throw naming the legal targets.
 */
function assertTransition(table, machineName, from, to) {
  if (canTransition(table, from, to)) return;
  const allowed = table[from] || [];
  throw new Error(
    allowed.length
      ? `Cannot move ${machineName} from "${from}" to "${to}". Allowed from "${from}": ${allowed.join(', ')}.`
      : `${machineName} is already "${from}" and cannot change.`
  );
}

module.exports = {
  PROPERTY_STATUS_TRANSITIONS,
  PROPERTY_AVAILABILITY_TRANSITIONS,
  PROPERTY_STATUS_ACTORS,
  LEAD_TRANSITIONS,
  VISIT_REQUEST_TRANSITIONS,
  VISIT_TRANSITIONS,
  FOLLOW_UP_TRANSITIONS,
  HOLD_TRANSITIONS,
  LOAN_TRANSITIONS,
  BANK_ONLY_LOAN_TARGETS,
  COMMISSION_TRANSITIONS,
  SETTLEMENT_TRANSITIONS,
  canTransition,
  assertTransition,
};
