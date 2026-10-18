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
const appAuth = require('../../../middlewares/appAuth');
const webAuth = require('../../../middlewares/webAuth');
const validate = require('../../../middlewares/validate');

const DairyProfileValidation = require('../validations/dairy.profile.validation');
const DairyRegistrationValidation = require('../validations/dairy.registration.validation');
const DeliveryRunValidation = require('../../../kernel/delivery/validations/delivery.run.validation');
const DairyCanValidation = require('../validations/dairy.can.validation');
const DairyContainerValidation = require('../validations/dairy.container.validation');
const DairyCatalogValidation = require('../validations/dairy.catalog.validation');
const DairySubscriptionValidation = require('../validations/dairy.subscription.validation');
const DairyOrderValidation = require('../validations/dairy.order.validation');
const DairyProcurementValidation = require('../validations/dairy.procurement.validation');
const DairySettlementValidation = require('../validations/dairy.settlement.validation');
const DairyComplianceValidation = require('../validations/dairy.compliance.validation');
const DairyDashboardValidation = require('../validations/dairy.dashboard.validation');
  const DairyPartnerValidation = require('../validations/dairy.partner.validation');
  const DairyFleetValidation = require('../validations/dairy.fleet.validation');
  const DairyNotificationValidation = require('../validations/dairy.notification.validation');
  const VerticalValidation = require('../validations/vertical.validation');
const DairyPayableValidation = require('../validations/dairy.provider.payable.validation');

const DairyProfileController = require('../controllers/dairy.profile.controller');
const DairyRegistrationController = require('../controllers/dairy.registration.controller');
const DairyCanController = require('../controllers/dairy.can.controller');
const DairyContainerController = require('../controllers/dairy.container.controller');
const DairyCatalogController = require('../controllers/dairy.catalog.controller');
const DairySubscriptionController = require('../controllers/dairy.subscription.controller');
  const DairyPartnerController = require('../controllers/dairy.partner.controller');
  const DairyDriverFleetController = require('../controllers/dairy.driver.fleet.controller');
  const DairyNotificationController = require('../controllers/dairy.notification.controller');
  const VerticalController = require('../controllers/vertical.controller');
const DairyOrderController = require('../controllers/dairy.order.controller');
const DairyProcurementController = require('../controllers/dairy.procurement.controller');
const DairySettlementController = require('../controllers/dairy.settlement.controller');
const DairyComplianceController = require('../controllers/dairy.compliance.controller');
const DairyDashboardController = require('../controllers/dairy.dashboard.controller');
const { partnerAuth } = require('../middlewares/dairy.outlet');
const DairyPayableController = require('../controllers/dairy.provider.payable.controller');
const DeliveryRunController = require('../../../kernel/delivery/controllers/delivery.run.controller');

const router = express.Router();

/**
 * Dairy vertical routes.
 *
 * Mounted at `/v1/dairy` from `routes/v1/index.js`, deliberately kept out of
 * `admin.route.js` which already carries 743 routes.
 *
 * Permission strings are enforced by `middlewares/auth.factory.js` against the
 * `dairyPartner` and `dairyDriver` arrays in `config/roles.js`.
 */

// Role Resolution Routes //
// Role Resolution Routes //
// The account is taken from the token, so none of these paths carry a user id.
router.get(
  '/profile/me',
  appAuth(),
  validate(DairyProfileValidation.availableRolesValidation),
  DairyProfileController.profileMe
);
router.get(
  '/profile/available_roles',
  appAuth('dairy_available_roles'),
  validate(DairyProfileValidation.availableRolesValidation),
  DairyProfileController.availableRoles
);
router.patch(
  '/profile/switch_role',
  appAuth('dairy_switch_role'),
  validate(DairyProfileValidation.switchRoleValidation),
  DairyProfileController.switchRole
);
// Role Resolution Routes //

// Registration Routes //
// Self-registration is unauthenticated by design: a dairy operator or rider is
// recruited in the field and never provisioned by an admin. The role allowlist
// in dairy.registration.validation.js is the security boundary — `admin` and
// `accountant` are not selectable.
router.post(
  '/auth/register/send_otp',
  validate(DairyRegistrationValidation.registerOtpValidation),
  DairyRegistrationController.sendRegistrationOtp
);
router.post(
  '/auth/register/partner',
  validate(DairyRegistrationValidation.registerPartnerValidation),
  DairyRegistrationController.registerPartner
);
router.post(
  '/auth/register/driver',
  validate(DairyRegistrationValidation.registerDriverValidation),
  DairyRegistrationController.registerDriver
);
// Registration Routes //

// Joining Request Review Routes //
router.get(
  '/admin/joining-requests',
  webAuth('review_dairy_joining_request'),
  validate(DairyRegistrationValidation.listJoiningRequestsValidation),
  DairyRegistrationController.listJoiningRequests
);
router.patch(
  '/joining_request/review/:request/:id',
  webAuth('review_dairy_joining_request'),
  validate(DairyRegistrationValidation.reviewJoiningRequestValidation),
  DairyRegistrationController.reviewJoiningRequest
);
// Joining Request Review Routes //

