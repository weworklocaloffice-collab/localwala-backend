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

const express = require('express');
const validate = require('../../../middlewares/validate');
const webAuth = require('../../../middlewares/webAuth');
const controller = require('../controllers/stores.controller');
const V = require('../validations/stores.validation');

const router = express.Router();

/**
 * The permission required to act on a local-stores application.
 *
 * ## Why this is NOT the dairy right
 *
 * Every route here used `webAuth('review_dairy_joining_request')`. It happened to work
 * only because the admin role already held that dairy permission. Two consequences:
 *
 *   1. The stores vertical was silently coupled to the dairy permission name. Renaming
 *      or retiring the dairy right would have broken stores review with no stores code
 *      changing, and no test would have pointed at the cause.
 *   2. It granted stores-application access on the strength of a DAIRY permission.
 *
 * The right below is now in the admin role (see config/roles.js) and is named for what
 * it actually authorises. `webAuth` fails closed: an admin whose role predates this
 * change must be re-issued rights rather than silently inheriting them.
 */
const ADMIN_REVIEW_RIGHT = 'stores_application_review';

/**
 * Admin routes for the stores vertical. Mounted at `/v1/admin/stores`.
 *
 * ## Why a SEPARATE file rather than adding to `admin.route.js`
 *
 * That file is 150 KB and 743 routes, and it is shared with food, dining, tiffin and
 * every other vertical. Extending it works, but it means every stores change is a
 * merge against a file nobody on this vertical owns, and it is exactly the route-
 * ordering hazard that makes those files hard to change safely.
 *
 * ## WHY MOUNTING AFTER `/admin` IS SAFE
 *
 * `routes/v1/index.js` mounts `/admin` BEFORE `/admin/stores`. Express tries a router
 * and calls `next()` when nothing matches, so a request to `/admin/stores/x` falls
 * through `admin.route.js` and lands here. That is only safe because `admin.route.js`
 * has NO catch-all or wildcard — verified, not assumed. If a catch-all is ever added
 * there, this mount silently stops being reached and this file must move to
 * `/v1/stores/admin`.
 *
 * ## Auth
 *
 * `webAuth`, not `appAuth`: the Angular admin panel authenticates by COOKIE, while the
 * Flutter apps use a bearer token. Mixing them produces a 403 that looks like a
 * permissions problem.
 */

// ---------------------------------------------------------------------------
// applications — the work queue
// ---------------------------------------------------------------------------

router
  .route('/applications')
  .get(webAuth(ADMIN_REVIEW_RIGHT), validate(V.applicationListValidation), controller.listApplications);

router
  .route('/applications/:application')
  // One application. This previously called `listApplications`, so it returned the
  // first page of the queue and ignored the id in the path.
  .get(webAuth(ADMIN_REVIEW_RIGHT), validate(V.applicationIdValidation), controller.getApplication)
  // Move to `under_review`. PATCH, not POST: it is a partial state change.
  .patch(webAuth(ADMIN_REVIEW_RIGHT), validate(V.applicationIdValidation), controller.startReview)
  // Approving COMMITS: Business, chain, outlet and the owner assignment, in one
  // transaction. This is the single most consequential write in Phase 1.
  .post(webAuth(ADMIN_REVIEW_RIGHT), validate(V.applicationIdValidation), controller.approveApplication);

// Rejecting. POST, not PUT: it is a state transition, not an idempotent replacement
// of a resource, and it carries a reason. Reusing PUT here told a client author that
// retrying it was safe, which it is not.
//
// Its OWN PATH, and this is a bug fix rather than a preference. This was previously a
// second `.post()` on `/applications/:application`, below the approve handler. Express
// dispatches to the FIRST registered handler for a method+path, so the reject handler
// was unreachable — every reject attempt committed an approval instead. Silent, and the
// worst possible direction: the admin believed they had declined a partner and had
// actually onboarded them. Same reasoning as `request-changes` below.
router.post(
  '/applications/:application/reject',
  webAuth(ADMIN_REVIEW_RIGHT),
  validate(V.rejectValidation),
  controller.rejectApplication
);

router.post(
  '/applications/:application/request-changes',
  webAuth(ADMIN_REVIEW_RIGHT),
  validate(V.requestChangesValidation),
  controller.requestChanges
);

router.get(
  '/chains',
  webAuth('stores_chain_read'),
  validate(V.chainsAdminListValidation),
  controller.adminListChains
);

router.get(
  '/chains/:chain',
  webAuth('stores_chain_read'),
  validate(V.chainIdValidation),
  controller.adminChainDetail
);

router.get(
  '/tax-configurations',
  webAuth('stores_tax_read'),
  validate(V.taxConfigurationQueryValidation),
  controller.adminListTaxConfigs
);

router.get(
  '/tax-configurations/resolve',
  webAuth('stores_tax_read'),
  validate(V.taxConfigurationQueryValidation),
  controller.adminResolveTaxRate
);

// ---------------------------------------------------------------------------
// registries — read-only admin lists over partner-owned records
// ---------------------------------------------------------------------------
// Outlets are committed by approval, roles by scope-checked assignment,
// policies by versioned supersede, placements by billed approval. None of
// that is an admin inline edit, so these are GET-only by design. Each answers
// { items, total } for the shared admin list base.

router.get(
  '/outlets',
  webAuth('stores_outlet_read'),
  validate(V.outletAdminListValidation),
  controller.adminListOutlets
);

router.get(
  '/staff',
  webAuth('stores_staff_read'),
  validate(V.staffAdminListValidation),
  controller.adminListStaff
);

router.get(
  '/policies',
  webAuth('stores_policy_read'),
  validate(V.policyAdminListValidation),
  controller.adminListPolicies
);

router.get(
  '/featured-placements',
  webAuth('stores_featured_read'),
  validate(V.featuredAdminListValidation),
  controller.adminListFeatured
);

/**
 * Sub-routers mounted under the same `/admin/stores` prefix.
 *
 * Kept as separate files and mounted here rather than added to `routes/v1/index.js`
 * because the shared index is the file nobody on this vertical owns. One mount point for
 * every stores admin route means the fall-through note in this file's header stays true,
 * and adding an admin area is a change to this module only.
 *
 * No path here collides with a literal segment above, so registration order is not load
 * bearing — but they are mounted LAST so this file's own routes are always matched first
 * if a future path ever does overlap.
 */
router.use(require('./stores.admin.catalog.route'));
router.use(require('./stores.admin.operations.route'));
router.use(require('./stores.admin.records.route'));

module.exports = router;