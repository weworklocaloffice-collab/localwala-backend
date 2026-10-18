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
const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const appAuth = require('../../../middlewares/appAuth');
// Required for the §7.2 customer bodies. Without it these routes accepted anything and
// failed deep inside Mongoose as CastErrors instead of answering with a useful 400.
const validate = require('../../../middlewares/validate');
const V = require('../validations/stores.validation');
const eligibilityService = require('../services/stores.eligibility.service');
const cartService = require('../services/stores.cart.service');
const checkoutService = require('../services/stores.checkout.service');
const catalogService = require('../services/stores.catalog.service');
const orderService = require('../services/stores.order.service');
const paymentService = require('../services/stores.payment.service');
const customerSubscriptionService = require('../services/stores.customer.subscription.service');
const returnService = require('../services/stores.return.service');
const reviewService = require('../services/stores.review.service');

const router = express.Router();

const listNearbyStores = async (req, res) => {
  const { lat, lng, radiusKm = 10 } = req.query;
  if (!lat || !lng) throw new ApiError(httpStatus.BAD_REQUEST, 'lat and lng are required');
  const outlets = await eligibilityService.getNearbyOutlets({ lat: Number(lat), lng: Number(lng), radiusKm: Number(radiusKm) });
  res.status(httpStatus.OK).send({ outlets });
};

const searchProducts = async (req, res) => {
  const result = await catalogService.listProducts({ ...req.query, search: req.query.q, outlet: req.params.store });
  res.status(httpStatus.OK).send(result);
};

const getProductDetail = async (req, res) => {
  const product = await catalogService.getProduct(req.params.product);
  res.status(httpStatus.OK).send({ product });
};

const addToCart = async (req, res) => {
  const cart = await cartService.addToCart({
    customer: req.user._id,
    outlet: req.body.outlet,
    chain: req.body.chain,
    product: req.body.product,
    variant: req.body.variant,
    quantity: req.body.quantity,
    unitPrice: req.body.unitPrice,
    name: req.body.name,
    variantName: req.body.variantName,
    image: req.body.image,
    sku: req.body.sku,
    attributes: req.body.attributes,
    isOrganic: req.body.isOrganic,
  });
  res.status(httpStatus.OK).send({ cart });
};

const updateCart = async (req, res) => {
  const cart = await cartService.updateCartItem({
    customer: req.user._id,
    outlet: req.body.outlet,
    variant: req.body.variant,
    quantity: req.body.quantity,
  });
  res.status(httpStatus.OK).send({ cart });
};

const removeFromCart = async (req, res) => {
  const cart = await cartService.removeFromCart({
    customer: req.user._id,
    outlet: req.body.outlet,
    variant: req.body.variant,
  });
  res.status(httpStatus.OK).send({ cart });
};

const clearCart = async (req, res) => {
  const cart = await cartService.clearCart({ customer: req.user._id, outlet: req.body.outlet });
  res.status(httpStatus.OK).send({ cart });
};

const getCart = async (req, res) => {
  const cart = await cartService.getCart(req.user._id, req.query.outlet);
  res.status(httpStatus.OK).send({ cart });
};

const checkoutEligibility = async (req, res) => {
  const result = await checkoutService.validateCheckoutEligibility(req.body);
  res.status(httpStatus.OK).send(result);
};

const checkoutSummary = async (req, res) => {
  const summary = await checkoutService.getCheckoutSummary({
    customer: req.user._id,
    outlet: req.body.outlet,
    chain: req.body.chain,
    address: req.body.address,
    promoCode: req.body.promoCode,
    couponCode: req.body.couponCode,
    paymentMode: req.body.paymentMode,
  });
  res.status(httpStatus.OK).send(summary);
};

const createOrder = async (req, res) => {
  // `addressId` + `addressSnapshot`, NOT `address`.
  //
  // `StoreOrder.address` is `ObjectId ref 'UserAddress'`. The client used to send the
  // address OBJECT under that key, which failed with
  // `Cast to ObjectId failed for value "{ name: 'Shopper', ... }"` — a 400 that told the
  // caller nothing except that Mongoose exists.
  //
  // The two are separate on purpose: the id lets the customer manage the saved address
  // later; the snapshot means editing that address cannot rewrite where this order was
  // actually delivered to, which is what a refund dispute is about.
  const order = await orderService.createOrder({
    ...req.body,
    customer: req.user._id,
    address: req.body.addressId,
  });
  res.status(httpStatus.CREATED).send({ order });
};