// Delivery Run Routes — Rider //
// No rider id in any of these paths. The rider is resolved from the access token,
// so there is no client-supplied value to tamper with.
router.get(
  '/driver/run/today',
  appAuth('dairy_driver_run_today'),
  validate(DeliveryRunValidation.driverRunValidation),
  DeliveryRunController.todayRun
);
router.get(
  '/driver/runs/history',
  appAuth('dairy_driver_run_history'),
  validate(DeliveryRunValidation.agentRunsValidation),
  DeliveryRunController.agentRuns
);
router.get(
  '/driver/runs/detail/:run',
  appAuth('dairy_driver_run_detail'),
  validate(DeliveryRunValidation.runDetailValidation),
  DeliveryRunController.runDetail
);
router.patch(
  '/driver/runs/start/:run',
  appAuth('dairy_driver_run_start'),
  validate(DeliveryRunValidation.startRunValidation),
  DeliveryRunController.startRun
);
router.patch(
  '/driver/runs/complete/:run',
  appAuth('dairy_driver_run_complete'),
  validate(DeliveryRunValidation.completeRunValidation),
  DeliveryRunController.completeRun
);
router.get(
  '/driver/stops/list/:run',
  appAuth('dairy_driver_stop_list'),
  validate(DeliveryRunValidation.runDetailValidation),
  DeliveryRunController.stopList
);
router.patch(
  '/driver/stops/arrive/:stop',
  appAuth('dairy_driver_stop_arrive'),
  validate(DeliveryRunValidation.arriveStopValidation),
  DeliveryRunController.arriveStop
);
router.patch(
  '/driver/stops/deliver/:stop',
  appAuth('dairy_driver_stop_deliver'),
  validate(DeliveryRunValidation.deliverStopValidation),
  DeliveryRunController.deliverStop
);
router.patch(
  '/driver/stops/:status/:stop',
  appAuth('dairy_driver_stop_skip'),
  validate(DeliveryRunValidation.skipStopValidation),
  DeliveryRunController.markStop
);
// Delivery Run Routes — Rider //

// Delivery Run Routes — Partner //
router.post('/partner/runs/create',
  partnerAuth('dairy_partner_run_create'),
  validate(DeliveryRunValidation.createRunValidation),
  DeliveryRunController.createRun
);
router.post('/partner/runs/list',
  partnerAuth('dairy_partner_run_list'),
  validate(DeliveryRunValidation.businessRunsValidation),
  DeliveryRunController.businessRuns
);
router.get('/partner/runs/detail/:run',
  partnerAuth('dairy_partner_run_detail'),
  validate(DeliveryRunValidation.runDetailValidation),
  DeliveryRunController.runDetail
);
router.patch('/partner/runs/cancel/:run',
  partnerAuth('dairy_partner_run_cancel'),
  validate(DeliveryRunValidation.cancelRunValidation),
  DeliveryRunController.runCancel
);
// Delivery Run Routes — Partner //

// Can / Deposit Routes — Rider //
// `clientRef` is required on every scan: the rider captures offline and replays
// on reconnect, so the same movement can arrive twice.
router.patch(
  '/driver/cans/pickup_scan',
  appAuth('dairy_driver_can_pickup_scan'),
  validate(DairyCanValidation.pickupScanValidation),
  DairyCanController.pickupScan
);
router.patch(
  '/driver/cans/issue_scan',
  appAuth('dairy_driver_can_issue_scan'),
  validate(DairyCanValidation.issueScanValidation),
  DairyCanController.issueScan
);
router.patch(
  '/driver/cans/collect_scan',
  appAuth('dairy_driver_can_collect_scan'),
  validate(DairyCanValidation.collectScanValidation),
  DairyCanController.collectScan
);
router.get(
  '/driver/cans/deposit_summary',
  appAuth('dairy_driver_can_deposit_summary'),
  validate(DairyCanValidation.depositSummaryValidation),
  DairyCanController.depositSummary
);
router.get(
  '/driver/cans/run_balance/:run',
  appAuth('dairy_driver_can_deposit_summary'),
  validate(DairyCanValidation.runBalanceValidation),
  DairyCanController.runBalance
);
// Can / Deposit Routes — Rider //

// Can / Deposit Routes — Partner //
router.post('/partner/cans/list',
  partnerAuth('dairy_partner_can_list'),
  validate(DairyCanValidation.canListValidation),
  DairyCanController.canList
);
router.post('/partner/cans/create',
  partnerAuth('dairy_partner_can_list'),
  validate(DairyCanValidation.createCanValidation),
  DairyCanController.createCan
);
router.post('/partner/cans/import',
  partnerAuth('dairy_partner_can_list'),
  validate(DairyCanValidation.importCansValidation),
  DairyCanController.importCans
);
router.patch('/partner/cans/reconcile/:run',
  partnerAuth('dairy_partner_can_reconcile'),
  validate(DairyCanValidation.reconcileValidation),
  DairyCanController.reconcile
);
router.patch('/partner/cans/write_off/:can',
  partnerAuth('dairy_partner_can_reconcile'),
  validate(DairyCanValidation.writeOffValidation),
  DairyCanController.writeOff
);
// Container Rotation Routes — Partner //
/**
 * Two-bottle rotation, for reusable-container recurring milk deliveries only.
 * `DairySku.reusableContainer === false` (curd, ghee, paneer, cheese, cream) can
 * never be enrolled — `assignContainers` rejects it server-side.
 */
