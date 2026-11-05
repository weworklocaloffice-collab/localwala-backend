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
 * jhatka.admin.supply.route.js — the platform side of stock supply.
 *
 * The admin's acts here are CREDIT decisions as much as stock ones: approving
 * a request freezes the transfer price and (for deduct mode) extends credit up
 * to the platform cap. Approval is therefore a deliberate, right-gated act —
 * the same reasoning as outlet activation.
 *
 * GET-only consoles read; nothing here deletes (BR-23).
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const webAuth = require('../../../middlewares/webAuth');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.supply.validation');
const supplyService = require('../services/jhatka.supply-request.service');
const ledgerService = require('../services/jhatka.partner-ledger.service');

const {
  JhatkaSupplyRequest,
  JhatkaPartnerLedger,
  JhatkaOutlet,
} = require('../../../models');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /v1/jhatka/admin/supply/requests — the approval queue
// ---------------------------------------------------------------------------
router.get('/supply/requests', webAuth('jhatka_supply_read'), async (req, res, next) => {
  try {
    const { status, outlet, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (outlet) filter.outlet = outlet;

    const [requests, total] = await Promise.all([
      JhatkaSupplyRequest.find(filter)
        .populate('outlet', 'name outletCode businessModel')
        .populate('items.product', 'name')
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
// GET /v1/jhatka/admin/supply/requests/:id
// ---------------------------------------------------------------------------
router.get('/supply/requests/:id', webAuth('jhatka_supply_read'), validate(V.idParam), async (req, res, next) => {
  try {
    const request = await JhatkaSupplyRequest.findById(req.params.id)
      .populate('outlet', 'name outletCode businessModel')
      .populate('items.product', 'name')
      .lean();
    if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Supply request not found');
    return res.json({ request });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /v1/jhatka/admin/supply/requests/:id/approve — freeze rates, take the credit decision
// ---------------------------------------------------------------------------
router.post('/supply/requests/:id/approve', webAuth('jhatka_supply_write'), validate(V.idParam), validate(V.supplyApproveBody), async (req, res, next) => {
  try {
    const result = await supplyService.approveRequest({
      models: { JhatkaSupplyRequest },
      requestId: req.params.id,
      actor: { _id: req.user._id, name: req.user.name },
      body: req.body || {},
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /v1/jhatka/admin/supply/requests/:id/reject
// ---------------------------------------------------------------------------
router.post('/supply/requests/:id/reject', webAuth('jhatka_supply_write'), validate(V.idParam), validate(V.supplyReasonBody), async (req, res, next) => {
  try {
    const result = await supplyService.rejectRequest({
      models: { JhatkaSupplyRequest },
      requestId: req.params.id,
      actor: { _id: req.user._id, name: req.user.name },
      reason: req.body?.reason,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /v1/jhatka/admin/supply/requests/:id/cancel
// ---------------------------------------------------------------------------
router.post('/supply/requests/:id/cancel', webAuth('jhatka_supply_write'), validate(V.idParam), validate(V.supplyReasonBody), async (req, res, next) => {
  try {
    const result = await supplyService.cancelRequest({
      models: { JhatkaSupplyRequest },
      requestId: req.params.id,
      actor: { _id: req.user._id, name: req.user.name },
      reason: req.body?.reason,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /v1/jhatka/admin/supply/requests/:id/fulfil — stock delivered
// (receipt POSTED + ledger debit; resumable — see the service)
// ---------------------------------------------------------------------------
router.post('/supply/requests/:id/fulfil', webAuth('jhatka_supply_write'), validate(V.idParam), validate(V.supplyFulfilBody), async (req, res, next) => {
  try {
    const result = await supplyService.fulfilRequest({
      models: {
        JhatkaSupplyRequest,
        JhatkaProcurementReceipt: require('../../../models').JhatkaProcurementReceipt,
        JhatkaPartnerLedger,
        JhatkaPurchaseOrder: require('../../../models').JhatkaPurchaseOrder,
        JhatkaInventoryItem: require('../../../models').JhatkaInventoryItem,
        JhatkaInventoryMovement: require('../../../models').JhatkaInventoryMovement,
        JhatkaBatch: require('../../../models').JhatkaBatch,
        JhatkaBatchAllocation: require('../../../models').JhatkaBatchAllocation,
        JhatkaOutlet,
      },
      requestId: req.params.id,
      actor: { _id: req.user._id, name: req.user.name },
      body: req.body || {},
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /v1/jhatka/admin/supply/ledger/:outlet — a partner's account record
// ---------------------------------------------------------------------------
router.get('/supply/ledger/:outlet', webAuth('jhatka_supply_read'), validate(V.idParam), async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const filter = { outlet: req.params.outlet };
    const [entries, total, balancePaise, outlet] = await Promise.all([
      JhatkaPartnerLedger.find(filter)
        .sort({ seq: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Math.min(Number(limit), 200))
        .lean(),
      JhatkaPartnerLedger.countDocuments(filter),
      ledgerService.getBalance({
        models: { JhatkaPartnerLedger },
        outletId: req.params.outlet,
      }),
      JhatkaOutlet.findById(req.params.outlet).select('name outletCode businessModel').lean(),
    ]);
    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
    return res.json({ entries, count: total, balancePaise, outlet });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// OD-12 companion: partner-proposed area changes. Approval applies the values
// to the outlet atomically — a credit and delivery-promise decision.
// ---------------------------------------------------------------------------
const areaService = require('../services/jhatka.area-change.service');

router.get('/supply/area-requests', webAuth('jhatka_supply_read'), async (req, res, next) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const requests = await (require('../../../models').JhatkaAreaChangeRequest)
      .find(filter)
      .populate('outlet', 'name outletCode businessModel serviceArea')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ requests, count: requests.length });
  } catch (error) {
    return next(error);
  }
});

router.post('/supply/area-requests/:id/approve', webAuth('jhatka_supply_write'), validate(V.idParam), async (req, res, next) => {
  try {
    const result = await areaService.approveAreaRequest({
      models: {
        JhatkaAreaChangeRequest: require('../../../models').JhatkaAreaChangeRequest,
        JhatkaOutlet,
      },
      requestId: req.params.id,
      actor: { _id: req.user._id, name: req.user.name },
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/supply/area-requests/:id/reject', webAuth('jhatka_supply_write'), validate(V.idParam), validate(V.areaReasonBody), async (req, res, next) => {
  try {
    const result = await areaService.rejectAreaRequest({
      models: { JhatkaAreaChangeRequest: require('../../../models').JhatkaAreaChangeRequest },
      requestId: req.params.id,
      actor: { _id: req.user._id, name: req.user.name },
      reason: req.body?.reason || 'Rejected',
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
