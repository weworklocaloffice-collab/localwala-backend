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
 * jhatka.partner.orders.route.js â€” outlet-staff order operations. -15.2 "Partner".
 *
 * This is the highest-consequence route file in the vertical. It owns
 * `POST /orders/:order/weigh`, which is the only action in Jhatka that determines
 * money, so it is written against the verified schema rather than the blueprint.
 *
 * ## The vocabulary that actually exists
 *
 * The order's state is `lifecycle`, an UPPERCASE 21-value enum. There is no
 * `status` field. A guard written as `order.status === 'preparing'` compares
 * against `undefined` and falls through, which is how a weigh endpoint ends up
 * reachable from any state. See `verify.jhatka.routeschema.units.js`.
 *
 * Valid transitions are asserted by `assertTransition`, which reads the allowed
 * set from the model's own enum ordering rather than from a table written beside
 * it. -16.2 VW-08 requires `WEIGHT_CONFIRMED` to have occurred before
 * `PACKING`; that is enforced here in code, not in the UI.
 *
 * ## BR-06 â€” refund only, and this file is where that is enforced
 *
 *   inside the tolerance band  â†’ no financial event at all (VW-02)
 *   above the hard overcharge   â†’ `override_required`, NEVER an extra charge (VW-03)
 *   below the hard shortfall    â†’ refund automatically, no ticket (VW-04)
 *
 * `reconcileWeight` decides the direction. This file's job is to persist what it
 * decided, refuse to invent a different answer, and record WHY â€” an overage is
 * absorbed by the platform, never billed (VW-01: `finalTotal <= estimatedTotal`).
 *
 * ## Two unit vocabularies
 *
 *   requestedQuantity.unit   UPPERCASE enum â€” GRAM KG PIECE DOZEN TIER PACK
 *   variant.unitLabel       lowercase enum â€” kg g pc dozen tier piece
 *
 * Mixing them fails validation on a nested subdocument, which produces an error
 * pointing at the wrong place.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { jhatkaAuth, requireActiveOutlet } = require('../middlewares/jhatka.tenant');
const profileService = require('../services/jhatka.profile.service');
const {
  JhatkaOrder,
  JhatkaOutlet,
  JhatkaCategory,
  JhatkaProduct,
  JhatkaWeightConfirmation,
  JhatkaPreparationTicket,
  JhatkaInventoryItem,
  JhatkaInventoryMovement,
  JhatkaBatch,
  JhatkaBatchAllocation,
  JhatkaOutletVarianceFlag,
  JhatkaRefund,
  JhatkaDriver,
  JhatkaDelivery,
  JhatkaCompliance,
  PaymentInitiation,
  PaymentConfig,
} = require('../../../models');
// The weigh RULES live in the service, not here. This route keeps only the HTTP
// shell: authorise, load, delegate, respond.
const weighService = require('../services/jhatka.weigh.service');
const reservationService = require('../services/jhatka.reservation.service');
// Platform transit cap, behind the outlet's own quality policy (BR-12).
const jhatkaSettingsService = require('../../../services/jhatka.settings.service');
const lifecycleService = require('../services/jhatka.order-lifecycle.service');
const fulfilmentService = require('../services/jhatka.order-fulfilment.service');
const refundSettlement = require('../services/jhatka.refund.settlement');
const { assertJhatkaOperational } = require('../services/jhatka.compliance-gate.service');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.partner.orders.validation');
// Every `moneyField` write below goes through `asMoney`.
//
// `reconcileWeight` returns PAISE, and every Jhatka money helper works in paise.
// A `moneyField` setter takes RUPEES and multiplies by 100, so assigning paise
// directly stores 100Ã— the real amount â€” the shipped bug found by
// `verify.jhatka.integration.js`. See `utils/money.js`.
const { asMoney } = require('../utils/money');

const router = express.Router();

/** Every partner order route resolves tenancy first. Never a bare appAuth. */
const partnerAuth = [jhatkaAuth(), requireActiveOutlet];