router.post('/partner/containers/assign',
  partnerAuth('dairy_partner_container_assign'),
  validate(DairyContainerValidation.assignContainerValidation),
  DairyContainerController.assignContainers
);
router.patch('/partner/containers/release/:assignment',
  partnerAuth('dairy_partner_container_release'),
  validate(DairyContainerValidation.releaseContainerValidation),
  DairyContainerController.releaseContainers
);
router.get('/partner/containers/view',
  partnerAuth('dairy_partner_container_view'),
  validate(DairyContainerValidation.rotationViewValidation),
  DairyContainerController.rotationView
);
router.get('/partner/containers/lifecycle_summary',
  partnerAuth('dairy_partner_container_lifecycle'),
  validate(DairyContainerValidation.lifecycleSummaryValidation),
  DairyContainerController.lifecycleSummary
);
// Container Rotation Routes — Partner //

// Container Lifecycle Routes — Dairy Unit //
// wash → inspect → refill. `action` is constrained by the route so a client
// cannot smuggle an arbitrary transition past the state machine.
router.patch('/partner/containers/:action/:can',
  partnerAuth('dairy_partner_container_lifecycle'),
  validate(DairyContainerValidation.lifecycleValidation),
  DairyContainerController.advanceLifecycle
);
// Container Lifecycle Routes — Dairy Unit //

// Container Rotation Routes — Rider //
router.post(
  '/driver/containers/swap_plan/:id',
  appAuth('dairy_driver_container_swap_plan'),
  validate(DairyContainerValidation.planSwapValidation),
  DairyContainerController.planSwap
);
router.patch(
  '/driver/containers/swap_complete/:assignment/:id',
  appAuth('dairy_driver_container_swap_complete'),
  validate(DairyContainerValidation.completeSwapValidation),
  DairyContainerController.completeSwap
);
// Container Rotation Routes — Rider //

// Catalog Public Read Routes //
// Browsing the catalogue needs no session — the customer app shows dairy before
// login. Only reads are exposed unauthenticated; every mutation is gated below.
router.get('/catalog/tree', validate(DairyCatalogValidation.treeValidation), DairyCatalogController.categoryTree);
router.get(
  '/catalog/categories',
  validate(DairyCatalogValidation.categoryListValidation),
  DairyCatalogController.categoryList
);
router.get(
  '/catalog/sub_categories',
  validate(DairyCatalogValidation.subCategoryListValidation),
  DairyCatalogController.subCategoryList
);
router.get('/catalog/brands', validate(DairyCatalogValidation.brandListValidation), DairyCatalogController.brandList);
router.get('/catalog/products', validate(DairyCatalogValidation.productListValidation), DairyCatalogController.productList);
router.get(
  '/catalog/products/search',
  validate(DairyCatalogValidation.searchValidation),
  DairyCatalogController.productSearch
);
router.get(
  '/catalog/products/:id',
  validate(DairyCatalogValidation.productDetailValidation),
  DairyCatalogController.productDetail
);
// Catalog Public Read Routes //

// Catalog Management Routes — Admin //
// Taxonomy (category / sub-category / brand) is platform-wide, so it is an admin
// concern rather than per-outlet.
router.post(
  '/admin/catalog/categories',
  webAuth('dairy_catalog_manage'),
  validate(DairyCatalogValidation.categoryCreateValidation),
  DairyCatalogController.categoryCreate
);
router.patch(
  '/admin/catalog/categories/:id',
  webAuth('dairy_catalog_manage'),
  validate(DairyCatalogValidation.categoryUpdateValidation),
  DairyCatalogController.categoryUpdate
);
router.delete(
  '/admin/catalog/categories/:id',
  webAuth('dairy_catalog_manage'),
  validate(DairyCatalogValidation.deleteValidation),
  DairyCatalogController.categoryDelete
);
router.post(
  '/admin/catalog/sub_categories',
  webAuth('dairy_catalog_manage'),
  validate(DairyCatalogValidation.subCategoryCreateValidation),
  DairyCatalogController.subCategoryCreate
);
router.patch(
  '/admin/catalog/sub_categories/:id',
  webAuth('dairy_catalog_manage'),
  validate(DairyCatalogValidation.subCategoryUpdateValidation),
  DairyCatalogController.subCategoryUpdate
);
router.delete(
  '/admin/catalog/sub_categories/:id',
  webAuth('dairy_catalog_manage'),
validate(DairyCatalogValidation.deleteValidation),
    DairyCatalogController.subCategoryDelete
);
router.post(
  '/admin/catalog/brands',
  webAuth('dairy_catalog_manage'),
  validate(DairyCatalogValidation.brandCreateValidation),
  DairyCatalogController.brandCreate
);
router.patch(
  '/admin/catalog/brands/:id',
  webAuth('dairy_catalog_manage'),
  validate(DairyCatalogValidation.brandUpdateValidation),
  DairyCatalogController.brandUpdate
);
// Brands were the one taxonomy entity with no delete, so the admin screen had
// create and edit but no way to retire one. Refused while a product references
// it, matching the category and sub-category deletes.
router.delete(
  '/admin/catalog/brands/:id',
  webAuth('dairy_catalog_manage'),
  validate(DairyCatalogValidation.brandDeleteValidation),
  DairyCatalogController.brandDelete
);

// Admin reads of the taxonomy.
//
// The public `/catalog/*` routes serve the storefront and filter to `status: true`,
// which is right for browsing but not for an operator who needs to see a disabled
// row to re-enable it. These are the same handlers behind `webAuth`, so the admin
// list and the storefront list cannot drift apart.
router.get(
  '/admin/catalog/categories',
  webAuth('dairy_catalog_view'),
  validate(DairyCatalogValidation.categoryListValidation),
  DairyCatalogController.categoryList
);
router.get(
  '/admin/catalog/sub_categories',
  webAuth('dairy_catalog_view'),
  validate(DairyCatalogValidation.subCategoryListValidation),
  DairyCatalogController.subCategoryList
);
router.get(
  '/admin/catalog/brands',
  webAuth('dairy_catalog_view'),
  validate(DairyCatalogValidation.brandListValidation),
  DairyCatalogController.brandList
);
router.get(
  '/admin/catalog/health',
  webAuth('dairy_catalog_view'),
  validate(DairyCatalogValidation.allValidation),
  DairyCatalogController.catalogHealth
);
// Catalog Management Routes — Admin //

