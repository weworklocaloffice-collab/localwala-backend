const express = require('express');
const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const webAuth = require('../../../middlewares/webAuth');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.customer.validation');

const invoiceService = require('../services/jhatka.invoice.service');
const JhatkaOrder = require('../models/jhatka.order.model');

const router = express.Router();

/**
 * GET /v1/jhatka/admin/invoices/:order
 * Read the frozen invoice (or null) for an order. Admin/finance surface.
 */
router.get('/invoices/:order', webAuth('jhatka_settlement_write'), validate(V.orderParam), async (req, res, next) => {
  try {
    const order = await JhatkaOrder.findById(req.params.order);
    if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
    return res.json({ invoice: order.invoice || null });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/invoices/:order/void
 * Void an issued invoice and issue a credit note. Finance/accounting act.
 * Does NOT touch the order lifecycle (admin orders route stays read-only).
 */
router.post('/invoices/:order/void', webAuth('jhatka_settlement_write'), validate(V.orderParam), async (req, res, next) => {
  try {
    const reason = req.body?.reason;
    const result = await invoiceService.voidInvoice(req.params.order, reason, req.user?._id);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
