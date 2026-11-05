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
 * jhatka.partner.supply.route.js — the partner side of stock supply (OD-12
 * companion): request stock from LocalWala, see requests and ledger balance,
 * prepay a request.
 *
 * Tenancy: every route is `jhatkaAuth` scoped to the token's outlet — a
 * partner sees ONLY their own requests and their own ledger. The ledger is
 * read-only here: it is proof, not editable text (the inventory console's
 * convention).
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { jhatkaAuth, requireActiveOutlet } = require('../middlewares/jhatka.tenant');
const profileService = require('../services/jhatka.profile.service');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.supply.validation');
const supplyService = require('../services/jhatka.supply-request.service');
const ledgerService = require('../services/jhatka.partner-ledger.service');
const paymentService = require('../services/jhatka.payment.service');

const {
  JhatkaOutlet,
  JhatkaProduct,
  JhatkaSupplyRequest,
  JhatkaPartnerLedger,
  JhatkaOperatorPayout,
} = require('../../../models');

const router = express.Router();

/** Every route: tenant auth, an active outlet, and a role that may act. */
const supplyAuth = [jhatkaAuth(), requireActiveOutlet];

// ---------------------------------------------------------------------------
// GET /jhatka/partner/supply/catalogue — what can be requested
// ---------------------------------------------------------------------------
router.get('/catalogue', ...supplyAuth, async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'supply.request');
    const products = await JhatkaProduct.find({ status: true })
      .select('name category rawSku description')
      .sort({ name: 1 })
      .lean();
    return res.json({ products, count: products.length });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /jhatka/partner/supply/modes — which payment modes this outlet may use
// (the UI renders THIS, never its own guess)
// ---------------------------------------------------------------------------
router.get('/modes', ...supplyAuth, async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'supply.request');
    const prepaidBalancePaise = await ledgerService.getBalance({
      models: { JhatkaPartnerLedger },
      outletId: req.outletId,
    });
    const { modes, reasons, outstandingPaise } = await supplyService.computeEligibleModes({
      models: { JhatkaOperatorPayout, JhatkaSupplyRequest, JhatkaPartnerLedger },
      outletId: req.outletId,
      requestValuePaise: 0,
      prepaidBalancePaise,
      creditCapPaise: await require('../../../services/jhatka.settings.service').getSupplyCreditCapPaise(),
    });
    return res.json({ modes, reasons, prepaidBalancePaise, outstandingPaise });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /jhatka/partner/supply/requests — create a request
// ---------------------------------------------------------------------------
router.post('/requests', ...supplyAuth, validate(V.supplyRequestCreateBody), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'supply.request');

    const { request, eligibleModes } = await supplyService.createRequest({
      models: { JhatkaOutlet, JhatkaProduct, JhatkaSupplyRequest, JhatkaPartnerLedger, JhatkaOperatorPayout },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      body: req.body || {},
    });
    return res.status(httpStatus.CREATED).json({ request, eligibleModes });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /jhatka/partner/supply/requests — this outlet's requests
// ---------------------------------------------------------------------------
router.get('/requests', ...supplyAuth, async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'supply.request');
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { outlet: req.outletId };
    if (status) filter.status = status;

    const [requests, total] = await Promise.all([
      JhatkaSupplyRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Math.min(Number(limit), 100))
        .lean(),
      JhatkaSupplyRequest.countDocuments(filter),
    ]);
    return res.json({ requests, count: total });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /jhatka/partner/supply/requests/:id — one request
// ---------------------------------------------------------------------------
router.get('/requests/:id', ...supplyAuth, validate(V.idParam), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'supply.request');
    const request = await JhatkaSupplyRequest.findOne({
      _id: req.params.id,
      outlet: req.outletId,
    }).lean();
    if (!request) throw new (require('../../../utils/ApiError'))(
      httpStatus.NOT_FOUND, 'Supply request not found'
    );
    return res.json({ request });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /jhatka/partner/supply/requests/:id/pay — prepay (gateway handoff)