// Catalog Routes — Partner //
// Products and pack sizes are per-outlet: each outlet curates its own list with
// its own price and stock.
router.post('/partner/products',
  partnerAuth('dairy_partner_product_add'),
  validate(DairyCatalogValidation.productCreateValidation),
  DairyCatalogController.productCreate
);
router.patch('/partner/products/:id',
  partnerAuth('dairy_partner_product_update'),
  validate(DairyCatalogValidation.productUpdateValidation),
  DairyCatalogController.productUpdate
);
router.delete('/partner/products/:id',
  partnerAuth('dairy_partner_product_update'),
  validate(DairyCatalogValidation.productDetailValidation),
  DairyCatalogController.productDelete
);
router.post('/partner/products/import',
  partnerAuth('dairy_partner_product_add'),
  validate(DairyCatalogValidation.importProductsValidation),
  DairyCatalogController.importProducts
);
router.post('/partner/skus',
  partnerAuth('dairy_partner_stock_adjust'),
  validate(DairyCatalogValidation.skuCreateValidation),
  DairyCatalogController.skuCreate
);
router.patch('/partner/skus/:id',
  partnerAuth('dairy_partner_stock_adjust'),
  validate(DairyCatalogValidation.skuUpdateValidation),
  DairyCatalogController.skuUpdate
);
router.patch('/partner/skus/:id/stock',
  partnerAuth('dairy_partner_stock_adjust'),
  validate(DairyCatalogValidation.stockAdjustValidation),
  DairyCatalogController.stockAdjust
);
router.get('/partner/skus/list',
  partnerAuth('dairy_partner_inventory_list'),
  validate(DairyCatalogValidation.skuListValidation),
  DairyCatalogController.skuList
);
// Catalog Routes — Partner //

// Subscription Routes — Customer //
// A subscription is a purchase mode, not a category: it produces recurring
// deliveries rather than sitting in the catalogue tree.
router.post(
  '/customer/subscriptions',
  appAuth('dairy_customer_subscription_create'),
  validate(DairySubscriptionValidation.createValidation),
  DairySubscriptionController.create
);
router.get(
  '/customer/subscriptions',
  appAuth('dairy_customer_subscription_list'),
  validate(DairySubscriptionValidation.listValidation),
  DairySubscriptionController.list
);
router.get(
  '/customer/subscriptions/:subscription',
  appAuth('dairy_customer_subscription_list'),
  validate(DairySubscriptionValidation.detailValidation),
  DairySubscriptionController.detail
);
router.get(
  '/customer/subscriptions/:subscription/upcoming',
  appAuth('dairy_customer_subscription_list'),
  validate(DairySubscriptionValidation.upcomingValidation),
  DairySubscriptionController.upcoming
);
router.get(
  '/customer/subscriptions/:subscription/events',
  appAuth('dairy_customer_subscription_list'),
  validate(DairySubscriptionValidation.eventsValidation),
  DairySubscriptionController.events
);
// Lifecycle — all twelve operations append to the event log.
router.post(
  '/customer/subscriptions/:subscription/skip',
  appAuth('dairy_customer_subscription_skip'),
  validate(DairySubscriptionValidation.skipValidation),
  DairySubscriptionController.skip
);
router.post(
  '/customer/subscriptions/:subscription/unskip',
  appAuth('dairy_customer_subscription_skip'),
  validate(DairySubscriptionValidation.skipValidation),
  DairySubscriptionController.unskip
);
router.post(
  '/customer/subscriptions/:subscription/pause',
  appAuth('dairy_customer_subscription_manage'),
  validate(DairySubscriptionValidation.pauseValidation),
  DairySubscriptionController.pause
);
router.post(
  '/customer/subscriptions/:subscription/resume',
  appAuth('dairy_customer_subscription_manage'),
  validate(DairySubscriptionValidation.actorValidation),
  DairySubscriptionController.resume
);
router.patch(
  '/customer/subscriptions/:subscription/quantity',
  appAuth('dairy_customer_subscription_manage'),
  validate(DairySubscriptionValidation.quantityValidation),
  DairySubscriptionController.changeQuantity
);
router.patch(
  '/customer/subscriptions/:subscription/address',
  appAuth('dairy_customer_subscription_manage'),
  validate(DairySubscriptionValidation.addressValidation),
  DairySubscriptionController.changeAddress
);
router.patch(
  '/customer/subscriptions/:subscription/schedule',
  appAuth('dairy_customer_subscription_manage'),
  validate(DairySubscriptionValidation.scheduleValidation),
  DairySubscriptionController.changeSchedule
);
router.post(
  '/customer/subscriptions/:subscription/cancel',
  appAuth('dairy_customer_subscription_manage'),
  validate(DairySubscriptionValidation.cancelValidation),
  DairySubscriptionController.cancel
);
router.post(
  '/customer/subscriptions/:subscription/reactivate',
  appAuth('dairy_customer_subscription_manage'),
  validate(DairySubscriptionValidation.actorValidation),
  DairySubscriptionController.reactivate
);
// Subscription Routes — Customer //