const cancelOrder = async (req, res) => {
  const order = await orderService.cancelOrder(req.params.order, {
    reason: req.body.reason,
    cancelledBy: 'customer',
    cancelledByUserId: req.user._id,
  });
  res.status(httpStatus.OK).send({ order });
};

// Gateway payment for a store order (BR-17). Creates (or reuses) the
// PaymentInitiation row the shared gateway checkout (`makePayment`) charges
// against. The amount always comes from the order, never the client.
const payOrder = async (req, res) => {
  const initiation = await paymentService.initiateStoreOrderPayment({
    orderId: req.params.order,
    customerId: req.user._id,
    paymentConfigId: req.body.payment,
    paymentRef: req.body.paymentRef,
  });
  res.status(httpStatus.CREATED).send({ initiation });
};

const getCustomerOrders = async (req, res) => {
  const result = await orderService.listOrders({ customer: req.user._id });
  res.status(httpStatus.OK).send(result);
};

const getCustomerOrder = async (req, res) => {
  const order = await orderService.getOrder(req.params.order);
  if (order.customer._id.toString() !== req.user._id.toString()) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  }
  res.status(httpStatus.OK).send({ order });
};

const createReview = async (req, res) => {
  const review = await reviewService.createReview({
    ...req.body,
    customer: req.user._id,
  });
  res.status(httpStatus.CREATED).send({ review });
};

const createReturn = async (req, res) => {
  const request = await returnService.createReturnRequest({
    ...req.body,
    customer: req.user._id,
  });
  res.status(httpStatus.CREATED).send({ request });
};

const createExchange = async (req, res) => {
  const request = await returnService.createExchangeRequest({
    ...req.body,
    customer: req.user._id,
  });
  res.status(httpStatus.CREATED).send({ request });
};

/**
 * ## ROUTE ORDER IS LOAD-BEARING HERE — read before adding a route
 *
 * Express matches in REGISTRATION order, so a literal segment declared after a `:param`
 * sibling is unreachable. `/:store` on the next line matches ANY single segment, which
 * means `/cart`, `/orders`, `/checkout` and `/customer` are all captured by it and never
 * reach their own handlers.
 *
 * This already happened: `GET /v1/stores/cart` returned
 * `CastError: Cast to ObjectId failed for value "cart"` because `/:store` matched first and
 * tried to load an outlet with the id "cart". It is the exact trap the implementation plan
 * records as T8, and it is why this comment is here rather than a passing mention.
 *
 * THE RULE: every literal-only path is declared BEFORE `/:store`. Today that means
 * `/nearby`, `/products/search`, `/cart` and the `/customer/*` reads. A new literal path
 * goes above line "router.get('/:store')" or it will not be reachable.
 *
 * (Note the POST/PATCH routes below are unaffected — `/:store` is a GET, so a POST to
 * `/cart/add` falls through to its own handler. The collision is only ever between two
 * routes of the SAME method.)
 */

// -- literals FIRST ----------------------------------------------------------
router.get('/nearby', listNearbyStores);
router.get('/products/search', searchProducts);
router.get('/products/:product', getProductDetail);

router.get('/cart', validate(V.cartOutletValidation), appAuth('stores_cart_read'), getCart);
router.get('/customer/orders', appAuth('stores_orders_read'), getCustomerOrders);
router.get('/customer/orders/:order', appAuth('stores_orders_read'), getCustomerOrder);

