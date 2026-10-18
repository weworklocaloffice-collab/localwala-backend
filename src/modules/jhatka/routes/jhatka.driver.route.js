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

/**
 * jhatka.driver.route.js — the rider's own surface. -15.2 "Driver".
 *
 * ## No platform pool, so no code path for one
 *
 * -13.2 and OD-06 define exactly ONE rider type for Jhatka: outlet-owned.
 * `JhatkaDriver.outlet` is REQUIRED, `ownDeliveryPartner` is always true, and
 * `driverPayoutMode` is always `business_pays`.
 *
* The `agentMode` enum retains `platform_pool` for shape-compatibility with dairy's
 * fleet handling, but the Jhatka delivery model now DEFAULTS to `own_fleet` (it
 * previously defaulted to `platform_pool`, which silently booked dispatches against a
 * pool that does not exist), and there is no handler here for pooled work. That is
 * deliberate, not an oversight — those values exist because the model shares its
 * shape with dairy's fleet handling, and writing handlers for them would create a
 * path where a Jhatka delivery has NO outlet, and therefore no tenancy, no batch
 * and no recall trail. -15.1 requires tenancy on every outlet route; a pool rider
 * would be an exception to the one rule this vertical is built on.
 *
 * ## `failed` is a first-class outcome, not an error to swallow
 *
 * `status` has `failed` beside `delivered`, and COD becomes `failed` rather than
 * disappearing, because money was collected or not and somebody must reconcile it.
 * `POST /deliveries/:delivery/fail` is where that is decided, and it REQUIRES a
 * reason.
 *
 * ## `clientRef` is the idempotency key
 *
 * A POD captured in a lift has no reliable network and WILL be retried.
 * `JhatkaDeliveryPOD.clientRef` is unique per delivery, so a repeat POST returns the
 * ORIGINAL record instead of a second one — two proofs of one delivery means a
 * reconciliation that never balances.
 *
 * ## Params are `:delivery`
 *
 * `JhatkaDelivery._id` is the identifier and `deliveryNo` is the human-facing one.
 * The previous version of this file used `:deliveryId`, which matched nothing in the
 * model and read as though there were two delivery identifiers.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { jhatkaAuth, requireRole } = require('../middlewares/jhatka.tenant');
const profileService = require('../services/jhatka.profile.service');
const deliveryService = require('../services/jhatka.delivery.service');
const {
  JhatkaDelivery,
  JhatkaDeliveryPOD,
  JhatkaDeliverySettlement,
  JhatkaDriver,
  JhatkaOrder,
  JhatkaOutlet,
} = require('../../../models');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.driver.validation');
const lifecycleService = require('../services/jhatka.order-lifecycle.service');

const router = express.Router();

/**
 * Rider auth. `jhatkaAuth` resolves the outlet server-side from `JhatkaDriver.outlet`
 * — a rider never sends an outlet id. `requireRole('jhatkaDriver')` then fails the
 * request unless the resolved role is the rider role, so a partner session hitting a
 * rider route is a 403 rather than a co-mingled session.
 */
/**
 * `requireRole('driver')` — the OUTLET role the scope resolver returns for a
 * rider — not `'jhatkaDriver'`, which is the PLATFORM login role and never
 * appears on `req.role`. The previous value 403d every rider endpoint for
 * every rider, with no test failing because no test called them.
 */
const riderAuth = [jhatkaAuth(), requireRole('driver')];

const cap = (capability) => async (req, res, next) => {
  try {
    profileService.assertCan(req.role, capability);
    return next();
  } catch (error) {
    return next(error);
  }
};

const DELIVERY_ENUM = JhatkaDelivery.schema.path('status').enumValues;

/**
 * Rider delivery guards live in `../middlewares/jhatka.delivery` — every
 * handler here used to carry its own copies.
 */
const { loadOwnDelivery } = require('../middlewares/jhatka.delivery');