// Manifest Routes — Partner //
// The nightly job calls `generateManifest`; these endpoints let an operator
// preview, force a run for a date, and forecast procurement demand.
router.get('/partner/manifest/preview',
  partnerAuth('dairy_partner_manifest_preview'),
  validate(DairySubscriptionValidation.manifestDateValidation),
  DairySubscriptionController.manifestPreview
);
router.post('/partner/manifest/generate',
  partnerAuth('dairy_partner_manifest_generate'),
  validate(DairySubscriptionValidation.manifestDateValidation),
  DairySubscriptionController.manifestGenerate
);
router.get('/partner/manifest/summary',
  partnerAuth('dairy_partner_manifest_preview'),
  validate(DairySubscriptionValidation.manifestDateValidation),
  DairySubscriptionController.manifestSummary
);
router.get('/partner/manifest/forecast',
  partnerAuth('dairy_partner_manifest_preview'),
  validate(DairySubscriptionValidation.manifestDateValidation),
  DairySubscriptionController.demandForecast
);
// Manifest Routes — Partner //

// One-Time Purchase Routes — Customer //
// Category → Product → Quantity → Cart → Checkout → Payment → Order → Delivery
router.post(
  '/customer/cart/items',
  appAuth('dairy_customer_cart_manage'),
  validate(DairyOrderValidation.addToCartValidation),
  DairyOrderController.addToCart
);
router.get('/customer/cart', appAuth('dairy_customer_cart_manage'), DairyOrderController.getCart);
router.patch(
  '/customer/cart/items/:item',
  appAuth('dairy_customer_cart_manage'),
  validate(DairyOrderValidation.updateCartQuantityValidation),
  DairyOrderController.updateCartQuantity
);
router.delete(
  '/customer/cart/items/:item',
  appAuth('dairy_customer_cart_manage'),
  validate(DairyOrderValidation.cartItemValidation),
  DairyOrderController.removeCartItem
);
router.delete('/customer/cart', appAuth('dairy_customer_cart_manage'), DairyOrderController.clearCart);
router.get(
  '/customer/cart/price_check',
  appAuth('dairy_customer_cart_manage'),
  DairyOrderController.refreshPrices
);
router.post(
  '/customer/cart/price_apply',
  appAuth('dairy_customer_cart_manage'),
  validate(DairyOrderValidation.applyPriceChangesValidation),
  DairyOrderController.applyPriceChanges
);
router.post(
  '/customer/orders/checkout',
  appAuth('dairy_customer_order_create'),
  validate(DairyOrderValidation.checkoutValidation),
  DairyOrderController.checkout
);
router.post(
  '/customer/orders/:order/pay',
  appAuth('dairy_customer_order_pay'),
  validate(DairyOrderValidation.payValidation),
  DairyOrderController.pay
);
router.get(
  '/customer/orders',
  appAuth('dairy_customer_order_list'),
  validate(DairyOrderValidation.orderListValidation),
  DairyOrderController.orderList
);
// Customer Order Summary Routes //
// Declared BEFORE `/customer/orders/:order`. Express matches in registration
// order, so a literal segment after a `:param` route is unreachable — the
// request for `/summary` was being read as an order id called "summary".
router.get(
  '/customer/orders/summary',
  appAuth('dairy_customer_order_list'),
  validate(DairyOrderValidation.orderSummaryValidation),
  DairyOrderController.orderSummary
);
// Customer Order Summary Routes //
router.get(
  '/customer/orders/:order',
  appAuth('dairy_customer_order_list'),
  validate(DairyOrderValidation.orderDetailValidation),
  DairyOrderController.orderDetail
);
router.get(
  '/customer/orders/:order/history',
  appAuth('dairy_customer_order_list'),
  validate(DairyOrderValidation.orderHistoryValidation),
  DairyOrderController.orderHistory
);
router.post(
  '/customer/orders/:order/cancel',
  appAuth('dairy_customer_order_cancel'),
  validate(DairyOrderValidation.cancelValidation),
  DairyOrderController.cancel
);
// One-Time Purchase Routes — Customer //

// Order Fulfilment Routes — Partner //
router.get('/partner/orders/list',
  partnerAuth('dairy_partner_order_manage'),
  validate(DairyOrderValidation.orderListValidation),
  DairyOrderController.orderList
);
router.post('/partner/orders/:order/dispatch',
  partnerAuth('dairy_partner_order_dispatch'),
  validate(DairyOrderValidation.dispatchValidation),
  DairyOrderController.dispatch
);
router.get('/partner/orders/summary',
  partnerAuth('dairy_partner_order_summary'),
  validate(DairyOrderValidation.summaryValidation),
  DairyOrderController.partnerOrderSummary
);
// Order Fulfilment Routes — Partner //

// Order Status Routes //
// `status` is constrained by the route so the transition table in the service is
// the only thing that can change an order's state.
router.patch(
// `partnerAuth`, not `appAuth`: this is a partner-only route and `updateStatus`
    // now scopes by `req.outletId`, which only `partnerAuth` populates.
    '/orders/:status/:order',
    partnerAuth('dairy_partner_order_manage'),
    validate(DairyOrderValidation.statusValidation),
    DairyOrderController.updateStatus
);
// Order Status Routes //

