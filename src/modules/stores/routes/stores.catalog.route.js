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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const express = require('express');
const validate = require('../../../middlewares/validate');
const { storeAuth, storeScope, appAuth } = require('../middlewares/stores.tenant');
const V = require('../validations/stores.validation');
const catalogController = require('../controllers/stores.catalog.controller');
const inventoryController = require('../controllers/stores.inventory.controller');
const orderController = require('../controllers/stores.order.controller');
const pickingController = require('../controllers/stores.picking.controller');
const subscriptionController = require('../controllers/stores.subscription.controller');
const deliveryController = require('../controllers/stores.delivery.controller');
const settlementController = require('../controllers/stores.settlement.controller');
const remittanceController = require('../controllers/stores.remittance.controller');
const returnController = require('../controllers/stores.return.controller');
const promotionController = require('../controllers/stores.promotion.controller');
const reviewController = require('../controllers/stores.review.controller');
const driverController = require('../controllers/stores.driver.controller');
const analyticsController = require('../controllers/stores.analytics.controller');
const warrantyController = require('../controllers/stores.warranty.controller');
const policyController = require('../controllers/stores.policy.controller');
const featuredController = require('../controllers/stores.featured.controller');
const complaintController = require('../controllers/stores.complaint.controller');

const router = express.Router();

// ---------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------
router.get('/catalog/products', storeAuth('stores_catalog_read'), validate(V.productListValidation), catalogController.listProducts);
router.get('/catalog/product-form', storeAuth('stores_catalog_read'), validate(V.productFormQueryValidation), catalogController.getProductForm);
router.post('/catalog/products', storeAuth('stores_catalog_write'), validate(V.productCreateValidation), catalogController.createProduct);
router.get('/catalog/products/:product', storeAuth('stores_catalog_read'), catalogController.getProduct);
router.patch('/catalog/products/:product', storeAuth('stores_catalog_write'), validate(V.productUpdateValidation), catalogController.updateProduct);
router.delete('/catalog/products/:product', storeAuth('stores_catalog_write'), catalogController.deleteProduct);
router.post('/catalog/products/:product/variants/generate', storeAuth('stores_catalog_write'), validate(V.variantGenerateValidation), catalogController.generateVariants);

// ---------------------------------------------------------------------------
// inventory
// ---------------------------------------------------------------------------
router.get('/inventory/stock', storeAuth('stores_inventory_read'), inventoryController.getStockForOutlet);
router.get('/inventory/stock/low', storeAuth('stores_inventory_read'), inventoryController.getLowStockItems);
router.post('/inventory/stock/adjust', storeAuth('stores_inventory_adjust'), validate(V.stockAdjustValidation), inventoryController.adjustStock);
router.get('/inventory/movements', storeAuth('stores_inventory_read'), validate(V.movementListValidation), inventoryController.getMovements);

// ---------------------------------------------------------------------------
// orders
// ---------------------------------------------------------------------------
/**
 * Partner order routes live under `/partner/orders`, NOT `/orders`.
 *
 * ## Why the prefix is not cosmetic
 *
 * These routers are all mounted on the same Express router — `stores.route.js` does
 * `router.use(catalogRoutes)` then `router.use(customerRoutes)` — and BOTH files declared
 * a `POST /orders`. The first registration wins, so the PARTNER handler claimed the path
 * and every customer `POST /v1/stores/orders` was answered by `storeAuth`, which failed
 * with `403 No local store outlet is linked to this account`. A customer cannot have an
 * outlet role assignment, so the entire customer order path was unreachable.
 *
 * Namespacing the partner routes under `/partner` is the fix that does not depend on
 * registration order, which is a property of the file rather than of the call site: this
 * file could be re-ordered by anyone and the bug would return silently.
 */
router.post('/partner/orders', storeAuth('stores_order_manage'), orderController.createOrder);
router.get('/partner/orders', storeAuth('stores_order_read'), validate(V.orderListValidation), orderController.listOrders);
router.get('/partner/orders/:order', storeAuth('stores_order_read'), orderController.getOrder);
router.patch('/partner/orders/:order/:status', storeAuth('stores_order_manage'), orderController.transitionOrder);
router.post('/partner/orders/:order/cancel', storeAuth('stores_order_manage'), orderController.cancelOrder);