/**
 * Business logic lives in `../services/jhatka.rider.service`. This file keeps
 * auth, capability, validation, tenancy (`loadOwnDelivery`) and the response
 * contract — nothing that decides or persists.
 */
const riderService = require('../services/jhatka.rider.service');

/**
 * GET /jhatka/driver/deliveries
 *
 * The rider's queue. `active=true` returns only what is currently in hand.
 */
router.get('/deliveries', ...riderAuth, cap('delivery.read'), async (req, res, next) => {
  try {
    return res.json(await riderService.listDeliveries({
      models: { JhatkaDelivery },
      driverUserId: req.user._id,
      query: req.query,
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/driver/deliveries/:delivery
 *
 * Full detail, including the order lines and the POD if one exists.
 */
router.get('/deliveries/:delivery', ...riderAuth, cap('delivery.read'), validate(V.deliveryParam), async (req, res, next) => {
  try {
    const delivery = await loadOwnDelivery(req.params.delivery, req.user._id);
    return res.json(await riderService.deliveryDetail({
      models: { JhatkaOrder, JhatkaOutlet, JhatkaDeliveryPOD },
      delivery,
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/driver/deliveries/:delivery/accept
 */
router.post('/deliveries/:delivery/accept', ...riderAuth, cap('delivery.accept'), validate(V.deliveryParam), async (req, res, next) => {
  try {
    const delivery = await loadOwnDelivery(req.params.delivery, req.user._id);
    return res.json(await riderService.acceptDelivery({
      models: { JhatkaDriver },
      delivery,
      driverUserId: req.user._id,
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/driver/deliveries/:delivery/pickup
 *
 * Records `coldChain.pickedUpTempC`, because the transit temperature question can
 * only be answered if the reading at the moment of pickup was kept.
 */
router.post('/deliveries/:delivery/pickup', ...riderAuth, cap('delivery.update'), validate(V.deliveryParam), async (req, res, next) => {
  try {
    const delivery = await loadOwnDelivery(req.params.delivery, req.user._id);
    return res.json(await riderService.pickupDelivery({
      models: { JhatkaOrder },
      delivery,
      body: req.body || {},
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/driver/deliveries/:delivery/out-for-delivery
 *
 * `out_for_delivery` — not `en_route`, which is what the previous version of this
 * file used and which is not in the enum.
 */
router.post('/deliveries/:delivery/out-for-delivery', ...riderAuth, cap('delivery.update'), validate(V.deliveryParam), async (req, res, next) => {
  try {
    const delivery = await loadOwnDelivery(req.params.delivery, req.user._id);
    return res.json(await riderService.markOutForDelivery({
      models: { JhatkaOrder },
      delivery,
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/driver/deliveries/:delivery/arrived
 */
router.post('/deliveries/:delivery/arrived', ...riderAuth, cap('delivery.update'), validate(V.deliveryParam), async (req, res, next) => {
  try {
    const delivery = await loadOwnDelivery(req.params.delivery, req.user._id);
    return res.json(await riderService.markArrived({
      delivery,
      body: req.body || {},
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/driver/deliveries/:delivery/deliver
 *
 * §13.4: the body carries `deliveredTempC`. A breach raises a complaint
 * AUTOMATICALLY — this is the §5/§13 food-safety path, and it is the reason the
 * temperature reading is on the delivery rather than in a note.
 *
 * The POD is created here through the same idempotent helper `POST /pod` uses, so a
 * rider who calls `/deliver` and then retries it cannot produce two proofs.
 */
router.post('/deliveries/:delivery/deliver', ...riderAuth, cap('delivery.otp'), validate(V.deliveryParam), validate(V.deliverBody), async (req, res, next) => {
  try {
    const delivery = await loadOwnDelivery(req.params.delivery, req.user._id);

    const {
      clientRef,
      deliveredTempC,
      photo,
      signature,
      location,
      otp,
      receiverName,
      codCollected,
      note,
    } = req.body || {};

    if (!clientRef) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'clientRef is required and is the idempotency key for this POD'
      );
    }

    // The close-out lives in the service: idempotent POD, breach complaint,
    // delivery/order/driver updates. This handler keeps auth, loading, the
    // clientRef gate and the response contract.
    const result = await deliveryService.deliverPod({
      delivery,
      clientRef,
      deliveredTempC,
      photo,
      signature,
      location,
      otp,
      receiverName,
      codCollected,
      note,
      capturedBy: req.user._id,
      capturedByName: req.user.name,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/driver/pod
 *
 * Standalone POD capture, idempotent on `clientRef`. Exists because §15.2 lists it
 * separately from `/deliver`: a rider may photograph proof before the order is
 * formally closed, and a retry must not create a second record.
 */
router.post('/pod', ...riderAuth, cap('delivery.otp'), validate(V.podBody), async (req, res, next) => {
  try {
    const { delivery: deliveryId } = req.body || {};
    if (!deliveryId) throw new ApiError(httpStatus.BAD_REQUEST, 'delivery is required');

    const delivery = await loadOwnDelivery(deliveryId, req.user._id);
    const result = await riderService.capturePod({
      models: { JhatkaDeliveryPOD },
      delivery,
      body: req.body || {},
      actor: { _id: req.user._id, name: req.user.name },
    });
    return res.status(result.idempotentReplay ? httpStatus.OK : httpStatus.CREATED).json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/driver/deliveries/:delivery/fail
 *
 * A first-class outcome. REQUIRES a reason, and sets COD to `failed` rather than
 * leaving it pending, because the money question has to reach somebody.
 */
router.post('/deliveries/:delivery/fail', ...riderAuth, cap('delivery.update'), validate(V.deliveryParam), validate(V.failBody), async (req, res, next) => {
  try {
    const delivery = await loadOwnDelivery(req.params.delivery, req.user._id);
    return res.json(await riderService.failDelivery({
      models: { JhatkaDriver },
      delivery,
      body: req.body || {},
      actor: { _id: req.user._id, name: req.user.name },
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/driver/deliveries/:delivery/collect-cod
 *
 * Reconciles a COD collection recorded outside the POD flow — a shop settling up
 * after the fact. Idempotent per collection: the same `clientRef` cannot be counted
 * twice, because a settlement built on a doubled collection overstates what the
 * outlet owes.
 */
router.post('/deliveries/:delivery/collect-cod', ...riderAuth, cap('delivery.update'), validate(V.deliveryParam), validate(V.collectCodBody), async (req, res, next) => {
  try {
    const delivery = await loadOwnDelivery(req.params.delivery, req.user._id);
    const { amountPaise, clientRef, receiptPhoto } = req.body || {};

    if (amountPaise === undefined) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'amountPaise is required');
    }
    const amount = Number(amountPaise);
    if (!Number.isInteger(amount) || amount < 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'amountPaise must be a non-negative integer');
    }

    // Idempotency uses the model's own fields: `codCollectedAt` records WHEN
    // the collection was counted and `codReceiptUrl` ties it to a receipt
    // photo. A second POST is a retry from a flaky connection, not a second
    // collection. The rules live in the service; this handler keeps auth,
    // loading, validation and the response contract.
    const result = await deliveryService.collectPod({
      delivery,
      amountPaise,
      clientRef,
      receiptPhoto,
      capturedBy: req.user._id,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/driver/earnings
 *
 * Read-only. Payout state lives on `JhatkaDeliverySettlement` and only an owner or
 * manager may mark one paid, so a rider can see their own period but cannot move it.
 */
router.get('/earnings', ...riderAuth, cap('delivery.read'), async (req, res, next) => {
  try {
    return res.json(await riderService.riderEarnings({
      models: { JhatkaDriver, JhatkaDeliverySettlement },
      driverUserId: req.user._id,
      query: req.query,
    }));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.DELIVERY_ENUM = DELIVERY_ENUM;
module.exports.riderAuth = riderAuth;
module.exports.cap = cap;
module.exports.loadOwnDelivery = loadOwnDelivery;