// Procurement Routes — Partner //
// Milk Provider → LocalWala Procurement → Collection → Quality Check
//                 → Accept / Reject → Milk Batch
router.post('/partner/providers',
  partnerAuth('dairy_partner_provider_manage'),
  validate(DairyProcurementValidation.providerCreateValidation),
  DairyProcurementController.providerCreate
);
router.get('/partner/providers/:id',
  partnerAuth('dairy_partner_provider_manage'),
  validate(DairyProcurementValidation.providerListValidation),
  DairyProcurementController.providerList
);
router.patch('/partner/providers/:provider',
  partnerAuth('dairy_partner_provider_manage'),
  validate(DairyProcurementValidation.providerUpdateValidation),
  DairyProcurementController.providerUpdate
);
router.get('/partner/rejection_reasons',
    partnerAuth('dairy_partner_collection_review'),
    validate(DairyProcurementValidation.rejectionReasonListValidation),
    DairyProcurementController.rejectionReasonList
    );
router.post('/partner/rejection_reasons',
  partnerAuth('dairy_partner_collection_review'),
  validate(DairyProcurementValidation.rejectionReasonValidation),
  DairyProcurementController.rejectionReasonCreate
);
router.post('/partner/collections',
  partnerAuth('dairy_partner_collection_record'),
  validate(DairyProcurementValidation.collectionCreateValidation),
  DairyProcurementController.collectionCreate
);
router.get('/partner/collections',
  partnerAuth('dairy_partner_collection_review'),
  validate(DairyProcurementValidation.collectionListValidation),
  DairyProcurementController.collectionList
);
router.patch('/partner/collections/:collection/accept',
  partnerAuth('dairy_partner_collection_review'),
  validate(DairyProcurementValidation.acceptCollectionValidation),
  DairyProcurementController.collectionAccept
);
router.patch('/partner/collections/:collection/reject',
  partnerAuth('dairy_partner_collection_review'),
  validate(DairyProcurementValidation.rejectCollectionValidation),
  DairyProcurementController.collectionReject
);
router.get('/partner/batches',
  partnerAuth('dairy_partner_batch_view'),
  validate(DairyProcurementValidation.batchListValidation),
  DairyProcurementController.batchList
);
/** FEFO preview — which batches a quantity would draw from, oldest first. */
router.post('/partner/batches/fefo_preview',
  partnerAuth('dairy_partner_batch_view'),
  validate(DairyProcurementValidation.fefoPreviewValidation),
  DairyProcurementController.fefoPreview
);
router.patch('/partner/batches/:batch/shrinkage',
  partnerAuth('dairy_partner_batch_shrinkage'),
  validate(DairyProcurementValidation.shrinkageValidation),
  DairyProcurementController.shrinkageRecord
);
router.get('/partner/reports/shrinkage',
  partnerAuth('dairy_partner_reports_procurement'),
  validate(DairyProcurementValidation.reportValidation),
  DairyProcurementController.shrinkageReport
);
router.get('/partner/reports/provider_payable',
  partnerAuth('dairy_partner_reports_procurement'),
  validate(DairyProcurementValidation.reportValidation),
  DairyProcurementController.providerPayable
);
// Procurement Routes — Partner //

// Partner Agreement Routes — Admin //
// commission_partner: the platform OWES the partner a cut of their sales.
router.post(
  '/admin/partners',
  webAuth('dairy_partner_manage'),
  validate(DairySettlementValidation.partnerCreateValidation),
  DairySettlementController.partnerCreate
);
router.get(
  '/admin/partners',
  webAuth('dairy_partner_manage'),
  validate(DairySettlementValidation.partnerListValidation),
  DairySettlementController.partnerList
);
router.patch(
  '/admin/partners/:partner',
  webAuth('dairy_partner_manage'),
  validate(DairySettlementValidation.partnerUpdateValidation),
  DairySettlementController.partnerUpdate
);
router.patch(
  '/admin/partners/:partner/:status',
  webAuth('dairy_partner_manage'),
  validate(DairySettlementValidation.partnerStatusValidation),
  DairySettlementController.partnerStatus
);
// Partner Agreement Routes — Admin //

// Franchise Agreement Routes — Admin //
// franchise: the franchisee OWES the platform a revenue share.
// Candidate operators for the franchise create form. Needed because nothing else
// could list them: the platform's only user search is filtered to `role: 'user'`,
// which is customers.
router.get(
  '/admin/franchise-operators',
  webAuth('dairy_franchise_manage'),
  validate(DairySettlementValidation.franchiseOperatorListValidation),
  DairySettlementController.franchiseOperatorList
);
router.post(
  '/admin/franchises',
  webAuth('dairy_franchise_manage'),
  validate(DairySettlementValidation.franchiseCreateValidation),
  DairySettlementController.franchiseCreate
);
router.get(
  '/admin/franchises',
  webAuth('dairy_franchise_manage'),
  validate(DairySettlementValidation.franchiseListValidation),
  DairySettlementController.franchiseList
);
router.patch(
  '/admin/franchises/:franchise/:status',
  webAuth('dairy_franchise_manage'),
  validate(DairySettlementValidation.franchiseStatusValidation),
  DairySettlementController.franchiseStatus
);
// Franchise Agreement Routes — Admin //

