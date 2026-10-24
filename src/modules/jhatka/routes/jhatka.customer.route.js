/**
 * LocalWala â€“ Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Â© 2026 WeWorkLocal Private Limited
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
 * jhatka.routes.orders.js â€” the CUSTOMER order surface. -15.2 "Customer".
 *
 * ## This file was rewritten against the real schema
 *
 * The first version of this file was written from the blueprint rather than from
 * `jhatka.order.model.js`, and it invented a parallel vocabulary. Every field it
 * touched was absent from the model:
 *
 *   it wrote                the model actually has
 *   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
*   order.status            order.lifecycle   (21-value UPPERCASE enum)
 *   estimateLocalPaise      estimatedTotal   (a LOCAL variable, see the weigh path)
 *   payment.mode            paymentMode       ('cod' | 'gateway')
 *   payment.codCeilingPaise codAmount
 *   deliveryId              delivery          (an ObjectId ref)
 *   delivery.contactPhone   address + deliveryAddressSnapshot
 *   items[].qty             items[].requestedQuantity { value, unit }
 *   items[].unit            items[].unitLabel ('kg', lowercase)
 *   statusHistory[]         JhatkaOrderStatusHistory (separate model)
 *
 * Mongoose does not raise on unknown paths â€” it strips them. So that version
 * saved cleanly, validated nothing, and every guard of the form
 * `order.status === 'placed'` compared against `undefined` and fell through.
 * `verify.jhatka.routeschema.units.js` is what makes that class of mistake fail
 * the build; read it before adding a field here.
 *
 * ## The two unit vocabularies, which are NOT the same thing
 *
 *   requestedQuantity.unit  UPPERCASE enum: GRAM KG PIECE DOZEN TIER PACK â€¦
 *   variant.unitLabel       lowercase enum: kg g pc dozen tier piece
 *
 * Mixing them up fails validation on a nested subdocument, which produces an
 * error that points at the wrong place. The first draft of the guard suite made
 * exactly that mistake.
 *
 * ## Money
 *
 * All amounts are PAISE integers, as required by -0. Money conversion happens at
 * the model edge via `moneyField`. No route does arithmetic on rupees.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const appAuth = require('../../../middlewares/appAuth');
const {
  JhatkaOrder,
  JhatkaOutlet,
  JhatkaVariant,
  JhatkaProduct,
  JhatkaPriceOverride,
  JhatkaAddress,
  JhatkaCompliance,
  JhatkaRefund,
  JhatkaCart,
  JhatkaComplaint,
  JhatkaReview,
  JhatkaSubscription,
  JhatkaSubscriptionEvent,
  JhatkaRecurringOrder,
  PaymentInitiation,
  PaymentConfig,
} = require('../../../models');
const cartService = require('../services/jhatka.cart.service');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.customer.validation');
const browseService = require('../services/jhatka.browse.service');
const otpService = require('../services/jhatka.otp.service');
const subscriptionService = require('../services/jhatka.subscription.service');
const { codCollectablePaise } = require('../utils/weight.arithmetic');
const { fromGrams } = require('../utils/quantity');
const paymentService = require('../services/jhatka.payment.service');
const orderCreationService = require('../services/jhatka.order-creation.service');
const subscriptionLifecycle = require('../services/jhatka.subscription-lifecycle.service');
const refundSettlement = require('../services/jhatka.refund.settlement');

/**
 * `dayKey` and `nextOccurrence` come from the PARTNER subscriptions router.
 *
 * That is a real coupling and it is deliberate, because §9.2's whole argument is that
 * recurrence has exactly ONE implementation. A customer-created subscription and an
 * outlet-generated occurrence must agree on what "tomorrow" means, and two copies of a
 * date function is how a subscription ends up generating its first occurrence on a
 * different day from the one the customer asked for.
 *
 * It is also the clearest example of why the follow-up extraction matters: a customer
 * router reaching into a partner router for date arithmetic is a dependency that will
 * not survive the next vertical. The long-term home is a `jhatka.recurrence` service
 * both routers require — but that is a refactor, not a drive-by change.
 */
const subscriptionsRoute = require('./jhatka.partner.subscriptions.route');

// `orderPricing`, `deriveComplianceStatus` and `asMoney` were used by the inline order
// creator and are now reached through `jhatka.order-creation.service`. They are
// deliberately NOT re-imported here: the money helpers must have exactly one owner,
// and a route that can call `asMoney` is a route that can write paise into a
// `moneyField` and inflate an order 100x.
const router = express.Router();

/**
* A sequential-ish order number. NOT security-relevant and NOT collision-proof
 * without a unique index, but `orderNo` is REQUIRED on the model and nothing
 * generates it — so it has to happen here.
 *
 * Re-exported from the creation service rather than reimplemented. Two generators for
 * one required field is how a customer ends up with two different order-number formats
 * depending on which route created the order, and the partner app then fails to parse
 * one of them.
 */
const buildOrderNo = orderCreationService.buildOrderNo;

/**
 * Load (or create) the ACTIVE cart for this customer and outlet.
 *
 * One cart per (customer, outlet), enforced by a unique index. Creating on demand is
 * what makes `GET /cart` safe to call before anything has been added â€” the customer
 * app opens on the cart screen and expects a 200 with an empty basket, not a 404.
 */
const loadOrCreateCart = async (customerId, outletId) => {
  const existing = await JhatkaCart.findOne({ customer: customerId, outlet: outletId });
  if (existing) return existing;

  return JhatkaCart.create({ customer: customerId, outlet: outletId });
};

/** The shape the customer app renders. Money in RUPEES â€” the API always speaks rupees. */
const cartResponse = (cart, extra = {}) => ({
  id: String(cart._id),
  outlet: String(cart.outlet),
  items: (cart.items || []).map((i) => ({
    id: String(i._id),
    product: String(i.product),
    variant: String(i.variant),
    sku: i.sku,
    name: i.name,
    image: i.image,
    quantity: i.quantity,
    measurementMode: i.measurementMode,
    unitPrice: i.unitPrice,
    lineTotal: i.lineTotal,
    taxRatePct: i.taxRatePct,
    taxAmount: i.taxAmount,
    unavailable: !!i.unavailable,
    priceChanged: !!i.priceChanged,
    unitPriceAtAdd: i.unitPriceAtAdd,
  })),
  subtotal: cart.subtotal,
  taxTotal: cart.taxTotal,
  estimatedTotal: cart.estimatedTotal,
  deliveryFee: cart.deliveryFee,
  packagingFee: cart.packagingFee,
  fulfilmentMode: cart.fulfilmentMode,
  address: cart.address ? String(cart.address) : null,
  instructions: cart.instructions,
  itemCount: (cart.items || []).length,
  unavailableCount: cart._unavailableCount || 0,
  expiresAt: cart.expiresAt,
  ...extra,
});