/**
 * Allowed lifecycle transitions â€” DELEGATED to `jhatka.order-lifecycle.service`.
 *
 * This block used to be the implementation: an enum-INDEX comparison, plus explicit
 * `TERMINAL` and `SIDEWAYS` lists, with `CANCELLED` special-cased because it sits after
 * `REJECTED` in the enum while being reachable from almost everywhere.
 *
 * It is now the model's `ORDER_TRANSITIONS` table, read through the service, for two
 * reasons.
 *
 * First, correctness. `weigh.service` used to receive this function as an INJECTED
 * parameter and `jhatka.payment.service` called `JhatkaOrder.canTransition` directly.
 * Three mechanisms, two rule sets â€” and the index comparison here would refuse a move
 * that the table permits. They agreed by luck.
 *
 * Second, this exact comment block was the third place to describe Â§8.2. The table on
 * the model is the one the verify suite reads, so it is the one everything reads.
 *
 * `LIFECYCLE_ENUM`, `TERMINAL` and `SIDEWAYS` are still exported below because the
 * weight/variance logic reads them. `TERMINAL` is now DERIVED (a state with no
 * outgoing edges) rather than listed, so a new terminal state cannot be added to Â§8.2
 * without this list noticing.
 */
const {
  assertTransition,
  lifecycleStates: LIFECYCLE_ENUM,
  terminalStates: TERMINAL,
} = lifecycleService;

/** Load an order belonging to the ACTIVE outlet, or throw. */
const loadOwnOrder = async (orderId, outletId) => {
  const order = await JhatkaOrder.findOne({ _id: orderId, outlet: outletId });
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Order not found for this outlet');
  }
  return order;
};

/**
 * Load the outlet for a compliance check.
 *
 * One indexed query per mutating request. The alternative — trusting `req.outlet`
 * from the tenant middleware — would couple the compliance gate to whatever the
 * middleware happened to load, and a middleware that loads a partial projection
 * would silently pass a suspended outlet.
 */
const loadOutletForGate = async (outletId) => {
  const outlet = await JhatkaOutlet.findById(outletId).lean();
  if (!outlet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
  }
  return outlet;
};

/**
 * Assert this outlet may perform `operation`, or throw a 403 with a code.
 *
 * Called from every mutating handler in this file. §12.2's table, one line per
 * handler, with the OPERATION named so the distinction between "starting" and
 * "finishing" is visible at the call site rather than buried in a middleware.
 */
const gate = (outlet, operation, models) =>
  assertJhatkaOperational({ outlet, operation, models });