// Settlement Routes //
// `netAmount` is positive when the platform owes the counterparty and negative
// when the counterparty owes the platform, across both settlement types.
router.post(
  '/settlements/generate',
  webAuth('dairy_settlement_generate'),
  validate(DairySettlementValidation.generateValidation),
  DairySettlementController.settlementGenerate
);
router.post(
  '/settlements/preview',
  appAuth('dairy_settlement_preview'),
  validate(DairySettlementValidation.generateValidation),
  DairySettlementController.settlementPreview
);
router.get(
  '/settlements',
  webAuth('dairy_settlement_view'),
  validate(DairySettlementValidation.settlementListValidation),
  DairySettlementController.settlementList
);
router.get(
  '/settlements/:settlement',
  appAuth('dairy_settlement_view'),
    validate(DairySettlementValidation.settlementDetailValidation),
    DairySettlementController.settlementDetail
);
router.get(
  '/settlements/summary/all',
  webAuth('dairy_settlement_view'),
  validate(DairySettlementValidation.settlementSummaryValidation),
  DairySettlementController.settlementSummary
);
// Settlement Routes — Partner //
router.post('/partner/settlements/request',
  partnerAuth('dairy_settlement_request'),
  validate(DairySettlementValidation.generateValidation),
  DairySettlementController.settlementGenerate
);
router.get('/partner/settlements/list',
  partnerAuth('dairy_settlement_view'),
  validate(DairySettlementValidation.settlementListValidation),
  DairySettlementController.settlementList
);
// Settlement Routes — Partner //

// Settlement Status Routes — Admin //
// `status` is constrained by the route so the transition table is the only thing
// that can move a settlement.
router.patch(
  '/settlements/:status/:settlement',
  webAuth('dairy_settlement_approve'),
  validate(DairySettlementValidation.settlementStatusValidation),
  DairySettlementController.settlementStatus
);
router.post(
  '/settlements/:settlement/pay',
  webAuth('dairy_settlement_pay'),
  validate(DairySettlementValidation.settlementPayValidation),
  DairySettlementController.settlementPay
);
// Settlement Status Routes — Admin //

// Partner Dashboard Routes //
// One call for the whole home screen, rather than six round trips before the
// operator sees anything. The outlet comes from the token.
router.get('/partner/dashboard',
  partnerAuth('dairy_partner_dashboard'),
  validate(DairyDashboardValidation.dashboardValidation),
  DairyDashboardController.dashboard
);
// Partner Dashboard Routes //

// Partner Outlet Views — Subscriptions, Customers, Fleet, Earnings //
//
// The four screens the partner app still could not bind. All of them read
// `req.outletId` from the token; none takes an outlet from the client, which is
// why none of these paths carries an `:id` for the business.

// Declared before `/partner/subscriptions/:subscription/...` below only in the
// sense that they take no conflicting parameter — Express matches literally, so
// `list` cannot be swallowed by a `:subscription` segment.
router.get('/partner/subscriptions/list',
  partnerAuth('dairy_partner_subscription_list'),
  validate(DairySubscriptionValidation.partnerListValidation),
  DairyPartnerController.subscriptionList
);

router.patch('/partner/subscriptions/:subscription/pause',
  partnerAuth('dairy_partner_subscription_pause'),
  validate(DairySubscriptionValidation.partnerPauseValidation),
  DairyPartnerController.subscriptionPause
);

router.patch('/partner/subscriptions/:subscription/resume',
  partnerAuth('dairy_partner_subscription_resume'),
  validate(DairySubscriptionValidation.partnerResumeValidation),
  DairyPartnerController.subscriptionResume
);

router.get('/partner/customers/list',
  partnerAuth('dairy_partner_customer_list'),
  validate(DairyPartnerValidation.customerListValidation),
  DairyPartnerController.customerList
);

router.get('/partner/drivers/list',
  partnerAuth('dairy_partner_driver_list'),
  validate(DairyPartnerValidation.driverListValidation),
  DairyPartnerController.driverList
);

// Fleet management. The invitation is a phone number, not a half-made account:
// the rider joins when they register with it, which is also what proves the
// invitation is real.
router.post('/partner/drivers/invite',
  partnerAuth('dairy_partner_driver_invite'),
  validate(DairyFleetValidation.driverInviteValidation),
  DairyPartnerController.driverInvite
);

router.get('/partner/drivers/invites',
  partnerAuth('dairy_partner_driver_list'),
  validate(DairyFleetValidation.driverInviteListValidation),
  DairyPartnerController.driverInvites
);

router.delete('/partner/drivers/invites/:invite',
  partnerAuth('dairy_partner_driver_invite'),
  validate(DairyFleetValidation.driverInviteRevokeValidation),
  DairyPartnerController.driverInviteRevoke
);

router.patch('/partner/drivers/:driver/approval',
  partnerAuth('dairy_partner_driver_approve'),
  validate(DairyFleetValidation.driverApprovalValidation),
  DairyPartnerController.driverApproval
);

router.delete('/partner/drivers/:driver',
  partnerAuth('dairy_partner_driver_remove'),
  validate(DairyFleetValidation.driverRemoveValidation),
  DairyPartnerController.driverRemove
);

router.post('/partner/drivers/:driver/payout',
  partnerAuth('dairy_partner_driver_payout'),
  validate(DairyFleetValidation.driverPayoutValidation),
  DairyPartnerController.driverPayout
);

// Notifications. One surface for partners and riders: a notice is addressed to
  // a person, not to a role. There is no `user` parameter - the reader is always
  // the signed-in account.
router.get('/notification/list',
  appAuth(),
  validate(DairyNotificationValidation.listValidation),
  DairyNotificationController.list
);

router.patch('/notification/read_all',
  appAuth(),
  validate(DairyNotificationValidation.markReadValidation),
  DairyNotificationController.markRead
);

