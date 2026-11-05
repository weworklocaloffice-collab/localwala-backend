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
 * jhatka.routes.partner.money.js — payouts, commissions, payables. Phase 1j.
 *
 * All routes:
 *   - jhatkaAuth (outlet resolved)
 *   - requireActiveOutlet
 *   - role: owner for payouts, manager/owner for commissions, inventory_staff/manager/owner for payables
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { jhatkaAuth, requireActiveOutlet, requireRole } = require('../middlewares/jhatka.tenant');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.partner.money.validation');
const { JhatkaCommissionRule, JhatkaOperatorPayout, JhatkaSupplierPayable, JhatkaSettlement, JhatkaOutlet } = require('../../../models');

const router = express.Router();

const moneyAuth = [jhatkaAuth(), requireActiveOutlet];

/**
 * GET /jhatka/partner/commission-terms — the terms THIS outlet operates under.
 *
 * ## What happened to the old commission-rules endpoints here
 *
 * This file used to carry GET + POST `/commission-rules` — a partner-facing
 * WRITE path for commission rules. Both were dead: the POST wrote a field
 * vocabulary (`type`, `rateBps`, `priority`, `validFrom`) that
 * `JhatkaCommissionRule` does not define, against a required `code` it never
 * set — every call died in validation (500); the GET queried a `business`
 * field that does not exist, so it always returned empty. Worst of all, they
 * ADVERTISED authority partners do not have: commission is a commercial term
 * set by LocalWala's admin (`/v1/jhatka/admin/settlements/commission-rules`),
 * never by the partner whose payout it governs.
 *
 * Replaced by this read-only view of the outlet's own effective terms, read
 * from the partner-side ledger of truth: the admin rules table (by business
 * model) for the rate structure, plus the latest payout's frozen ruleSnapshot.
 */