//
// Same shape as the customer order pay: creates a PaymentInitiation, the shared
// checkout completes it, and the VERIFIED callback (payment.dispatch) marks the
// request paid. No amount is sent — the server knows the approved value.
// ---------------------------------------------------------------------------
router.post('/requests/:id/pay', ...supplyAuth, validate(V.idParam), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'supply.request');

    const request = await JhatkaSupplyRequest.findOne({
      _id: req.params.id,
      outlet: req.outletId,
    });
    if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Supply request not found');
    if (request.paymentMode !== 'prepaid') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'Only prepaid requests can be paid here',
        true, '', { code: 'NOT_PREPAID' }
      );
    }
    if (request.status !== 'approved' || !request.approvedValuePaise) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'An admin must approve the request (and set the price) before it can be paid',
        true, '', { code: 'NOT_APPROVED' }
      );
    }
    if (request.payment?.status === 'paid') {
      return res.json({ request: request.toObject(), alreadyPaid: true });
    }

    const initiation = await paymentService.createSupplyRequestPayment({
      request,
      actor: { _id: req.user._id, name: req.user.name },
    });
    return res.status(httpStatus.CREATED).json({ initiation });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /jhatka/partner/supply/ledger — the account record (read-only)
// ---------------------------------------------------------------------------
router.get('/ledger', ...supplyAuth, async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'supply.request');
    const { page = 1, limit = 50 } = req.query;
    const filter = { outlet: req.outletId };
    const [entries, total, balancePaise] = await Promise.all([
      JhatkaPartnerLedger.find(filter)
        .sort({ seq: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Math.min(Number(limit), 200))
        .lean(),
      JhatkaPartnerLedger.countDocuments(filter),
      ledgerService.getBalance({
        models: { JhatkaPartnerLedger },
        outletId: req.outletId,
      }),
    ]);
    return res.json({ entries, count: total, balancePaise });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// OD-12 companion: delivery-area adjustment requests (increase/decrease, both
// admin-approved). The ceiling is checked HERE — a proposal beyond it never
// enters the queue.
// ---------------------------------------------------------------------------
const areaService = require('../services/jhatka.area-change.service');
const { Vertical } = require('../../../models');

// GET /jhatka/partner/supply/area — current rings + the platform ceiling
router.get('/area', ...supplyAuth, async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'supply.request');
    const outlet = await JhatkaOutlet.findById(req.outletId)
      .select('serviceArea businessModel business')
      .lean();
    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
    const maxRadiusKm = await areaService.getMaxRadiusKm({ models: { Vertical } });
    const open = await (require('../../../models').JhatkaAreaChangeRequest)
      .findOne({ outlet: req.outletId, status: 'requested' }).lean();
    return res.json({
      serviceArea: outlet.serviceArea || {},
      maxRadiusKm,
      openRequest: open
        ? { id: String(open._id), requestNo: open.requestNo, proposed: open.proposed }
        : null,
      canRequest: outlet.businessModel !== 'direct',
    });
  } catch (error) {
    return next(error);
  }
});

// POST /jhatka/partner/supply/area/requests — propose new rings
router.post('/area/requests', ...supplyAuth, validate(V.areaRequestCreateBody), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'supply.request');
    const result = await areaService.createAreaRequest({
      models: { JhatkaOutlet, JhatkaAreaChangeRequest: require('../../../models').JhatkaAreaChangeRequest, Vertical },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      body: req.body || {},
    });
    return res.status(httpStatus.CREATED).json(result);
  } catch (error) {
    return next(error);
  }
});

// DELETE /jhatka/partner/supply/area/requests/:id — the partner withdraws
router.delete('/area/requests/:id', ...supplyAuth, validate(V.idParam), async (req, res, next) => {
  try {
    profileService.assertCan(req.role, 'supply.request');
    const request = await (require('../../../models').JhatkaAreaChangeRequest)
      .findOne({ _id: req.params.id, outlet: req.outletId });
    if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Area request not found');
    const result = await areaService.cancelAreaRequest({
      models: { JhatkaAreaChangeRequest: require('../../../models').JhatkaAreaChangeRequest },
      requestId: req.params.id,
      actor: { _id: req.user._id, name: req.user.name },
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