router.delete('/notification/:notification',
  appAuth(),
  validate(DairyNotificationValidation.dismissValidation),
  DairyNotificationController.dismiss
);

// Rider-side money. Scoped to the rider's own `DairyDriver` record, never to a
// client-supplied id, so a rider cannot read another's earnings.
router.get('/driver/earnings',
  appAuth('dairy_driver_run_today'),
  validate(DairyFleetValidation.driverPeriodValidation),
  DairyDriverFleetController.earnings
);

router.get('/driver/cash_in_hand',
  appAuth('dairy_driver_can_deposit_summary'),
  validate(DairyFleetValidation.driverPeriodValidation),
  DairyDriverFleetController.cashInHand
);

router.post('/driver/cash_deposit',
  appAuth('dairy_driver_can_deposit_summary'),
  validate(DairyFleetValidation.cashDepositValidation),
  DairyDriverFleetController.cashDeposit
);

router.get('/partner/earnings',
  partnerAuth('dairy_partner_earnings'),
  validate(DairyPartnerValidation.earningsValidation),
  DairyPartnerController.earnings
);

router.get('/partner/settlements',
  partnerAuth('dairy_partner_settlements'),
  validate(DairyPartnerValidation.settlementListValidation),
  DairyPartnerController.settlementList
);

// Partner Outlet Views //

// Compliance Routes — Partner //
// `:id` is the outlet. Status is always derived from the licence dates on read,
// so an expired licence cannot be shown as valid by a stale cache.
router.get('/partner/compliance',
  partnerAuth('dairy_compliance_view'),
  validate(DairyComplianceValidation.complianceScopeValidation),
  DairyComplianceController.complianceDetail
);
router.get('/partner/compliance/summary',
  partnerAuth('dairy_compliance_view'),
  validate(DairyComplianceValidation.complianceScopeValidation),
  DairyComplianceController.complianceSummary
);
router.put('/partner/compliance/fssai',
  partnerAuth('dairy_compliance_manage'),
  validate(DairyComplianceValidation.setLicenceValidation),
  DairyComplianceController.licenceSet
);
router.post('/partner/compliance/hygiene',
  partnerAuth('dairy_compliance_manage'),
  validate(DairyComplianceValidation.hygieneCheckValidation),
  DairyComplianceController.hygieneCheckRecord
);
router.post('/partner/compliance/documents',
  partnerAuth('dairy_compliance_manage'),
  validate(DairyComplianceValidation.addDocumentValidation),
  DairyComplianceController.documentAdd
);
// Compliance Routes — Partner //

// Vertical Registry Routes — Admin //
//
// The switch that stops a business line taking new trading. Reads and everything
// already in progress carry on, so a rider mid-run is never stranded — see
// `kernel/vertical/services/vertical.service.js`.
router.get(
  '/admin/verticals',
  webAuth('dairy_vertical_manage'),
  validate(VerticalValidation.listValidation),
  VerticalController.list
);
router.patch(
  '/admin/verticals/:key',
  webAuth('dairy_vertical_manage'),
  validate(VerticalValidation.setStatusValidation),
  VerticalController.setStatus
);
// Vertical Registry Routes — Admin //

// Compliance Routes — Admin //
// Platform-wide sweeps: which outlets are non-compliant, and re-derive every
// cached status after a bulk import.
router.get(
  '/admin/compliance/expiring',
  webAuth('dairy_compliance_audit'),
  validate(DairyComplianceValidation.expiringValidation),
  DairyComplianceController.complianceExpiring
);
router.post(
  '/admin/compliance/refresh',
  webAuth('dairy_compliance_audit'),
  DairyComplianceController.complianceRefresh
);
// Compliance Routes — Admin //

// Provider Payable Routes — Partner //
// `:id` is the outlet. Generation is a draft so a provider can dispute the figure
// before the platform approves and pays it.
router.post('/partner/payables/generate',
  partnerAuth('dairy_payables_manage'),
  validate(DairyPayableValidation.generateValidation),
  DairyPayableController.payableGenerate
);
router.get('/partner/payables/:id',
  partnerAuth('dairy_payables_view'),
  validate(DairyPayableValidation.payableScopeValidation),
  DairyPayableController.payableDetail
);
router.get('/partner/payables/list',
  partnerAuth('dairy_payables_view'),
  validate(DairyPayableValidation.payableScopeValidation),
  DairyPayableController.payableList
);
router.post('/partner/payables/:id/adjustments',
  partnerAuth('dairy_payables_manage'),
  validate(DairyPayableValidation.adjustmentValidation),
  DairyPayableController.payableAdjust
);
// Provider Payable Routes — Partner //

// Provider Payable Status Routes — Partner //
// `status` is constrained by the route so the transition table is the only way to
// move a statement. `paid` has its own route because it settles the collections.
router.patch('/partner/payables/:id/:status',
  partnerAuth('dairy_payables_manage'),
  validate(DairyPayableValidation.statusValidation),
  DairyPayableController.payableStatus
);
router.patch('/partner/payables/:id/void',
  partnerAuth('dairy_payables_manage'),
  validate(DairyPayableValidation.statusValidation),
  DairyPayableController.payableVoid
);
router.post('/partner/payables/:id/pay',
  partnerAuth('dairy_payables_pay'),
  validate(DairyPayableValidation.payValidation),
  DairyPayableController.payablePay
);
// Provider Payable Status Routes — Partner //

module.exports = router;