/**
 * Find the cart that owns an item.
 *
 * Scoped by `customer` AND the item id, so one customer cannot mutate another's cart
 * by guessing an item id â€” the ownership check is in the query, not after it.
 */
const findCartWithItem = async (customerId, itemId) => {
  const cart = await JhatkaCart.findOne({ customer: customerId, 'items._id': itemId });
  if (!cart) throw new ApiError(httpStatus.NOT_FOUND, 'That item is not in your cart');
  return cart;
};

/** Subscription ids share the JH order-number shape with a distinct prefix. */
const buildSubscriptionNo = (prefix = 'SB') => {
  const now = new Date();
  const stamp =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  return `${prefix}${stamp}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
};

/**
 * Load an order belonging to THIS customer, or 404.
 *
 * Scoped by customer in the QUERY, not checked afterwards, so an order id from another
 * account is indistinguishable from one that does not exist. A 403 here would confirm
 * the id is real, which is an enumeration oracle.
 */
const loadOwnCustomerOrder = async (orderId, customerId) => {
  const order = await JhatkaOrder.findOne({ _id: orderId, customer: customerId });
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  return order;
};

/**
 * GET /v1/jhatka/customer/home
 *
 * Nearby outlets and a category strip. Requires `?lat&lng` â€” a home screen that
 * guesses a location is a home screen that shows the wrong city.
 */
router.get('/home', appAuth('jhatka_customer_order_list'), async (req, res, next) => {
  try {
    const result = await browseService.home({ query: req.query, models: { JhatkaOutlet, JhatkaProduct } });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/customer/home
 *
 * Same as GET /home but via POST. Required by the customer app.
 */
router.post('/home', appAuth('jhatka_customer_order_list'), async (req, res, next) => {
  try {
    const result = await browseService.home({ query: req.query, models: { JhatkaOutlet, JhatkaProduct } });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/customer/availability
 *
 * -16: ADDRESS-SCOPED. Same `?lat&lng` as `/home` â€” resolving from a stored address
 * the customer may have moved away from answers for the wrong house.
 */
router.get('/availability', appAuth('jhatka_customer_order_list'), async (req, res, next) => {
  try {
    const result = await browseService.availability({
      query: req.query,
      models: { JhatkaOutlet, JhatkaProduct, JhatkaVariant },
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/customer/availability
 *
 * Same as GET /availability but via POST. Required by the customer app.
 */
router.post('/availability', appAuth('jhatka_customer_order_list'), async (req, res, next) => {
  try {
    const result = await browseService.availability({
      query: req.query,
      models: { JhatkaOutlet, JhatkaProduct, JhatkaVariant },
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/customer/outlets/:outlet â€” one shop's public card. */
router.get('/outlets/:outlet', appAuth('jhatka_customer_order_list'), validate(V.outletParam), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findOne({
      _id: req.params.outlet,
      status: 'active',
    })
      .select('name outletCode address locality location serviceArea businessModel minDeliveryMinutes')
      .lean();

    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

    return res.json({
      id: String(outlet._id),
      name: outlet.name,
      outletCode: outlet.outletCode,
      address: outlet.address,
      locality: outlet.locality,
      serviceRadiusKm: outlet.serviceArea?.radiusKm ?? 5,
      minDeliveryMinutes: outlet.minDeliveryMinutes ?? outlet.orderConfig?.minDeliveryMinutes,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/customer/outlets/:outlet/products â€” what this shop sells.
 *
 * Active catalogue plus this outlet's estimate and any in-force price
 * override. Prices AND availability are estimates (lean paise reads):
 * the order confirms both, and a wrong estimate produces a REFUND, not a
 * no-order (BR-21).
 */
router.get('/outlets/:outlet/products', appAuth('jhatka_customer_order_list'), validate(V.outletParam), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findOne({
      _id: req.params.outlet,
      status: 'active',
    }).select('_id').lean();
    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

    const result = await browseService.outletProducts({
      outletId: String(outlet._id),
      models: { JhatkaProduct, JhatkaVariant, JhatkaPriceOverride },
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/customer/products/:product â€” one product's variants and prices. */
router.get('/products/:product', appAuth('jhatka_customer_order_list'), validate(V.productParam), async (req, res, next) => {
  try {
    const product = await JhatkaProduct.findOne({ _id: req.params.product, isActive: { $ne: false } })
      .select('name description image category hsnCode')
      .lean();

    if (!product) throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');

    const variants = await JhatkaVariant.find({
      product: product._id,
      status: { $ne: 'archived' },
      isActive: { $ne: false },
    })
      .select('sku name measurementMode pricePerUnit priceBasis packSize isActive estimatedAvailability availabilityUnit status subscriptionEligible')
      .lean();

    return res.json({
      id: String(product._id),
      name: product.name,
      description: product.description,
      image: product.image,
      category: String(product.category),
      variants: variants.map((v) => ({
        id: String(v._id),
        sku: v.sku,
        name: v.name,
        measurementMode: v.measurementMode,
        pricePerUnit: v.pricePerUnit,
        priceBasis: v.priceBasis,
        packSize: v.packSize,
        // Labelled an estimate on the way out, not just in a service comment.
        estimatedAvailability: v.estimatedAvailability ?? 0,
        availabilityUnit: v.availabilityUnit || (v.measurementMode === 'WEIGHT' ? 'KG' : 'PIECE'),
        inStock: (v.estimatedAvailability ?? 0) > 0,
        // The app filters the subscribe picker on this. Eggs and whole fish are
        // not subscribable (nobody subscribes to eggs; fish cannot sit overnight),
        // and offering them before the server refuses is a button that lies.
        subscriptionEligible: v.subscriptionEligible !== false,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/customer/orders/:order/otp
 *
 * Issues a delivery code the rider must be given at the door.
 *
 * Returns the plaintext ONCE. There is no read endpoint that returns it, by design:
 * a code that can be fetched at any time is not a code, it is a flag on the parcel.
 *
 * Regenerating RESETS the attempt counter â€” otherwise five wrong guesses would
 * permanently lock the customer out of their own parcel.
 */
router.post('/orders/:order/otp', appAuth('jhatka_customer_order_create'), validate(V.orderParam), async (req, res, next) => {
  try {
    const order = await loadOwnCustomerOrder(req.params.order, req.user._id);

    // Only meaningful while the parcel is still moving. Issuing a code for a parcel
    // that has already been handed over is a code for nothing.
    if (['DELIVERED', 'CANCELLED', 'RETURNED'].includes(order.lifecycle)) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `A delivery code cannot be issued for an order that is ${order.lifecycle}`,
        true,
        '',
        { lifecycle: order.lifecycle }
      );
    }

    const issued = otpService.generateOtp();
    order.deliveryOtp = {
      codeHash: issued.codeHash,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
      attempts: 0,
      maxAttempts: 5,
    };
    await order.save();

    return res.status(201).json({
      order: { id: String(order._id), orderNo: order.orderNo },
      // The ONLY time this is ever returned.
      code: issued.code,
      expiresAt: issued.expiresAt,
      maxAttempts: 5,
      note: 'Shown once. Share it with the rider at handover.',
    });
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/customer/orders/:order/otp â€” status WITHOUT the code. */
router.get('/orders/:order/otp', appAuth('jhatka_customer_order_list'), validate(V.orderParam), async (req, res, next) => {
  try {
    const order = await loadOwnCustomerOrder(req.params.order, req.user._id);
    return res.json({
      order: { id: String(order._id), orderNo: order.orderNo },
      ...otpService.publicOtpView(order),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/customer/complaints
 *
 * Body: `{ order, category, subject, description, orderItem?, attachments? }`
 *
 * `category` and `source` are LOWERCASE in the model enum. Passing `MISSING_ITEM`
 * fails validation â€” the same trap that broke refunds, so it is asserted in the test
 * suite rather than discovered in production.
 *
 * `source: 'customer'` is fixed here. The model also allows `'system'`, which is for
 * a violation the platform detected itself; a client may not file a complaint that
 * claims to be an automated detection.
 */
router.post('/complaints', appAuth('jhatka_customer_complaint_create'), validate(V.complaintBody), async (req, res, next) => {
  try {
    const { order: orderId, category, subject, description, orderItem, attachments } = req.body || {};

    if (!orderId) throw new ApiError(httpStatus.BAD_REQUEST, 'order is required');
    if (!category) throw new ApiError(httpStatus.BAD_REQUEST, 'category is required');
    if (!subject) throw new ApiError(httpStatus.BAD_REQUEST, 'subject is required');

    const order = await loadOwnCustomerOrder(orderId, req.user._id);

    const now = new Date();
    const stamp = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

    const complaint = await JhatkaComplaint.create({
      complaintNo: `CP${stamp}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`,
      order: order._id,
      orderItem: orderItem || undefined,
      outlet: order.outlet,
      customer: req.user._id,
      // lowercase enum â€” see the note above
      category,
      source: 'customer',
      triggeredBy: req.user._id,
      subject,
      description,
      attachments: Array.isArray(attachments) ? attachments : undefined,
      status: 'open',
      // -9.4: the shop has a clock, not an open-ended queue.
      windowHours: order.outlet?.orderConfig?.complaintWindowHours ?? 48,
      timeline: [
        {
          at: new Date(),
          by: req.user._id,
          byName: req.user.name,
          event: 'complaint_raised',
          note: subject,
        },
      ],
    });

    return res.status(201).json({
      complaint: {
        id: String(complaint._id),
        complaintNo: complaint.complaintNo,
        category: complaint.category,
        status: complaint.status,
        subject: complaint.subject,
        createdAt: complaint.createdAt,
        responseWindowHours: complaint.windowHours,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/customer/reviews
 *
 * Body: `{ order, outletRating, productRating?, deliveryRating?, comment?, itemRatings? }`
 *
 * One review per order. The model carries `order` and the vertical is built on trust
 * signals, so a second review from the same customer is an attempt to move a rating
 * rather than an expression of one.
 */
router.post('/reviews', appAuth('jhatka_customer_review_create'), validate(V.reviewBody), async (req, res, next) => {
  try {
    const {
      order: orderId,
      outletRating,
      productRating,
      deliveryRating,
      comment,
      itemRatings,
    } = req.body || {};

    if (!orderId) throw new ApiError(httpStatus.BAD_REQUEST, 'order is required');

    const rating = Number(outletRating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'outletRating must be 1..5');
    }

    const order = await loadOwnCustomerOrder(orderId, req.user._id);

    // A review on an order nobody received is not a review of the shop.
    if (order.lifecycle !== 'DELIVERED') {
      throw new ApiError(
        httpStatus.CONFLICT,
        `An order can only be reviewed once delivered (this one is ${order.lifecycle})`,
        true,
        '',
        { lifecycle: order.lifecycle }
      );
    }

    const existing = await JhatkaReview.findOne({ order: order._id, customer: req.user._id });
    if (existing) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'You have already reviewed this order',
        true,
        '',
        { code: 'ALREADY_REVIEWED', reviewId: String(existing._id) }
      );
    }

    const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt) : new Date(order.createdAt);

    const review = await JhatkaReview.create({
      order: order._id,
      outlet: order.outlet,
      customer: req.user._id,
      outletRating: rating,
      productRating: productRating == null ? undefined : Number(productRating),
      deliveryRating: deliveryRating == null ? undefined : Number(deliveryRating),
      comment: comment || undefined,
      itemRatings: Array.isArray(itemRatings) ? itemRatings : undefined,
      // Surfaced to the customer app so a review left in a hurry can be resumed.
      elapsedMinutes: Math.max(0, Math.round((Date.now() - deliveredAt.getTime()) / 60000)),
      status: 'published',
      helpfulCount: 0,
    });

    return res.status(201).json({
      review: {
        id: String(review._id),
        outletRating: review.outletRating,
        productRating: review.productRating,
        deliveryRating: review.deliveryRating,
        status: review.status,
        createdAt: review.createdAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/customer/subscriptions
 *
 * The customer's own standing orders. Scoped by customer in the QUERY, so this is not
 * a way to enumerate other people's subscriptions by guessing an outlet.
 */
router.get('/subscriptions', appAuth('jhatka_customer_subscription_list'), async (req, res, next) => {
  try {
    const query = { customer: req.user._id };
    if (req.query.status) query.status = req.query.status;
    if (req.query.outlet) query.outlet = req.query.outlet;

    const subs = await JhatkaSubscription.find(query)
      .select('subscriptionNo outlet status scheduleType nextOccurrenceDate items estimatedAmountPerOccurrence totals stats startDate endDate')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      subscriptions: subs.map((s) => ({
        id: String(s._id),
        subscriptionNo: s.subscriptionNo,
        outlet: String(s.outlet),
        status: s.status,
        scheduleType: s.scheduleType,
        nextOccurrenceDate: s.nextOccurrenceDate,
        estimatedAmountPerOccurrence: s.estimatedAmountPerOccurrence,
        items: s.items,
        totals: s.totals,
        stats: s.stats,
        startDate: s.startDate,
        endDate: s.endDate,
      })),
      count: subs.length,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/customer/subscriptions
 *
 * The customer sets up their own standing order. `customer` is forced from the TOKEN â€”
 * a body that names somebody else is ignored rather than honoured, because subscribing
 * a stranger to weekly meat is not something a request body should be able to do.
 */
router.post('/subscriptions', appAuth('jhatka_customer_subscription_create'), validate(V.subscriptionCreateBody), async (req, res, next) => {
  try {
    const outletId = req.body?.outlet;
    if (!outletId) throw new ApiError(httpStatus.BAD_REQUEST, 'outlet is required');

    const outlet = await JhatkaOutlet.findOne({ _id: outletId, status: 'active' }).lean();
    if (!outlet) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        'Outlet not found',
        true,
        '',
        { code: 'OUTLET_UNAVAILABLE' }
      );
    }

    const sub = await subscriptionService.createSubscription({
      body: req.body,
      customer: req.user._id, // from the token, never the body
      outlet,
      models: { JhatkaVariant, JhatkaProduct, JhatkaSubscription },
      nextNumber: buildSubscriptionNo,
      dayKey: subscriptionsRoute.dayKey,
      actor: { _id: req.user._id, name: req.user.name, type: 'customer' },
    });

    return res.status(201).json({
      subscription: {
        id: String(sub._id),
        subscriptionNo: sub.subscriptionNo,
        status: sub.status,
        scheduleType: sub.scheduleType,
        nextOccurrenceDate: sub.nextOccurrenceDate,
        estimatedAmountPerOccurrence: sub.estimatedAmountPerOccurrence,
        items: sub.items,
        pricingBasis:
          'ceiling â€” a variable-weight line is charged at estimate plus the ceiling percentage, once',
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /v1/jhatka/customer/subscriptions/:subscription
 *
 * Only pause / resume / skip / quantity / schedule (-15.2). A customer may not edit the
 * price ceiling or the outlet: those are what the shop agreed to charge, and letting
 * the customer set them would make OD-07 meaningless.
 */
router.patch('/subscriptions/:subscription', appAuth('jhatka_customer_subscription_manage'), validate(V.subscriptionParam), validate(V.subscriptionUpdateBody), async (req, res, next) => {
  try {
    const sub = await loadOwnCustomerSubscription(req.params.subscription, req.user._id);
    const action = req.body?.action;

    const ALLOWED = ['pause', 'resume', 'skip', 'quantity', 'schedule'];
    if (!ALLOWED.includes(action)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `action must be one of ${ALLOWED.join(' | ')}`
      );
    }

    // Pause, resume and skip go through the SAME lifecycle service the partner
    // surface uses — previously each surface owned its own copy, and the copies
    // had diverged: customer resume did not reset the failure streak (so a
    // pause/resume cycle auto-paused again within a day), customer skip wrote no
    // occurrence record (so the week vanished from history), and neither wrote an
    // event. Quantity and schedule stay inline: they have no partner equivalent.
    if (action === 'pause') {
      const paused = await subscriptionLifecycle.pauseSubscription({
        sub,
        body: { reason: req.body?.reason || 'Paused by customer' },
        actor: { _id: req.user._id, name: req.user.name },
        actorType: 'customer',
        recordEvent: recordCustomerEvent,
      });
      return res.json({
        subscription: {
          id: String(sub._id),
          subscriptionNo: sub.subscriptionNo,
          status: paused.subscription.status,
          scheduleType: sub.scheduleType,
          nextOccurrenceDate: sub.nextOccurrenceDate,
          estimatedAmountPerOccurrence: sub.estimatedAmountPerOccurrence,
          items: sub.items,
          stats: sub.stats,
        },
      });
    }

    if (action === 'resume') {
      // Resets the failure streak and re-derives the schedule from today — the
      // two resets the old inline version forgot, which re-tripped auto-pause
      // within a day of resuming.
      const resumed = await subscriptionLifecycle.resumeSubscription({
        sub,
        actor: { _id: req.user._id, name: req.user.name },
        actorType: 'customer',
        recordEvent: recordCustomerEvent,
        nextOccurrenceFn: subscriptionsRoute.nextOccurrence,
      });
      return res.json({
        subscription: {
          id: String(sub._id),
          subscriptionNo: sub.subscriptionNo,
          status: resumed.subscription.status,
          scheduleType: sub.scheduleType,
          nextOccurrenceDate: sub.nextOccurrenceDate,
          estimatedAmountPerOccurrence: sub.estimatedAmountPerOccurrence,
          items: sub.items,
          stats: sub.stats,
        },
      });
    }

    if (action === 'skip') {
      // Creates the skipped-occurrence record and the event — the old version just
      // bumped the date, so the skipped week vanished from history and the stats
      // disagreed with the records. No customer notification: they initiated it.
      // No outlet notification either: the advanced schedule is what stops the cut,
      // and the event is what the outlet reads when they look.
      const skipped = await subscriptionLifecycle.skipNextOccurrence({
        models: { JhatkaRecurringOrder },
        sub,
        body: { occurrenceDate: sub.nextOccurrenceDate, reason: req.body?.reason || 'Skipped by customer' },
        actor: { _id: req.user._id, name: req.user.name },
        actorType: 'customer',
        recordEvent: recordCustomerEvent,
        dayKeyFn: subscriptionsRoute.dayKey,
        nextOccurrenceFn: subscriptionsRoute.nextOccurrence,
        notifyStockFailure: async () => ({ stampedAt: null }),
      });
      return res.json({
        subscription: {
          id: String(sub._id),
          subscriptionNo: sub.subscriptionNo,
          status: sub.status,
          scheduleType: sub.scheduleType,
          nextOccurrenceDate: skipped.subscription.nextOccurrenceDate,
          estimatedAmountPerOccurrence: sub.estimatedAmountPerOccurrence,
          items: sub.items,
          stats: sub.stats,
        },
      });
    }

    if (action === 'quantity') {
      const itemId = req.body.item;
      const qty = req.body.quantity;
      const line = sub.items.id(itemId);
      if (!line) throw new ApiError(httpStatus.NOT_FOUND, 'That item is not on this subscription');
      if (!qty || typeof qty.value !== 'number' || qty.value <= 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'quantity.value must be > 0');
      }
      line.requestedQuantity = { value: qty.value, unit: qty.unit || line.requestedQuantity.unit };
      // Re-price, because the ceiling scales with quantity. Computed by the service so
      // this route cannot drift from creation.
      await subscriptionService.repriceSubscription(sub);
    }

    if (action === 'schedule') {
      const scheduleType = req.body.scheduleType;
      if (!subscriptionService.SCHEDULE_TYPES.includes(scheduleType)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `scheduleType must be one of ${subscriptionService.SCHEDULE_TYPES.join(' | ')}`
        );
      }
      if (scheduleType === 'custom_days' && (!Array.isArray(req.body.customDays) || !req.body.customDays.length)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'custom_days requires customDays');
      }
      sub.scheduleType = scheduleType;
      if (req.body.customDays) sub.customDays = req.body.customDays;
      if (req.body.intervalCount) sub.intervalCount = Number(req.body.intervalCount);
      sub.nextOccurrenceDate = subscriptionsRoute.dayKey(sub.startDate);
    }

    await sub.save();

    return res.json({
      subscription: {
        id: String(sub._id),
        subscriptionNo: sub.subscriptionNo,
        status: sub.status,
        scheduleType: sub.scheduleType,
        nextOccurrenceDate: sub.nextOccurrenceDate,
        estimatedAmountPerOccurrence: sub.estimatedAmountPerOccurrence,
        items: sub.items,
        stats: sub.stats,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/customer/subscriptions/:subscription
 *
 * Detail with upcoming occurrences and their billing state. Exists because
 * pay-occurrence is unreachable without it: a customer cannot pay for a delivery
 * they cannot see. Occurrences are the ones from today onward — history lives on
 * the orders list, not here.
 *
 * Billing state is included per occurrence (pending/billed/paid/skipped) so the
 * app can show a pay button only where one is owed, rather than offering payment
 * for a delivery that was already charged or credited.
 */
router.get('/subscriptions/:subscription', appAuth('jhatka_customer_subscription_list'), validate(V.subscriptionParam), async (req, res, next) => {
  try {
    const sub = await loadOwnCustomerSubscription(req.params.subscription, req.user._id);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const occurrences = await JhatkaRecurringOrder.find({
      subscription: sub._id,
      occurrenceDate: { $gte: today },
    })
      .select('occurrenceDate generationStatus chargeAmount estimatedAmount paymentStatus billingStatus skipReason order')
      .sort({ occurrenceDate: 1 })
      .limit(10)
      .lean();

    return res.json({
      subscription: {
        id: String(sub._id),
        subscriptionNo: sub.subscriptionNo,
        status: sub.status,
        statusReason: sub.statusReason,
        scheduleType: sub.scheduleType,
        nextOccurrenceDate: sub.nextOccurrenceDate,
        estimatedAmountPerOccurrence: sub.estimatedAmountPerOccurrence,
        items: sub.items,
        totals: sub.totals,
        stats: sub.stats,
        startDate: sub.startDate,
        endDate: sub.endDate,
      },
      occurrences: occurrences.map((o) => ({
        id: String(o._id),
        occurrenceDate: o.occurrenceDate,
        generationStatus: o.generationStatus,
        // Hydrated RUPEES would be wrong here — lean gives paise, and the app
        // formats through its paise helper. Both sides of this boundary agree.
        chargeAmountPaise: o.chargeAmount,
        estimatedAmountPaise: o.estimatedAmount,
        paymentStatus: o.paymentStatus,
        billingStatus: o.billingStatus,
        skipReason: o.skipReason,
        order: o.order ? String(o.order) : null,
        // The app shows a pay button exactly when this is true. One predicate,
        // server-defined, so client and server cannot disagree about what is owed.
        payDue: o.paymentStatus !== 'paid'
          && o.billingStatus !== 'unpaid_skipped'
          && o.billingStatus !== 'not_required'
          && Number(o.chargeAmount) > 0,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * DELETE /v1/jhatka/customer/subscriptions/:subscription
 *
 * Cancels, never deletes. A subscription that has collected money has an audit trail
 * that must outlive it; §"no hard deletes" applies here exactly as it does to orders.
 * Already-cancelled is idempotent-success, not a 409, because the customer's intent
 * ("stop this") has already been satisfied either way.
 */
router.delete('/subscriptions/:subscription', appAuth('jhatka_customer_subscription_manage'), validate(V.subscriptionParam), async (req, res, next) => {
  try {
    const sub = await loadOwnCustomerSubscription(req.params.subscription, req.user._id);

    if (sub.status === 'cancelled') {
      return res.json({
        subscription: { id: String(sub._id), status: 'cancelled' },
        alreadyCancelled: true,
      });
    }
    if (['completed', 'failed'].includes(sub.status)) {
      throw new ApiError(httpStatus.CONFLICT, `Subscription is ${sub.status} and cannot be cancelled`);
    }

    // Same lifecycle service the partner surface uses. The old inline version set
    // status + cancelledAt and stopped — leaving planned/reserved occurrences to
    // generate and charge against a dead subscription, with no event explaining why
    // it ended. (The already-cancelled early return above is kept: idempotent-success
    // is the customer's intent satisfied either way, and the service would 409.)
    const cancelled = await subscriptionLifecycle.cancelSubscription({
      models: { JhatkaRecurringOrder },
      sub,
      body: { reason: req.body?.reason || 'Cancelled by customer' },
      actor: { _id: req.user._id, name: req.user.name },
      actorType: 'customer',
      recordEvent: recordCustomerEvent,
    });
    // The service does not set cancelledBy (partner cancellations attribute via the
    // event); the customer surface records who tapped.
    sub.cancelledBy = req.user._id;
    await sub.save();

    return res.json({
      subscription: {
        id: String(sub._id),
        subscriptionNo: sub.subscriptionNo,
        status: cancelled.subscription.status,
        cancelledAt: cancelled.subscription.cancelledAt,
      },
      occurrencesCancelled: cancelled.occurrencesCancelled,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * Load a subscription belonging to THIS customer, or 404.
 *
 * Same reasoning as `loadOwnCustomerOrder`: a 403 would confirm the id exists.
 */
/**
 * Write a subscription event as the CUSTOMER.
 *
 * The lifecycle service takes `recordEvent` as a parameter so partner and customer
 * surfaces share the state machine while attributing correctly: partner actions
 * record `admin`, customer actions record `customer`. An event that says `admin`
 * for something the customer tapped is a lie the support desk will act on.
 */
const recordCustomerEvent = async (sub, fields) => {
  return JhatkaSubscriptionEvent.create({
    subscription: sub._id,
    customer: sub.customer,
    outlet: sub.outlet,
    actorType: 'customer',
    at: new Date(),
    ...fields,
  });
};

const loadOwnCustomerSubscription = async (subscriptionId, customerId) => {
  const sub = await JhatkaSubscription.findOne({ _id: subscriptionId, customer: customerId });
  if (!sub) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
  return sub;
};

/**
 * GET /v1/jhatka/customer/cart
 *
 * Requires `?outlet=` â€” a cart is per-outlet, and guessing the outlet from the last
 * order would silently show the wrong shop's prices.
 */
router.get('/cart', appAuth('jhatka_customer_order_create'), async (req, res, next) => {
  try {
    const outletId = req.query.outlet;
    if (!outletId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'outlet is required (a cart is per-outlet)');
    }

    const cart = await loadOrCreateCart(req.user._id, outletId);
    await cartService.repriceCart(cart, { JhatkaVariant, JhatkaProduct });
    await cart.save();

    return res.json(cartResponse(cart));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/customer/cart/items
 *
 * Body: `{ outlet, variant, quantity: { value, unit } }`
 *
 * No price is accepted from the client. See `jhatka.cart.service.js`.
 */
router.post('/cart/items', appAuth('jhatka_customer_order_create'), validate(V.cartAddBody), async (req, res, next) => {
  try {
    const { outlet: outletId, variant, quantity } = req.body || {};

    if (!outletId) throw new ApiError(httpStatus.BAD_REQUEST, 'outlet is required');
    if (!variant) throw new ApiError(httpStatus.BAD_REQUEST, 'variant is required');
    if (typeof quantity?.value !== 'number' || quantity.value <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'quantity.value must be > 0');
    }
    if (!quantity?.unit) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'quantity.unit is required');
    }

    const cart = await loadOrCreateCart(req.user._id, outletId);
    await cartService.addToCart(cart, { variant, quantity }, { JhatkaVariant, JhatkaProduct });
    await cart.save();

    return res.status(201).json(cartResponse(cart));
  } catch (error) {
    return next(error);
  }
});

/** PATCH /v1/jhatka/customer/cart/items/:item â€” change quantity. */
router.patch('/cart/items/:item', appAuth('jhatka_customer_order_create'), validate(V.cartItemParam), validate(V.cartUpdateBody), async (req, res, next) => {
  try {
    const cart = await findCartWithItem(req.user._id, req.params.item);
    await cartService.updateCartItem(cart, req.params.item, req.body || {}, {
      JhatkaVariant,
      JhatkaProduct,
    });
    await cart.save();

    return res.json(cartResponse(cart));
  } catch (error) {
    return next(error);
  }
});

/** DELETE /v1/jhatka/customer/cart/items/:item */
router.delete('/cart/items/:item', appAuth('jhatka_customer_order_create'), validate(V.cartItemParam), async (req, res, next) => {
  try {
    const cart = await findCartWithItem(req.user._id, req.params.item);
    await cartService.removeCartItem(cart, req.params.item, { JhatkaVariant, JhatkaProduct });
    await cart.save();

    return res.json(cartResponse(cart));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/customer/checkout/quote
 *
 * Body: `{ outlet }`
 *
 * Prices the basket and reports whether it can be placed. Freezes NOTHING â€” no stock
 * reserved, no order created. Freezing is what `POST /orders` does, and a quote that
 * reserved stock would turn a browsing action into a commitment.
 */
router.post('/checkout/quote', appAuth('jhatka_customer_order_create'), validate(V.checkoutQuoteBody), async (req, res, next) => {
  try {
    const outletId = req.body?.outlet;
    if (!outletId) throw new ApiError(httpStatus.BAD_REQUEST, 'outlet is required');

    const cart = await JhatkaCart.findOne({ customer: req.user._id, outlet: outletId });
    if (!cart) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No cart for this outlet');
    }

    const quote = await cartService.quoteCart(cart, { JhatkaVariant, JhatkaProduct });
    await cart.save();

    return res.json(quote);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/customer/orders â€” place an order.
 *
 * Body:
 *   {
 *     outlet: <outletId>,
 *     items: [{ variant, quantity: { value, unit } }],
 *     address: <UserAddressId>,
 *     instructions: { customerNote },
 *     fulfilmentMode: 'delivery' | 'pickup',
 *     paymentMode: 'cod' | 'gateway',
 *     promisedDeliveryAt: <ISO>,
 *     idempotencyKey: <string>
 *   }
 *
 * The customer id comes from the TOKEN, never the body.
 */
/**
 * -15.2 customer surface.
 *
 * MOUNTED at `/jhatka/customer`, so every path here is RELATIVE to the actor. The
 * order routes are namespaced under `/orders` because the actor also owns cart,
 * subscriptions, complaints and reviews (-15.2), and a bare `GET /` here would
 * shadow all of them the moment they were added â€” `/outlets/:outlet` would be
 * swallowed by `/:id`. Order first would not help either, so the collection is
 * named rather than assumed.
 *
 * Full paths: POST/GET `/v1/jhatka/customer/orders`, and `/orders/:order/...`.
 */
router.post('/orders', appAuth('jhatka_customer_order_create'), validate(V.orderCreateBody), async (req, res, next) => {
  try {
    // All of the rules live in the service. See jhatka.order-creation.service.js for
    // why the compliance gate and the frozen estimatedTotal cannot live in a handler,
    // and for why the line pricing is deliberately NOT re-implemented here.
    const { order } = await orderCreationService.placeOrder({
      models: {
        JhatkaOutlet,
        JhatkaCompliance,
        JhatkaVariant,
        JhatkaProduct,
        JhatkaPriceOverride,
        JhatkaAddress,
        JhatkaOrder,
      },
      // From the TOKEN, never from the body. 0.0.
      customerId: req.user._id,
      body: req.body,
    });

    return res.status(httpStatus.CREATED).json({
      order: orderCreationService.toCustomerView(order),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/customer/orders — the customer's order history.
 */
router.get('/orders', appAuth('jhatka_customer_order_list'), async (req, res, next) => {
  try {
    const { lifecycle, page = 1, limit = 20 } = req.query;

    const filter = { customer: req.user._id };
    if (lifecycle) {
      if (!JhatkaOrder.schema.path('lifecycle').enumValues.includes(lifecycle)) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Unknown lifecycle '${lifecycle}'`);
      }
      filter.lifecycle = lifecycle;
    }

    const [orders, total] = await Promise.all([
      JhatkaOrder.find(filter)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Math.min(Number(limit), 100))
        .lean(),
      JhatkaOrder.countDocuments(filter),
    ]);

    return res.json({
      orders: orders.map((o) => ({
        id: String(o._id),
        orderNo: o.orderNo,
        outlet: String(o.outlet),
        lifecycle: o.lifecycle,
        fulfilmentMode: o.fulfilmentMode,
        paymentMode: o.paymentMode,
        paymentStatus: o.paymentStatus,
        estimatedTotal: o.estimatedTotal,
        finalTotal: o.finalTotal,
        codAmount: o.codAmount,
        refundedAmount: o.refundedAmount,
        totalItems: o.totalItems,
        promisedWeightGrams: o.promisedWeightGrams,
        placedAt: o.placedAt,
        deliveredAt: o.deliveredAt,
        completedAt: o.completedAt,
      })),
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/customer/orders/:id â€” full detail, owned by the token's user.
 */
router.get('/orders/:id', appAuth('jhatka_customer_order_list'), validate(V.orderIdParam), async (req, res, next) => {
  try {
    const order = await JhatkaOrder.findById(req.params.id).lean();
    if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
    if (String(order.customer) !== String(req.user._id)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Order not found for this account');
    }

    return res.json({
      order: {
        id: String(order._id),
        orderNo: order.orderNo,
        lifecycle: order.lifecycle,
        fulfilmentMode: order.fulfilmentMode,
        paymentMode: order.paymentMode,
        paymentStatus: order.paymentStatus,
        itemsSubtotal: order.itemsSubtotal,
        taxTotal: order.taxTotal,
        discountTotal: order.discountTotal,
        deliveryFee: order.deliveryFee,
        serviceFee: order.serviceFee,
        estimatedTotal: order.estimatedTotal,
        finalTotal: order.finalTotal,
        weightAdjustmentTotal: order.weightAdjustmentTotal,
        absorbedOverchargeTotal: order.absorbedOverchargeTotal,
        codAmount: order.codAmount,
        codCollectionAmount: order.codCollectionAmount,
        paidAmount: order.paidAmount,
        refundedAmount: order.refundedAmount,
        taxSnapshot: order.taxSnapshot,
        merchantOfRecord: order.merchantOfRecord,
        outletSnapshot: order.outletSnapshot,
        items: (order.items || []).map((i) => ({
          sku: i.sku,
          name: i.name,
          variantName: i.variantName,
          unitLabel: i.unitLabel,
          isVariableWeight: i.isVariableWeight,
          measurementMode: i.measurementMode,
          requestedQuantity: i.requestedQuantity,
          actualQuantity: i.actualQuantity,
          estimatedAmount: i.estimatedAmount,
          finalAmount: i.finalAmount,
          deltaAmount: i.deltaAmount,
          adjustmentDirection: i.adjustmentDirection,
          absorbedAmount: i.absorbedAmount,
          refundedAmount: i.refundedAmount,
          varianceGrams: i.varianceGrams,
          variancePct: i.variancePct,
          withinTolerance: i.withinTolerance,
          override: i.override?.at ? i.override : null,
          lineTotal: i.lineTotal,
          lineGrand: i.lineGrand,
        })),
        cancellation: order.cancellation,
        hold: order.hold,
        placedAt: order.placedAt,
        acceptedAt: order.acceptedAt,
        weightConfirmedAt: order.weightConfirmedAt,
        readyAt: order.readyAt,
        pickedUpAt: order.pickedUpAt,
        deliveredAt: order.deliveredAt,
        completedAt: order.completedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/customer/orders/:id/tracking
 *
 * Read-only projection of the order's progress. Deliberately derived from
 * timestamps rather than a `statusHistory` array on the order â€” history lives in
 * `JhatkaOrderStatusHistory`, so this route reports the CURRENT truth and does
 * not reconstruct the path to it.
 */
router.get('/orders/:id/tracking', appAuth('jhatka_customer_order_track'), validate(V.orderIdParam), async (req, res, next) => {
  try {
    const order = await JhatkaOrder.findById(req.params.id)
      .select('orderNo lifecycle delivery acceptedAt weightConfirmedAt readyAt pickedUpAt deliveredAt completedAt promisedDeliveryAt')
      .lean();
    if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
    if (String(order.customer) !== String(req.user._id)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Order not found for this account');
    }

    const milestones = [
      { key: 'placed', at: order.placedAt, label: 'Order placed' },
      { key: 'accepted', at: order.acceptedAt, label: 'Accepted by outlet' },
      { key: 'weight_confirmed', at: order.weightConfirmedAt, label: 'Weight confirmed' },
      { key: 'ready', at: order.readyAt, label: 'Packed and ready' },
      { key: 'picked_up', at: order.pickedUpAt, label: 'Picked up' },
      { key: 'delivered', at: order.deliveredAt, label: 'Delivered' },
      { key: 'completed', at: order.completedAt, label: 'Completed' },
    ];

    return res.json({
      orderNo: order.orderNo,
      lifecycle: order.lifecycle,
      hasDriver: !!order.delivery,
      promisedDeliveryAt: order.promisedDeliveryAt,
      milestones: milestones.map((m) => ({
        key: m.key,
        label: m.label,
        at: m.at || null,
        reached: !!m.at,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/customer/orders/:id/cancel
 *
 * The customer cancels. Allowed only while the order has not reached
 * PREPARING â€” after the meat is cut, cancelling is a refund conversation, not a
 * cancellation, and pretending otherwise would strand an already-packed order.
 */
router.post('/orders/:id/cancel', appAuth('jhatka_customer_order_cancel'), validate(V.orderIdParam), validate(V.cancelBody), async (req, res, next) => {
  try {
    const CANCELLABLE = ['CREATED', 'PAYMENT_PENDING', 'PAID', 'OUTLET_RECEIVED', 'ACCEPTED'];

    const order = await JhatkaOrder.findById(req.params.id);
    if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
    if (String(order.customer) !== String(req.user._id)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Order not found for this account');
    }
    if (!CANCELLABLE.includes(order.lifecycle)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `An order in ${order.lifecycle} can no longer be cancelled â€” contact the outlet`,
        true,
        '',
        { lifecycle: order.lifecycle }
      );
    }

    // `stage` is captured BEFORE the reassignment below. It used to read
    // `order.lifecycle` AFTER it, so it was always 'CANCELLED' and told you nothing.
    // BR-18's window is defined by CANCELLABLE, and the stage is what proves it was
    // honoured — a cancellation from PAID and one from ACCEPTED are different facts
    // about when the customer gave up.
    const stageAtCancel = order.lifecycle;
    order.lifecycle = 'CANCELLED';
    order.cancellation = {
      cancelledAt: new Date(),
      cancelledBy: 'customer',
      cancelledByUserId: req.user._id,
      reason: req.body?.reason,
      reasonCategory: req.body?.reasonCategory,
      stage: stageAtCancel,
    };
    await order.save();

    // BR-19. Same as the outlet reject above: the debt the cancellation creates is a
    // document. A customer who paid online and cancels gets a real refund row the 03:30
    // sweep can settle; without it their money is a field on a closed order.
    const { refund, created } = await refundSettlement.raiseOrderRefund({
      models: {
        JhatkaRefund,
        JhatkaOrder,
        JhatkaOutlet,
        PaymentInitiation,
        PaymentConfig,
      },
      order,
      reason: 'CUSTOMER_CANCELLATION',
      reasonNote: req.body?.reason,
      actor: { _id: req.user._id, name: req.user.name },
      nextNumber: orderCreationService.buildOrderNo,
    });

    return res.json({
      order: { id: String(order._id), orderNo: order.orderNo, lifecycle: order.lifecycle },
      refund: {
        id: String(refund._id),
        refundNo: refund.refundNo,
        amount: refund.amount,
        status: refund.status,
        gatewayResolution: refund.gatewayResolutionNote,
        created,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/customer/orders/:id/confirm-weight
 *
 * -3.8 â€” the customer's weight acknowledgement is a NOTIFICATION receipt, NOT an
 * approval gate. The meat is cut, weighed and bagged before a rider exists, so
 * there is nothing for the customer to approve at this point. Recording the read
 * receipt is the whole purpose of this route; refusing an order because the
 * customer did not tap would be inventing a gate the physical process cannot
 * support.
 */
router.post('/orders/:id/confirm-weight', appAuth('jhatka_customer_weight_confirm'), validate(V.orderIdParam), async (req, res, next) => {
  try {
    const order = await JhatkaOrder.findById(req.params.id)
      .select('orderNo lifecycle weightConfirmedAt')
      .lean();
    if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
    if (String(order.customer) !== String(req.user._id)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Order not found for this account');
    }
    if (!order.weightConfirmedAt) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'The outlet has not confirmed a weight for this order yet',
        true,
        '',
        { lifecycle: order.lifecycle }
      );
    }

    return res.json({
      order: {
        id: String(req.params.id),
        orderNo: order.orderNo,
        // Acknowledged, not approved. Naming this `acknowledgedAt` is deliberate.
        acknowledgedAt: new Date(),
        weightConfirmedAt: order.weightConfirmedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/customer/orders/:id/refunds
 *
 * Refunds belonging to this order. Read-only; the customer cannot trigger one
 * here â€” refunds are a consequence of the outlet's weight confirmation (-3).
 */
router.get('/orders/:id/refunds', appAuth('jhatka_customer_order_list'), validate(V.orderIdParam), async (req, res, next) => {
  try {
    const order = await JhatkaOrder.findById(req.params.id).select('customer orderNo').lean();
    if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
    if (String(order.customer) !== String(req.user._id)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Order not found for this account');
    }

    const refunds = await JhatkaRefund.find({ order: order._id }).sort({ createdAt: -1 }).lean();

    return res.json({
      refunds: refunds.map((r) => ({
        id: String(r._id),
        refundNo: r.refundNo,
        amount: r.amount,
        taxAmount: r.taxAmount,
        netAmount: r.netAmount,
        reason: r.reason,
        reasonNote: r.reasonNote,
        status: r.status,
        // Never expose the raw gateway payload to a customer.
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/customer/orders/:id/pay â€” gateway payment for a Jhatka order.
 *
 * ## ROUTE ORDER IS LOAD-LOAD-BEARING HERE
 *
 * Express matches in REGISTRATION order. This is declared AFTER
 * `GET /orders/:id/refunds` but BEFORE nothing else that could shadow it â€” there is no
 * `POST /orders/:id` sibling, so a literal `/pay` under an `:id` parent is safe. If
 * someone later adds `POST /orders/:id/:action`, this must stay above it.
 *
 * ## What this does and does not do
 *
 * It creates (or reuses) the `PaymentInitiation` row the SHARED gateway checkout
 * (`makePayment`) charges against. It does not talk to a gateway, and it does not
 * move the order to PAID â€” the verified gateway callback does, through
 * `payment.dispatch.js` -> `jhatka.payment.service.routePaidCallback`.
 *
 * That separation is the point. An order marked PAID by a request the client made is
 * an order that can be delivered without money.
 *
 * The amount is the order's own frozen `estimatedTotal`. `V.payBody` rejects an
 * `amount` key outright, and BR-06 means that total can only ever fall from here.
 */
router.post('/orders/:id/pay', appAuth('jhatka_customer_order_pay'), validate(V.orderIdParam), validate(V.payBody), async (req, res, next) => {
  try {
    const initiation = await paymentService.initiateOrderPayment({
      orderId: req.params.id,
      customerId: req.user._id,
      paymentConfigId: req.body.payment,
      paymentRef: req.body.paymentRef,
    });

    const order = await JhatkaOrder.findById(req.params.id)
      .select('orderNo lifecycle paymentMode paymentStatus estimatedTotal')
      .lean();

    return res.status(httpStatus.CREATED).json({
      initiation: {
        id: String(initiation._id),
        amount: initiation.amount,
        payment: initiation.payment,
        paymentFrom: initiation.paymentFrom,
        paymentRef: initiation.paymentRef,
        status: initiation.status,
      },
      order: {
        id: String(order._id),
        orderNo: order.orderNo,
        lifecycle: order.lifecycle,
        paymentMode: order.paymentMode,
        paymentStatus: order.paymentStatus,
        estimatedTotal: order.estimatedTotal,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/customer/subscriptions/:subscription/occurrences/:occurrence/pay â€”
 * gateway payment for ONE subscription occurrence.
 *
 * Separate from the order route because the thing being paid is a
 * `JhatkaRecurringOrder`, not an order: Â§9.5 freezes the CEILING onto the occurrence
 * when it is generated, and recomputing it at payment time would re-price a delivery
 * the customer was already told about.
 */
router.post('/subscriptions/:subscription/occurrences/:occurrence/pay', appAuth('jhatka_customer_order_pay'), validate(V.subscriptionOccurrenceParams), validate(V.payBody), async (req, res, next) => {
  try {
    const initiation = await paymentService.initiateSubscriptionPayment({
      occurrenceId: req.params.occurrence,
      customerId: req.user._id,
      paymentConfigId: req.body.payment,
      paymentRef: req.body.paymentRef,
    });

    return res.status(httpStatus.CREATED).json({
      initiation: {
        id: String(initiation._id),
        amount: initiation.amount,
        payment: initiation.payment,
        paymentFrom: initiation.paymentFrom,
        paymentRef: initiation.paymentRef,
        status: initiation.status,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * Exports used by the caller so the money helpers are not re-imported per route.
 * `codCollectablePaise` is re-exported for the partner weigh route, which is the
 * only place that decides what a rider may physically collect (BR-08).
 */
module.exports = router;
module.exports.helpers = { buildOrderNo, codCollectablePaise, fromGrams };