// Picking is order + outlet scoped. The active outlet is a session/tenancy
// property; it is never accepted from the body or path (BR-38).
router.get('/partner/orders/:order/pick-list', storeAuth('stores_order_pick'), pickingController.getPickList);
router.post('/partner/orders/:order/pick-item', storeAuth('stores_order_pick'), validate(V.pickItemValidation), pickingController.pickItem);
router.post('/partner/orders/:order/packing', storeAuth('stores_order_pack'), validate(V.packingCompleteValidation), pickingController.completePacking);
router.get('/partner/orders/:order/fulfilment-summary', storeAuth('stores_order_read'), pickingController.getFulfilmentSummary);

// ---------------------------------------------------------------------------
// subscription
// ---------------------------------------------------------------------------
router.get('/subscription', storeAuth('stores_subscription_read'), subscriptionController.getSubscription);
router.post('/subscription', storeAuth('stores_subscription_manage'), subscriptionController.createSubscription);
router.patch('/subscription/:subscription/:status', storeAuth('stores_subscription_manage'), subscriptionController.transitionSubscription);
router.post('/subscription/pay', storeAuth('stores_subscription_manage'), validate(V.subscriptionPayValidation), subscriptionController.paySubscription);
router.post('/subscription/sweep/billing', storeAuth('stores_subscription_manage'), subscriptionController.processBillingSweep);
router.post('/subscription/sweep/grace-expiry', storeAuth('stores_subscription_manage'), subscriptionController.processGracePeriodExpiry);
router.post('/subscription/sweep/suspended-expiry', storeAuth('stores_subscription_manage'), subscriptionController.processSuspendedExpiry);

// ---------------------------------------------------------------------------
// delivery
// ---------------------------------------------------------------------------
router.post('/delivery/assign', storeAuth('stores_driver_assign'), validate(V.deliveryAssignValidation), deliveryController.assignDriver);
router.get('/delivery/order/:order', storeAuth('stores_delivery_read'), deliveryController.getDelivery);
router.get('/delivery', storeAuth('stores_delivery_read'), deliveryController.listDeliveries);
router.patch('/delivery/:delivery/:status', storeAuth('stores_delivery_update'), deliveryController.transitionDelivery);
router.post('/delivery/:delivery/verify-otp', storeAuth('stores_delivery_update'), validate(V.deliveryOtpValidation), deliveryController.verifyDeliveryOtp);
router.post('/delivery/:delivery/collect-cod', storeAuth('stores_delivery_update'), validate(V.deliveryCodValidation), deliveryController.collectCod);
router.post('/delivery/:delivery/reconcile-cod', storeAuth('stores_delivery_update'), deliveryController.reconcileCod);
router.get('/delivery/drivers/available', storeAuth('stores_delivery_read'), deliveryController.getAvailableDrivers);

// ---------------------------------------------------------------------------
// settlement
// ---------------------------------------------------------------------------
router.post('/settlement/generate', storeAuth('stores_settlement_write'), validate(V.settlementGenerateValidation), settlementController.generateSettlement);
router.get('/settlement', storeAuth('stores_settlement_read'), validate(V.settlementListValidation), settlementController.listSettlements);
router.get('/settlement/:settlement', storeAuth('stores_settlement_read'), settlementController.getSettlement);
router.post('/settlement/:settlement/settle', storeAuth('stores_settlement_write'), settlementController.markSettled);
router.post('/settlement/:settlement/fail', storeAuth('stores_settlement_write'), settlementController.markFailed);
router.post('/settlement/:settlement/reverse', storeAuth('stores_settlement_write'), settlementController.reverseSettlement);

// ---------------------------------------------------------------------------
// remittance (COD cash reconciliation)
// ---------------------------------------------------------------------------
router.get('/remittances', storeAuth('stores_remittance_read'), validate(V.remittanceListValidation), remittanceController.listRemittances);
router.get('/remittances/pending', storeAuth('stores_remittance_read'), remittanceController.getPending);
router.post('/remittances/:remittance/submit', storeAuth('stores_remittance_manage'), validate(V.remittanceSubmitValidation), remittanceController.submitRemittance);
router.post('/remittances/:remittance/reconcile', storeAuth('stores_remittance_manage'), validate(V.remittanceReconcileValidation), remittanceController.reconcileRemittance);

