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
const controller = require('../controllers/stores.admin.records.controller');
const deliveryController = require('../controllers/stores.delivery.controller');
const V = require('../validations/stores.admin.validation');

const router = express.Router();

/**
 * Admin CRUD over partner records. Mounted at `/v1/admin/stores`.
 *
 * ## Reads and writes have different rights
 *
 * `stores_records_read` gates every list. `stores_records_manage` gates the transitions.
 * The split is not ceremony: the settlement console is read by finance, the settlement
 * SETTLE action is a bank instruction, and a support agent triaging a refund must not
 * thereby acquire the ability to mark money as paid out.
 *
 * ## Mutations delegate, they do not reimplement
 *
 * Every state change routes through the partner service that owns the transition table.
 * An admin-only writer would be a second implementation of the same rules, and the two
 * drift — the first place they drift is an admin action that skips a guard the partner
 * path enforces.
 */

// -- orders -------------------------------------------------------------------

router.get('/orders', webAuth('stores_records_read'), validate(V.orderList), controller.listOrders);
router.get('/orders/:order', webAuth('stores_records_read'), validate(V.orderId), controller.getOrder);

/**
 * LITERAL `:status` is declared AFTER the literal `/orders` list, and there is no
 * `GET /orders/:status` sibling, so ordering is safe. The status is a route parameter
 * rather than a body field so a client cannot mutate the application while also claiming
 * a different target state.
 */
router.patch(
  '/orders/:order/:status',
  webAuth('stores_records_manage'),
  validate(V.orderTransition),
  controller.transitionOrder
);

// -- drivers ------------------------------------------------------------------

router.get('/drivers', webAuth('stores_records_read'), validate(V.recordList), controller.listDrivers);
router.get('/drivers/:driver', webAuth('stores_records_read'), validate(V.driverId), controller.getDriver);

// -- deliveries ---------------------------------------------------------------
// Admin read: cross-tenant list of delivery records. The partner-facing
// route at /v1/stores/partner/delivery/* enforces outlet scope (BR-38);
// the admin read does not, because an admin investigating a failed or
// stuck delivery needs the row regardless of which outlet created it.

router.get('/deliveries', webAuth('stores_records_read'), validate(V.deliveryList), deliveryController.listDeliveries);
router.get('/deliveries/:delivery', webAuth('stores_records_read'), validate(V.deliveryId), deliveryController.getDelivery);

/**
 * BR-08 — a driver is never hard-deleted. There is deliberately no DELETE on this path:
 * historical deliveries must keep resolving to the driver who made them, forever.
 */
router.post(
  '/drivers/:driver/suspend',
  webAuth('stores_records_manage'),
  validate(V.driverReason),
  controller.suspendDriver
);
router.post(
  '/drivers/:driver/reactivate',
  webAuth('stores_records_manage'),
  validate(V.driverId),
  controller.reactivateDriver
);

// -- returns / exchanges / warranties ------------------------------------------

/**
 * ONE list for all three, discriminated by `kind`.
 *
 * Three separate screens would mean three paginators, three filters and three searches to
 * look at what is going wrong, and an operator with a return in hand would have to guess
 * which screen it is on. The row shape differs, so the columns are chosen by `kind`.
 */
router.get(
  '/requests',
  webAuth('stores_records_read'),
  validate(V.postOrderList),
  controller.listPostOrderRequests
);

router.patch(
  '/returns/:return/:status',
  webAuth('stores_records_manage'),
  validate(V.returnTransition),
  controller.transitionReturn
);
router.patch(
  '/exchanges/:exchange/:status',
  webAuth('stores_records_manage'),
  validate(V.exchangeTransition),
  controller.transitionExchange
);
router.patch(
  '/warranties/:warranty/:status',
  webAuth('stores_records_manage'),
  validate(V.warrantyTransition),
  controller.transitionWarranty
);

// -- promotions ---------------------------------------------------------------

router.get('/promotions', webAuth('stores_records_read'), validate(V.promotionList), controller.listPromotions);
router.patch(
  '/promotions/:promotion/moderate',
  webAuth('stores_records_manage'),
  validate(V.promotionModeration),
  controller.moderatePromotion
);

// -- reviews and complaints ----------------------------------------------------

router.get('/reviews', webAuth('stores_records_read'), validate(V.reviewList), controller.listReviews);
router.patch(
  '/reviews/:review/moderate',
  webAuth('stores_records_manage'),
  validate(V.reviewModeration),
  controller.moderateReview
);

router.get('/complaints', webAuth('stores_records_read'), validate(V.complaintList), controller.listComplaints);
router.patch(
  '/complaints/:complaint/moderate',
  webAuth('stores_records_manage'),
  validate(V.complaintModeration),
  controller.moderateComplaint
);

// -- settlements --------------------------------------------------------------

router.get('/settlements', webAuth('stores_records_read'), validate(V.settlementList), controller.listSettlements);
router.get('/settlements/:settlement', webAuth('stores_records_read'), validate(V.settlementId), controller.getSettlement);

/**
 * Payout actions are `stores_records_manage`, not merely read. Marking a settlement paid
 * is a bank instruction with a real-world consequence; the read right must never imply it.
 */
router.post(
  '/settlements/:settlement/settle',
  webAuth('stores_records_manage'),
  validate(V.settlementSettle),
  controller.markSettled
);
router.post(
  '/settlements/:settlement/fail',
  webAuth('stores_records_manage'),
  validate(V.settlementFail),
  controller.markFailed
);
/**
 * A reversal, never a delete (BR-25) — a clawback is a new reversing entry so the original
 * stays auditable.
 */
router.post(
  '/settlements/:settlement/reverse',
  webAuth('stores_records_manage'),
  validate(V.settlementReverse),
  controller.reverseSettlement
);

// -- refunds ------------------------------------------------------------------

router.get('/refunds', webAuth('stores_records_read'), validate(V.refundList), controller.listRefunds);

// -- subscriptions ------------------------------------------------------------

router.get('/subscriptions', webAuth('stores_records_read'), validate(V.subscriptionList), controller.listSubscriptions);
router.get(
  '/subscription-payments',
  webAuth('stores_records_read'),
  validate(V.subscriptionPaymentList),
  controller.listSubscriptionPayments
);

// -- organic ------------------------------------------------------------------

router.patch(
  '/organic-verification/:verification',
  webAuth('stores_records_manage'),
  validate(V.organicModeration),
  controller.moderateOrganic
);

module.exports = router;