router.get('/commission-terms', moneyAuth, requireRole('manager', 'owner'), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.outletId).lean();
    if (!outlet) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
    }

    const payoutModel = outlet.businessModel === 'franchise' ? 'franchise' : 'commission_partner';
    const activeRule = await JhatkaCommissionRule.findOne({
      businessModel: payoutModel,
      status: 'active',
    })
      .sort({ effectiveFrom: -1 })
      .lean();

    const lastPayout = await JhatkaOperatorPayout.findOne({ outlet: req.outletId })
      .sort({ createdAt: -1 })
      .select('ruleSnapshot period status')
      .lean();

    return res.json({
      businessModel: payoutModel,
      activeRule: activeRule
        ? {
            code: activeRule.code,
            name: activeRule.name,
            basis: activeRule.basis,
            platformFeePercent: activeRule.platformFeePercent,
            ratePercent: activeRule.ratePercent,
            effectiveFrom: activeRule.effectiveFrom,
          }
        : null,
      lastAppliedSnapshot: lastPayout?.ruleSnapshot || null,
      lastPayoutPeriod: lastPayout?.period || null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/payouts
 *
 * Operator payouts for this outlet.
 */
router.get('/payouts', moneyAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const { status, fromDate, toDate, page = 1, limit = 50 } = req.query;

    const match = { outlet: req.outletId };
    if (status) match.status = status;
    if (fromDate || toDate) {
      match.periodStart = {};
      if (fromDate) match.periodStart.$gte = new Date(fromDate);
      if (toDate) match.periodStart.$lte = new Date(toDate);
    }

    const payouts = await JhatkaOperatorPayout.find(match)
      .populate('driver', 'name phone')
      .sort({ periodStart: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      payouts: payouts.map((p) => ({
        ...p,
        id: String(p._id),
        outlet: String(p.outlet),
        driver: p.driver ? { ...p.driver, id: String(p.driver._id) } : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/payouts/:id
 *
 * Single payout detail.
 */
router.get('/payouts/:id', moneyAuth, requireRole('owner'), validate(V.idParam), async (req, res, next) => {
  try {
    const payout = await JhatkaOperatorPayout.findById(req.params.id)
      .populate('driver', 'name phone vehicle')
      .populate('items.delivery', 'order status')
      .populate('items.order', 'customer finalTotalPaise')
      .lean();

    if (!payout) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Payout not found');
    }
    if (String(payout.outlet) !== req.outletId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Payout not in this outlet');
    }

    res.json({
      payout: {
        ...payout,
        id: String(payout._id),
        outlet: String(payout.outlet),
        driver: payout.driver ? { ...payout.driver, id: String(payout.driver._id) } : null,
        items: payout.items.map((i) => ({
          ...i,
          delivery: i.delivery ? { ...i.delivery, id: String(i.delivery._id) } : null,
          order: i.order ? { ...i.order, id: String(i.order._id) } : null,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Operator payouts are generated and settled by LocalWala finance. The old
// partner `/payouts/generate` and `/payouts/:id/pay` endpoints wrote the wrong
// document shape (`driver`, `pending`, per-driver earnings) and let the payee
// settle its own statement. They were removed rather than left as a second,
// unaudited money path.

/**
 * GET /jhatka/partner/payables
 *
 * Supplier payables for this outlet's business.
 */
router.get('/payables', moneyAuth, requireRole('inventory_staff', 'manager', 'owner'), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.outletId).select('business').lean();
    if (!outlet) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
    }

    const { status, supplier, fromDate, toDate, page = 1, limit = 50 } = req.query;

    const match = { business: outlet.business };
    if (status) match.status = status;
    if (supplier) match.supplier = supplier;
    if (fromDate || toDate) {
      match.invoiceDate = {};
      if (fromDate) match.invoiceDate.$gte = new Date(fromDate);
      if (toDate) match.invoiceDate.$lte = new Date(toDate);
    }

    const payables = await JhatkaSupplierPayable.find(match)
      .populate('supplier', 'name code')
      .populate('receipt', 'receivedAt status')
      .sort({ invoiceDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      payables: payables.map((p) => ({
        ...p,
        id: String(p._id),
        business: String(p.business),
        supplier: p.supplier ? { ...p.supplier, id: String(p.supplier._id) } : null,
        receipt: p.receipt ? { ...p.receipt, id: String(p.receipt._id) } : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /jhatka/partner/payables/:id/pay
 *
 * Mark payable as paid.
 * Body: { paymentReference, paidAmountPaise, notes }
 * Role: owner only
 */
router.post('/payables/:id/pay', moneyAuth, requireRole('owner'), validate(V.idParam), validate(V.payBody), async (req, res, next) => {
  try {
    const payable = await JhatkaSupplierPayable.findById(req.params.id);
    if (!payable) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Payable not found');
    }
    if (String(payable.business) !== String((await JhatkaOutlet.findById(req.outletId).select('business').lean()).business)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Payable not in your business');
    }
    if (payable.status === 'paid') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Payable already paid');
    }

    const { paymentReference, paidAmountPaise, notes } = req.body;
    const payAmount = Number(paidAmountPaise || payable.amountPaise);

    if (payAmount > payable.amountPaise - payable.paidPaise) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Payment exceeds outstanding amount');
    }

    payable.paidPaise += payAmount;
    payable.status = payable.paidPaise >= payable.amountPaise ? 'paid' : 'partially_paid';
    payable.payments.push({
      amountPaise: payAmount,
      paymentReference,
      paidAt: new Date(),
      paidBy: req.user._id,
      notes,
    });
    if (payable.status === 'paid') {
      payable.paidAt = new Date();
      payable.paidBy = req.user._id;
    }
    await payable.save();

    res.json({
      payable: {
        id: String(payable._id),
        status: payable.status,
        paidPaise: payable.paidPaise,
        outstandingPaise: payable.amountPaise - payable.paidPaise,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/settlements
 *
 * Daily settlements for this outlet.
 */
router.get('/settlements', moneyAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const { fromDate, toDate, page = 1, limit = 50 } = req.query;

    const match = { outlet: req.outletId };
    if (fromDate || toDate) {
      match.date = {};
      if (fromDate) match.date.$gte = new Date(fromDate);
      if (toDate) match.date.$lte = new Date(toDate);
    }

    const settlements = await JhatkaSettlement.find(match)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      settlements: settlements.map((s) => ({
        ...s,
        id: String(s._id),
        outlet: String(s.outlet),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/settlements/summary
 *
 * Settlement summary for a period.
 */
router.get('/settlements/summary', moneyAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const { fromDate, toDate } = req.query;
    if (!fromDate || !toDate) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'fromDate and toDate required');
    }

    const match = {
      outlet: req.outletId,
      date: { $gte: new Date(fromDate), $lte: new Date(toDate) },
    };

    const summary = await JhatkaSettlement.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: '$totalOrders' },
          totalRevenuePaise: { $sum: '$totalRevenuePaise' },
          totalCommissionPaise: { $sum: '$totalCommissionPaise' },
          totalRefundsPaise: { $sum: '$totalRefundsPaise' },
          totalWastagePaise: { $sum: '$totalWastagePaise' },
          netRevenuePaise: { $sum: '$netRevenuePaise' },
          count: { $sum: 1 },
        },
      },
    ]);

    res.json({
      summary: summary[0] || {
        totalOrders: 0,
        totalRevenuePaise: 0,
        totalCommissionPaise: 0,
        totalRefundsPaise: 0,
        totalWastagePaise: 0,
        netRevenuePaise: 0,
        count: 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;