/**
 * ## The `:store` storefront family NO LONGER LIVES HERE
 *
 * `/:store`, `/:store/products`, `/:store/reviews` and `/:store/offers` moved to
 * `stores.storefront.route.js`, mounted LAST in `stores.route.js`. They are the only
 * catch-alls in the stores surface, and while they sat in this file — which is mounted
 * FIRST — they captured every bare partner path declared in a later file:
 * `/subscription`, `/delivery`, `/settlement`, `/remittances`, `/warranty`,
 * `/catalog/products` and this file's own `GET /subscriptions`. Each was answered
 * `CastError: Cast to ObjectId failed for value "<segment>"`.
 *
 * Do not move them back for tidiness. The order of the two `router.use` lines in
 * `stores.route.js` is what keeps them from shadowing, and
 * `scripts/verify.stores.api.contract.js` fails the build if any route is captured by an
 * earlier one.

/**
 * ## ORDER: auth BEFORE validation
 *
 * These are registered `appAuth(...)` then `validate(...)`, matching the rest of the
 * platform (`stores.catalog.route.js` does the same). It is not cosmetic.
 *
 * With `validate` first, an ANONYMOUS caller gets `400 "chain" is required` instead of
 * `401` — the auth check never runs, so the error response discloses the exact request
 * schema to someone who has no token. Authentication is the cheaper and more
 * informative answer, and it is the one that does not hand out field names.
 */
router.post('/cart/add', appAuth('stores_cart_write'), validate(V.cartAddValidation), addToCart);
router.patch('/cart/update', appAuth('stores_cart_write'), validate(V.cartUpdateValidation), updateCart);
router.post('/cart/remove', appAuth('stores_cart_write'), validate(V.cartRemoveValidation), removeFromCart);
router.post('/cart/clear', appAuth('stores_cart_write'), clearCart);

router.post('/checkout/eligibility', appAuth('stores_checkout'), checkoutEligibility);
router.post('/checkout/summary', appAuth('stores_checkout'), checkoutSummary);

router.post('/orders', appAuth('stores_orders_write'), validate(V.orderCreateValidation), createOrder);
router.post('/orders/:order/cancel', appAuth('stores_orders_write'), validate(V.customerOrderIdValidation), cancelOrder);
router.post('/orders/:order/pay', appAuth('stores_orders_write'), validate(V.orderPayValidation), payOrder);
router.post('/customer/orders/:order/review', appAuth('stores_reviews_write'), validate(V.customerOrderIdValidation), createReview);
router.post('/customer/returns', appAuth('stores_returns_write'), createReturn);
router.post('/customer/exchanges', appAuth('stores_returns_write'), createExchange);

// Customer subscription routes (requires appAuth)
const customerSubscriptionController = require('../controllers/stores.customer.subscription.controller');

router.post(
  '/subscriptions',
  appAuth('stores_subscription_write'),
  validate(V.customerSubscriptionCreateValidation),
  customerSubscriptionController.createSubscription
);

router.get(
  '/subscriptions',
  appAuth('stores_subscription_read'),
  customerSubscriptionController.listCustomerSubscriptions
);

// LITERAL BEFORE PARAM, always. Declared after `/subscriptions/:subscription` it was
// unreachable: that route captured 'upcoming' as an id and `findById('upcoming')`
// cast-failed, so this endpoint could only ever 500.
router.get(
  '/subscriptions/upcoming',
  appAuth('stores_subscription_read'),
  customerSubscriptionController.getUpcoming
);

router.get(
  '/subscriptions/:subscription',
  appAuth('stores_subscription_read'),
  customerSubscriptionController.getSubscription
);

router.patch(
  '/subscriptions/:subscription/:status',
  appAuth('stores_subscription_write'),
  validate(V.customerSubscriptionTransitionValidation),
  customerSubscriptionController.transitionSubscription
);

router.post(
  '/subscriptions/:subscription/skip',
  appAuth('stores_subscription_write'),
  validate(V.customerSubscriptionSkipValidation),
  customerSubscriptionController.skipNext
);

router.post(
  '/subscriptions/:subscription/pause',
  appAuth('stores_subscription_write'),
  validate(V.customerSubscriptionPauseValidation),
  customerSubscriptionController.pauseSubscription
);

router.post(
  '/subscriptions/:subscription/resume',
  appAuth('stores_subscription_write'),
  customerSubscriptionController.resumeSubscription
);

router.post(
  '/subscriptions/:subscription/cancel',
  appAuth('stores_subscription_write'),
  validate(V.customerSubscriptionCancelValidation),
  customerSubscriptionController.cancelSubscription
);

module.exports = router;