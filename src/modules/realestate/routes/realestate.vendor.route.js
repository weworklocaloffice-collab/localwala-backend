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
const realestateTenantMiddleware = require('../middlewares/realestate.tenant');
const controller = require('../controllers/realestate.vendor.controller');
const V = require('../validations/realestate.vendor.validation');

const router = express.Router();

/**
 * Vendor Real Estate routes. Mounted at `/v1/realestate/vendor`.
 *
 * ## `realestateTenantMiddleware` is on every route here, including `register`
 *
 * The middleware identifies the caller and never throws — an absent or bad token simply
 * leaves `req.actorType = 'guest'`. `register` therefore needs the token too: it links the
 * new vendor row to a `User`, and a vendor with no user is a row nothing can ever log in as.
 * The 401 for a missing token is raised in `controller.requireVendor`, not here.
 *
 * ## No `:vendorId` in any path
 *
 * Doc §7.1 forbids it. See the controller for why.
 *
 * ## Why there is no `/admin/*` on this file
 *
 * It used to carry three. Those routes had **no rights string**, which is precisely
 * DEFECT-2 in doc §0A.3: `auth.factory.js` only rejects by accident when a route has no
 * `userId` param, so an unannotated route with a different param shape would admit any
 * authenticated caller — a customer included. Admin vendor actions now live in
 * `realestate.admin.route.js` behind an explicit `webAuth(<right>)`.
 */

// --------------------------------------------------------------------- vendor self

router.post('/register', realestateTenantMiddleware, controller.register);
router.get('/me', realestateTenantMiddleware, controller.me);
router.post('/submit-for-review', realestateTenantMiddleware, controller.submitForReview);
router.get('/dashboard', realestateTenantMiddleware, controller.dashboard);

// ---------------------------------------------------------- packages and orders

/**
 * The purchase surface, which is what makes BR-02 and BR-05 reachable.
 *
 * `/packages/:code` and `/packages/:code/purchase` do not collide even though the former is
 * declared first: Express matches on whole path segments, so `/packages/:code` consumes one
 * segment after `/packages` and cannot swallow the second segment of a purchase path. The
 * code travels in the path rather than a body, which makes the catalogue item being bought
 * readable in a log line.
 */
router.get('/packages', realestateTenantMiddleware, controller.listPackages);
router.get('/packages/:code', realestateTenantMiddleware, controller.getPackage);

router.post(
  '/packages/:code/purchase',
  realestateTenantMiddleware,
  validate(V.purchase),
  controller.purchasePackage
);

router.get('/orders', realestateTenantMiddleware, validate(V.orders), controller.listOrders);
router.get(
  '/orders/:id',
  realestateTenantMiddleware,
  validate(V.orderParams),
  controller.getOrder
);
router.post(
  '/orders/:id/cancel',
  realestateTenantMiddleware,
  validate(V.cancel),
  controller.cancelOrder
);

router.get(
  '/entitlements',
  realestateTenantMiddleware,
  controller.listEntitlements
);

// ------------------------------------------------------------------ properties
//
// The vendor's own property CRUD. The status endpoint uses a Joi-allow-listed
// target so a vendor cannot set admin-only states (APPROVED/PUBLISHED/
// REJECTED/SUSPENDED/EXPIRED/SOLD/RENTED). The service's STATUS_ACTORS
// table is the second copy of that control.

router.post(
  '/properties',
  realestateTenantMiddleware,
  validate(V.createProperty),
  controller.createProperty
);

router.get(
  '/properties',
  realestateTenantMiddleware,
  validate(V.propertyList),
  controller.listMyProperties
);

router.get(
  '/properties/:id',
  realestateTenantMiddleware,
  validate(V.propertyIdParam),
  controller.getMyProperty
);

router.patch(
  '/properties/:id',
  realestateTenantMiddleware,
  validate(V.updateProperty),
  controller.updateMyProperty
);

router.post(
  '/properties/:id/submit',
  realestateTenantMiddleware,
  validate(V.propertyIdParam),
  controller.submitMyProperty
);

router.post(
  '/properties/:id/withdraw',
  realestateTenantMiddleware,
  validate(V.propertyIdParam),
  controller.withdrawMyProperty
);

router.post(
  '/properties/:id/status/:status',
  realestateTenantMiddleware,
  validate(V.propertyStatus),
  controller.changeMyPropertyStatus
);

// ------------------------------------------------------------------- documents
//
// Vendor document CRUD on the vendor's own properties. ACCEPTED
// documents cannot be removed (BR-21); the service throws a typed
// error and the controller maps it to 409.

router.post(
  '/properties/:id/documents',
  realestateTenantMiddleware,
  validate(V.uploadDocument),
  controller.uploadPropertyDocument
);

router.get(
  '/properties/:id/documents',
  realestateTenantMiddleware,
  validate(V.listDocuments),
  controller.listPropertyDocuments
);

router.get(
  '/properties/:id/documents/:documentId',
  realestateTenantMiddleware,
  validate(V.documentById),
  controller.getPropertyDocument
);

router.delete(
  '/properties/:id/documents/:documentId',
  realestateTenantMiddleware,
  validate(V.documentById),
  controller.deletePropertyDocument
);

// ------------------------------------------------------------------ leads
//
// Vendor's read-only view of leads on their own listings. A 404 on
// cross-vendor reads keeps the endpoint from being an IDOR.

router.get(
  '/leads',
  realestateTenantMiddleware,
  validate(V.leadsList),
  controller.listMyLeads
);

router.get(
  '/leads/:id',
  realestateTenantMiddleware,
  validate(V.leadParams),
  controller.getMyLead
);

// ----------------------------------------------------------------- visits

router.get(
  '/visits',
  realestateTenantMiddleware,
  validate(V.visitsList),
  controller.listMyVisits
);

router.get(
  '/visits/:id',
  realestateTenantMiddleware,
  validate(V.visitParams),
  controller.getMyVisit
);

// ------------------------------------------------------------------- holds

router.get(
  '/holds',
  realestateTenantMiddleware,
  validate(V.holdsList),
  controller.listMyHolds
);

// -------------------------------------------------------------- customers

router.get(
  '/customers',
  realestateTenantMiddleware,
  validate(V.customersList),
  controller.listMyCustomers
);

// --------------------------------------------------------- analytics + money

router.get(
  '/analytics',
  realestateTenantMiddleware,
  controller.getMyAnalytics
);

router.get(
  '/commissions',
  realestateTenantMiddleware,
  validate(V.commissionsList),
  controller.listMyCommissions
);

router.get(
  '/sales',
  realestateTenantMiddleware,
  validate(V.salesList),
  controller.listMySales
);

router.get(
  '/sales/:id',
  realestateTenantMiddleware,
  validate(V.saleParams),
  controller.getMySale
);

module.exports = router;