const nextNumber = (prefix) => {
  const now = new Date();
  const stamp =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  return `${prefix}${stamp}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
};
// ---------------------------------------------------------------------------
// GET /jhatka/partner/orders
// ---------------------------------------------------------------------------
router.get('/', ...partnerAuth, async (req, res, next) => {
  try {
    return res.json(await fulfilmentService.listOrders({
      models: { JhatkaOrder },
      outletId: req.outletId,
      query: req.query,
    }));
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /jhatka/partner/orders/:order
// ---------------------------------------------------------------------------
router.get('/:order', ...partnerAuth, validate(V.orderParam), async (req, res, next) => {
  try {
    const order = await JhatkaOrder.findById(req.params.order)
      .populate('customer', 'name phone email')
      .lean();
    if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
    if (String(order.outlet) !== req.outletId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Order not in this outlet');
    }

    return res.json(await fulfilmentService.orderDetail({
      models: { JhatkaPreparationTicket, JhatkaWeightConfirmation },
      order,
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/orders/:order/receive
 * ---------------------------------------------------------------------------
 */
/**
 * POST /:order/receive - the outlet acknowledges the order is on its screen.
 *
 * ## Why this route exists
 *
 * 8.1 puts `OUTLET_RECEIVED` between `PAID` and `ACCEPTED`, and `ORDER_TRANSITIONS`
 * has edges into and out of it. But nothing WROTE it: no route, no service, no cron.
 *
 * The consequence was that `accept` was unreachable. `ACCEPTED` is only legal from
 * `OUTLET_RECEIVED`, so `POST /:order/accept` could never succeed - except that the
 * guard it used was an enum-INDEX comparison which permitted any forward jump, so an
 * order could skip straight from `CREATED` to `ACCEPTED`. Consolidating the three
 * copies of the transition rule onto `jhatka.order-lifecycle.service` surfaced it.
 *
 * It is also the right step to have. `Received` is where an outlet's SLA clock starts,
 * and it is what tells a customer their order reached a real counter rather than a
 * queue - so making it explicit is worth having even though the state machine needed
 * it either way.
 *
 * COD orders arrive here from `CREATED`; gateway orders from `PAID`.
 */
router.post('/:order/receive', ...partnerAuth, validate(V.orderParam), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'orders.accept');

    const order = await loadOwnOrder(req.params.order, req.outletId);
    // `receive` takes an order onto the counter, so it is new business for §12.2:
    // a lapsed outlet may finish what it started but may not take on more.
    await gate(await loadOutletForGate(req.outletId), 'receive', { JhatkaCompliance });

    return res.json(await fulfilmentService.receiveOrder({ order }));
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /jhatka/partner/orders/:order/accept
// ---------------------------------------------------------------------------
router.post('/:order/accept', ...partnerAuth, validate(V.orderParam), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'orders.accept');

    const order = await loadOwnOrder(req.params.order, req.outletId);
    // Accepting takes the order onto the counter: new business, so a lapsed outlet
    // may not do it. An order placed yesterday and accepted this morning after an
    // overnight lapse is refused — it was never taken on, so §12.2's "existing
    // orders continue" does not cover it.
    await gate(await loadOutletForGate(req.outletId), 'accept', { JhatkaCompliance });

    return res.json(await fulfilmentService.acceptOrder({ order }));
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /jhatka/partner/orders/:order/reject
// ---------------------------------------------------------------------------
router.post('/:order/reject', ...partnerAuth, validate(V.orderParam), validate(V.rejectBody), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'orders.reject');

    const order = await loadOwnOrder(req.params.order, req.outletId);

    return res.json(await fulfilmentService.rejectOrder({
      models: { JhatkaRefund, JhatkaOrder, JhatkaOutlet, PaymentInitiation, PaymentConfig },
      order,
      body: req.body || {},
      actor: { _id: req.user._id, name: req.user.name },
      nextNumber,
      refundSettlement,
    }));
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /jhatka/partner/orders/:order/start-preparation
// ---------------------------------------------------------------------------
router.post('/:order/start-preparation', ...partnerAuth, validate(V.orderParam), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'preparation.start');

    const order = await loadOwnOrder(req.params.order, req.outletId);

    const result = await fulfilmentService.startPreparation({
      models: {
        JhatkaPreparationTicket,
        JhatkaInventoryItem,
        JhatkaBatchAllocation,
        JhatkaOutlet,
      },
      order,
      outletId: req.outletId,
      body: req.body || {},
      actor: { _id: req.user._id, name: req.user.name },
      nextNumber,
      reservationService,
      entryReason: entry_reason,
    });
    return res.status(httpStatus.CREATED).json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * The enum is `initial | on_hold_release | customer_substitution | reweigh`, and a
 * free-text reason would fail validation on a nested field.
 */
function entry_reason(raw) {
  const allowed = ['initial', 'on_hold_release', 'customer_substitution', 'reweigh'];
  if (allowed.includes(raw)) return raw;
  if (raw) return 'reweigh';
  return 'initial';
}

// ---------------------------------------------------------------------------
// POST /jhatka/partner/orders/:order/weigh   ← the money endpoint. §8.5, §16.2
// ---------------------------------------------------------------------------
router.post('/:order/weigh', ...partnerAuth, validate(V.orderParam), validate(V.weighBody), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'weight.confirm');

    const order = await loadOwnOrder(req.params.order, req.outletId);
    const outlet = await JhatkaOutlet.findById(req.outletId).lean();

    // The weigh rules live in the service. They used to live here, in ~480 lines,
    // and every defect `verify.jhatka.integration.js` found in this vertical was
    // inside that block: a 100x paise/rupee mix-up, a lifecycle transition that
    // validated but never applied, a `finalTotal` that forgot tax, and a replay
    // that died on a unique index. Keeping HTTP here and the arithmetic there means
    // the bug-prone surface is the one that can be unit-tested directly.
    const result = await weighService.weighOrder({
      order,
      outlet,
      actor: { _id: req.user._id, name: req.user.name },
      body: req.body,
      models: {
        JhatkaProduct,
        JhatkaCategory,
        JhatkaOutlet,
        JhatkaWeightConfirmation,
        JhatkaRefund,
        JhatkaOutletVarianceFlag,
        JhatkaInventoryItem,
        JhatkaInventoryMovement,
        JhatkaBatch,
        JhatkaBatchAllocation,
      },
      nextNumber,
    });

    // A replay short-circuits inside the service and returns the existing
    // confirmation. `replayed` tells the client this was not a new weighing, so a
    // retrying client can tell "nothing changed" from "something did".
    if (result.replayed) {
      return res.json({ replayed: true, order: result.order, confirmations: result.confirmations });
    }

    return res.json({
      order: {
        id: String(order._id),
        orderNo: order.orderNo,
        lifecycle: order.lifecycle,
        estimatedTotal: order.estimatedTotal,
        finalTotal: order.finalTotal,
        weightAdjustmentTotal: order.weightAdjustmentTotal,
        absorbedOverchargeTotal: order.absorbedOverchargeTotal,
        refundedAmount: order.refundedAmount,
        codAmount: order.codAmount,
        // `codCollectable` is PAISE — `codCollectablePaise` returns paise — so it is
        // converted here at the response boundary, where the moneyField convention
        // says the API speaks rupees.
        codCollectable: asMoney(result.collectable),
        weightConfirmedAt: order.weightConfirmedAt,
      },
      confirmations: result.confirmations,
    });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /jhatka/partner/orders/:order/pack
// ---------------------------------------------------------------------------
router.post('/:order/pack', ...partnerAuth, validate(V.orderParam), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'packing.complete');

    const order = await loadOwnOrder(req.params.order, req.outletId);

    return res.json(await fulfilmentService.packOrder({
      order,
      body: req.body || {},
      actor: { _id: req.user._id, name: req.user.name },
    }));
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /jhatka/partner/orders/:order/ready
// ---------------------------------------------------------------------------
router.post('/:order/ready', ...partnerAuth, validate(V.orderParam), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'packing.complete');

    const order = await loadOwnOrder(req.params.order, req.outletId);

    return res.json(await fulfilmentService.markReady({ order }));
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /jhatka/partner/orders/:order/dispatch
// ---------------------------------------------------------------------------
router.post('/:order/dispatch', ...partnerAuth, validate(V.orderParam), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'delivery.dispatch');

    const order = await loadOwnOrder(req.params.order, req.outletId);

    const result = await fulfilmentService.dispatchOrder({
      models: { JhatkaDriver, JhatkaOutlet, JhatkaDelivery },
      order,
      outletId: req.outletId,
      body: req.body || {},
      actor: { _id: req.user._id, name: req.user.name },
      nextNumber,
      settingsService: jhatkaSettingsService,
    });
    return res.status(httpStatus.CREATED).json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * Exported for the vertical verifier, which asserts the transition table is
 * derived from the model enum rather than hand-maintained beside it.
 */
router.assertTransition = assertTransition;
router.LIFECYCLE_ENUM = LIFECYCLE_ENUM;
router.TERMINAL = TERMINAL;

module.exports = router;
module.exports.helpers = { assertTransition, LIFECYCLE_ENUM, TERMINAL };