// ---------------------------------------------------------------------------
// warranty
// ---------------------------------------------------------------------------
router.get('/warranty', appAuth('stores_warranty_read'), validate(V.warrantyListValidation), warrantyController.listWarrantyRequests);
router.post('/warranty', appAuth('stores_warranty_write'), validate(V.warrantyCreateValidation), warrantyController.createWarrantyRequest);
router.get('/warranty/:warranty', appAuth('stores_warranty_read'), warrantyController.getWarrantyRequest);
router.patch('/warranty/:warranty/:status', appAuth('stores_warranty_write'), validate(V.warrantyTransitionValidation), warrantyController.transitionWarranty);

router.get('/partner/warranty', storeAuth('stores_warranty_read'), validate(V.warrantyListValidation), warrantyController.listWarrantyRequests);
// LITERAL BEFORE PARAM. `/partner/warranty/expiring` sat BELOW
// `/partner/warranty/:warranty`, which captured 'expiring' as an id and made this
// handler unreachable (`findById('expiring')` cast-failed). Express resolves to the
// FIRST match, so ordering here is the whole mechanism.
router.get('/partner/warranty/expiring', storeAuth('stores_warranty_read'), warrantyController.getExpiring);
router.get('/partner/warranty/:warranty', storeAuth('stores_warranty_read'), warrantyController.getWarrantyRequest);
router.patch('/partner/warranty/:warranty/:status', storeAuth('stores_warranty_write'), validate(V.warrantyTransitionValidation), warrantyController.transitionWarranty);

// ---------------------------------------------------------------------------
// policies
// ---------------------------------------------------------------------------
router.post('/policies', storeAuth('stores_policy_write'), validate(V.policyCreateValidation), policyController.createPolicy);
router.get('/policies', storeAuth('stores_policy_read'), validate(V.policyListValidation), policyController.listPolicies);
router.get('/policies/:policy', storeAuth('stores_policy_read'), policyController.getPolicy);
router.patch('/policies/:policy', storeAuth('stores_policy_write'), validate(V.policyUpdateValidation), policyController.updatePolicy);
router.post('/policies/:policy/archive', storeAuth('stores_policy_write'), policyController.archivePolicy);

// ---------------------------------------------------------------------------
// featured placements
// ---------------------------------------------------------------------------
router.post('/featured', appAuth('stores_featured_write'), validate(V.featuredPlacementCreateValidation), featuredController.createFeatured);
router.get('/featured', appAuth('stores_featured_read'), featuredController.getLive);
router.get('/partner/featured', storeAuth('stores_featured_read'), validate(V.featuredPlacementListValidation), featuredController.listFeatured);
// `/pending` is a literal and `:placement` is a param, so the literal must be declared
// FIRST or it is captured as a placement id and `getPending` never runs.
router.get('/partner/featured/pending', storeAuth('stores_featured_read'), featuredController.getPending);
router.get('/partner/featured/:placement', storeAuth('stores_featured_read'), featuredController.getFeatured);
router.patch('/partner/featured/:placement', storeAuth('stores_featured_write'), validate(V.featuredPlacementUpdateValidation), featuredController.updateFeatured);
router.post('/partner/featured/:placement/approve', storeAuth('stores_featured_write'), validate(V.featuredPlacementTransitionValidation), featuredController.approveFeatured);
router.post('/partner/featured/:placement/reject', storeAuth('stores_featured_write'), validate(V.featuredPlacementTransitionValidation), featuredController.rejectFeatured);

// ---------------------------------------------------------------------------
// complaints
// ---------------------------------------------------------------------------
router.post('/complaints', appAuth('stores_complaint_write'), validate(V.complaintCreateValidation), complaintController.createComplaint);
router.get('/complaints', appAuth('stores_complaint_read'), validate(V.complaintListValidation), complaintController.listCustomerComplaints);
router.get('/complaints/:complaint', appAuth('stores_complaint_read'), complaintController.getComplaint);

