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

const express = require('express');
const validate = require('../../../middlewares/validate');
const executiveAuth = require('../middlewares/realestate.executive.auth');
const controller = require('../controllers/realestate.executive.controller');
const V = require('../validations/realestate.executive.validation');

const router = express.Router();

/**
 * Property-executive routes. Mounted at `/v1/realestate/executive`.
 *
 * ## `executiveAuth` on every route, with no exceptions
 *
 * It resolves the executive from the token and refuses vendors with 403, which is the
 * mutual exclusion the Phase 11b DoD asks for. A route added later without it would be
 * reachable by anyone signed in, so there is deliberately no `router.use(executiveAuth)`
 * shortcut to be forgotten — it is written on each line where it is visible.
 *
 * ## No `:executiveId` in any path
 *
 * Doc §7.1. The actor is `req.actorId`. An id in the URL would let one executive read and
 * write another's leads by editing a path segment.
 *
 * ## `/visits/:id/:status` is split into named routes, not one generic setter
 *
 * The doc puts the target state in the path, but a single
 * `POST /visits/:id/:status` that dispatches on the string would give check-in,
 * completion and cancellation one shared entry point — and check-in needs a body, a
 * geofence, and a different failure mode. Folding them together is how a `COMPLETED`
 * without a check-in becomes reachable. So each state gets its own path with its own
 * validation, and `ALLOWED_NEXT` in the validation still allow-lists the states, so the
 * transition table is enforced in both places as §0.0 requires.
 */

// ----------------------------------------------------------------------- profile

router.get('/me', executiveAuth, controller.me);
router.get(
  '/dashboard',
  executiveAuth,
  validate(V.dashboard),
  controller.dashboard
);
router.post(
  '/location',
  executiveAuth,
  validate(V.location),
  controller.updateLocation
);

// ------------------------------------------------------------------------- visits

router.get(
  '/visits',
  executiveAuth,
  validate(V.visits),
  controller.listVisits
);
router.get(
  '/visits/:id',
  executiveAuth,
  validate(V.visitParams),
  controller.getVisit
);
router.post(
  '/visits/:id/accept',
  executiveAuth,
  validate(V.accept),
  controller.acceptVisit
);

/**
 * The BR-08 route doc §7.3 names. See the file header for why it stands alone.
 */
router.post(
  '/visits/:id/check_in',
  executiveAuth,
  validate(V.checkIn),
  controller.checkIn
);

router.post(
  '/visits/:id/complete',
  executiveAuth,
  validate(V.complete),
  controller.completeVisit
);
router.post(
  '/visits/:id/cancel',
  executiveAuth,
  validate(V.visitCancelParams),
  controller.cancelVisit
);
router.post(
  '/visits/:id/notes',
  executiveAuth,
  validate(V.complete),
  controller.addVisitNotes
);

// ---------------------------------------------------------------------- interest

/**
 * BR-09. Structured: a closed `level` and a closed `reason`, with free text only as the
 * `OTHER` escape hatch. Free-text opinion is not interest.
 */
router.post(
  '/visits/:id/interest',
  executiveAuth,
  validate(V.interest),
  controller.recordInterest
);

// --------------------------------------------------------------------- follow-ups

router.post(
  '/leads/:leadId/followups',
  executiveAuth,
  validate(V.followUp),
  controller.createFollowUp
);
router.post(
  '/followups/:id/complete',
  executiveAuth,
  validate(V.followUpParams),
  controller.completeFollowUp
);

// ------------------------------------------------------------------------- leads

router.get(
  '/leads',
  executiveAuth,
  validate(V.dashboard),
  controller.listLeads
);
router.get(
  '/leads/:leadId',
  executiveAuth,
  validate(V.leadParams),
  controller.getLead
);

// --------------------------------------------------------------------- properties

/**
 * Read-only, and the moderation fields are stripped in the controller. An executive
 * preparing a site visit needs the address and the specs, not the review trail.
 */
router.get(
  '/properties/:id',
  executiveAuth,
  validate(V.propertyParams),
  controller.getPropertyForVisit
);

// ------------------------------------------------- money + queue (read-only)

// Plan §11.4: commission/settlement/hold/follow-up/notification reads.
// All scoped to the token executive — no actor id in any path (§7.1).
// Writes stay on the transition routes above; nothing here mutates.
router.get('/commissions', executiveAuth, controller.listCommissions);
router.get('/holds', executiveAuth, controller.listHolds);
router.get('/followups', executiveAuth, controller.listFollowUps);
router.get('/settlements', executiveAuth, controller.listSettlements);
router.get('/notifications', executiveAuth, controller.listNotifications);
router.post('/notifications/:id/read', executiveAuth, controller.markNotificationRead);

module.exports = router;