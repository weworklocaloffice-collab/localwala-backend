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
const appAuth = require('../../../middlewares/appAuth');
const controller = require('../controllers/stores.controller');
const V = require('../validations/stores.validation');
const { storeAuth, storeAuthSuspendedOk, storeScope, requireRole } = require('../middlewares/stores.tenant');
const { assertCan } = require('../services/stores.profile.service');

const router = express.Router();

/**
 * Partner and applicant routes.
 *
 * ## `storeAuth` on every outlet route
 *
 * Not a bare `appAuth(...)`. `storeAuth` authenticates AND resolves the outlet, so a
 * route cannot accidentally opt out of tenancy scoping. An omission here would mean a
 * partner reading another outlet's data.
 *
 * ## Route ordering
 *
 * Express matches in registration order, so a LITERAL segment must be declared before
 * any `:param` sibling or it is unreachable. `/partner/session/outlet` is declared
 * before `/partner/outlets/:outlet`.
 */

// ---------------------------------------------------------------------------
// onboarding — the applicant, before any outlet exists
// ---------------------------------------------------------------------------

router
  .route('/application')
  .get(appAuth('stores_onboarding_read'), controller.getMyApplication)
  .patch(appAuth('stores_onboarding_write'), validate(V.onboardingDraftValidation), controller.saveApplication);

router.post(
  '/application/submit',
  appAuth('stores_onboarding_submit'),
  validate(V.submitValidation),
  controller.submitApplication
);

// ---------------------------------------------------------------------------
// session and scope
//
// Split deliberately. `storeScope` resolves the permitted set WITHOUT pinning an
// active outlet; `storeAuth` pins one and validates it. Picking an outlet is
// circular under `storeAuth` (you need the picker to choose an outlet, and the
// picker needs to work without one), and a partner whose outlets are all suspended
// must still be able to see them. See storeScope in stores.tenant.js.
// ---------------------------------------------------------------------------

router.get(
  '/partner/scope',
  storeScope('stores_chain_read'),
  controller.myScope
);

/**
 * LITERAL before :param — see the note at the top of this file. Declaring
 * `/partner/outlets/:outlet` first would make this unreachable.
 */
router.post(
  '/partner/session/outlet',
  storeScope('stores_session_outlet_switch'),
  validate(V.sessionOutletSwitchValidation),
  controller.switchOutlet
);

router.get(
  '/partner/outlets',
  storeScope('stores_outlet_read'),
  validate(V.outletListValidation),
  controller.myOutlets
);

router.get(
  '/partner/outlets/:outlet',
  storeScope('stores_outlet_read'),
  validate(V.outletIdValidation),
  controller.myOutletDetail
);

router.get(
  '/partner/chain',
  storeAuth('stores_chain_read'),
  controller.myChainDetail
);

/**
 * The BR-32 capability row. The app renders its banners from this rather than
 * re-implementing the matrix in Dart, so the two can never disagree.
 *
 * Outlet-scoped because every capability in the matrix is an outlet capability, and
 * a suspended outlet still gets a truthful answer here.
 */
router.get(
  '/partner/capabilities',
  storeAuthSuspendedOk('stores_chain_read'),
  controller.myCapabilities
);

// ---------------------------------------------------------------------------
// outlet status
// ---------------------------------------------------------------------------

/**
 * The target status is a ROUTE PARAMETER and is Joi-allow-listed. A client cannot POST
 * an arbitrary status string; the service transition table is the second gate.
 *
 * Note there is NO `:outlet` here. The outlet comes from the validated session/header,
 * never from the path — an outlet in the URL would be a second, separately-validated
 * trust input for the same resource, and the two could disagree. This is the same
 * lesson as Dairy defect 12.
 */
router.patch(
  '/partner/outlet/:status',
  storeAuth('stores_outlet_write'),
  validate(V.outletStatusChangeValidation),
  controller.changeOutletStatus
);

// ---------------------------------------------------------------------------
// staff
// ---------------------------------------------------------------------------

router
  .route('/partner/staff')
  .get(storeAuth('stores_staff_read'), validate(V.staffListValidation), controller.listStaff)
  .post(storeAuth('stores_staff_write'), validate(V.staffRoleValidation), controller.assignStaff);

router
  .route('/partner/staff/:assignment')
  .patch(storeAuth('stores_staff_write'), validate(V.staffUpdateValidation), controller.updateStaff)
  // DELETE is scoped to "deactivate", never a real delete (BR-25). A hard delete route
  // would eventually be called by someone, and the record cannot be recovered.
  .delete(storeAuth('stores_staff_write'), controller.deactivateStaff);

router.get(
  '/partner/team',
  storeAuth('stores_staff_read'),
  validate(V.outletIdValidation),
  controller.outletTeam
);

/**
 * Sub-router order is LOAD-BEARING.
 *
 * All three are mounted on this same Express router, and Express tries them in
 * registration order. `customerRoutes` therefore comes FIRST so its literal paths —
 * `/nearby`, `/cart`, `/products/search`, `/orders` — are matched before a partner route
 * with a `:param` sibling can swallow them.
 *
 * Two collisions were real and are now fixed at BOTH ends:
 *
 *   1. `GET /cart` was shadowed by `GET /:store`, answering
 *      `CastError: Cast to ObjectId failed for value "cart"`.
 *   2. `POST /orders` existed in the partner file too, and the partner handler won,
 *      so every customer order was answered `403 No local store outlet is linked to this
 *      account`.
 *
 * The partner order routes were additionally namespaced under `/partner/orders` so the
 * collision cannot return through a re-ordering of these three lines.
 */
const customerRoutes = require('./stores.customer.route');
router.use(customerRoutes);

const catalogRoutes = require('./stores.catalog.route');
router.use(catalogRoutes);

const driverRoutes = require('./stores.driver.route');
router.use(driverRoutes);

/**
 * LAST. On purpose, and it must stay last.
 *
 * `stores.storefront.route.js` holds the only catch-alls in the stores surface
 * (`/:store`, `/:store/products`, `/:store/reviews`, `/:store/offers`). Express tries
 * routers in registration order, so anything registered after them whose path starts
 * with a literal segment is unreachable — it gets captured, the literal becomes an
 * `ObjectId` cast, and the caller gets a 500 instead of data.
 *
 * This is not a theoretical ordering concern. While these routes lived in the customer
 * router (mounted first), they broke seven live endpoints:
 * `GET /subscription`, `/delivery`, `/settlement`, `/remittances`, `/warranty`,
 * `/catalog/products` and `/subscriptions` — each answered
 * `CastError: Cast to ObjectId failed for value "<segment>"`. No unit test caught it,
 * because every unit test calls the service layer and never builds a URL.
 *
 * `scripts/verify.stores.api.contract.js` walks the assembled router and fails if any
 * route is captured by an earlier one, so moving this line is now a build failure rather
 * than a silent outage.
 */
const storefrontRoutes = require('./stores.storefront.route');
router.use(storefrontRoutes);

module.exports = router;