router.get('/partner/complaints', storeAuth('stores_complaint_read'), validate(V.complaintListValidation), complaintController.listComplaints);
// `/open` is a literal and `:complaint` is a param: declare the literal FIRST. `open`
// would otherwise be read as a complaint id and the open-complaints queue would be
// unreachable.
router.get('/partner/complaints/open', storeAuth('stores_complaint_read'), complaintController.getOpenComplaints);
router.get('/partner/complaints/:complaint', storeAuth('stores_complaint_read'), complaintController.getComplaint);
router.patch('/partner/complaints/:complaint/:status', storeAuth('stores_complaint_write'), validate(V.complaintTransitionValidation), complaintController.transitionComplaint);
router.get('/partner/complaints/outlet/:outlet', storeAuth('stores_complaint_read'), complaintController.getByOutlet);

// ---------------------------------------------------------------------------
// returns & exchanges
// ---------------------------------------------------------------------------
router.post('/returns', storeAuth('stores_return_manage'), validate(V.returnCreateValidation), returnController.createReturnRequest);
router.get('/returns', storeAuth('stores_return_read'), returnController.listReturns);
router.get('/returns/:return', storeAuth('stores_return_read'), returnController.getReturnRequest);
router.patch('/returns/:return/:status', storeAuth('stores_return_manage'), returnController.transitionReturn);
router.post('/returns/:return/refund', storeAuth('stores_return_manage'), returnController.processReturnRefund);
router.post('/exchanges', storeAuth('stores_return_manage'), validate(V.exchangeCreateValidation), returnController.createExchangeRequest);
router.patch('/exchanges/:exchange/:status', storeAuth('stores_return_manage'), returnController.transitionExchange);

// ---------------------------------------------------------------------------
// promotions
// ---------------------------------------------------------------------------
router.post('/promotions/validate', storeAuth('stores_promotion_read'), validate(V.promotionValidateValidation), promotionController.validatePromotion);
router.post('/promotions', storeAuth('stores_promotion_write'), validate(V.promotionCreateValidation), promotionController.createPromotion);
router.get('/promotions', storeAuth('stores_promotion_read'), promotionController.listPromotions);

// ---------------------------------------------------------------------------
// reviews
// ---------------------------------------------------------------------------
router.post('/reviews', storeAuth('stores_review_write'), validate(V.reviewCreateValidation), reviewController.createReview);
router.get('/reviews', storeAuth('stores_review_read'), reviewController.listReviews);
router.patch('/reviews/:review/moderate', storeAuth('stores_review_write'), validate(V.reviewModerateValidation), reviewController.moderateReview);
router.post('/reviews/:review/helpful', storeAuth('stores_review_write'), reviewController.markHelpful);

// ---------------------------------------------------------------------------
// drivers
// ---------------------------------------------------------------------------
router.post('/drivers', storeAuth('stores_driver_write'), validate(V.driverCreateValidation), driverController.createDriver);
router.get('/drivers', storeAuth('stores_driver_read'), driverController.listDrivers);
router.get('/drivers/:driver', storeAuth('stores_driver_read'), driverController.getDriver);
router.patch('/drivers/:driver', storeAuth('stores_driver_write'), validate(V.driverUpdateValidation), driverController.updateDriver);
router.post('/drivers/:driver/deactivate', storeAuth('stores_driver_write'), driverController.deactivateDriver);
router.post('/drivers/:driver/suspend', storeAuth('stores_driver_write'), driverController.suspendDriver);
router.post('/drivers/:driver/reactivate', storeAuth('stores_driver_write'), driverController.reactivateDriver);
router.patch('/drivers/:driver/availability', storeAuth('stores_driver_write'), driverController.toggleAvailability);

// ---------------------------------------------------------------------------
// analytics
// ---------------------------------------------------------------------------
router.get('/analytics/dashboard', storeAuth('stores_analytics_read'), analyticsController.getOutletDashboard);
router.get('/analytics/chain', storeAuth('stores_analytics_read'), analyticsController.getChainAnalytics);

module.exports = router;