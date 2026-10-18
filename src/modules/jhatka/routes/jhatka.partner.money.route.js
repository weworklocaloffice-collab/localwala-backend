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
const profileService = require('../services/jhatka.profile.service');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.partner.money.validation');
const { JhatkaCommissionRule, JhatkaOperatorPayout, JhatkaSupplierPayable, JhatkaSettlement, JhatkaOrder, JhatkaDelivery, JhatkaDriver, JhatkaOutlet } = require('../../../models');
const { computeRefund } = require('../utils/commercial.arithmetic');

const router = express.Router();

const moneyAuth = [jhatkaAuth(), requireActiveOutlet];

/**
 * GET /jhatka/partner/commission-rules
 *
 * Commission rules for this outlet's business.
 */
router.get('/commission-rules', moneyAuth, requireRole('manager', 'owner'), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.outletId).select('business').lean();
    if (!outlet) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
    }

    const rules = await JhatkaCommissionRule.find({ business: outlet.business })
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    res.json({
      commissionRules: rules.map((r) => ({
        ...r,
        id: String(r._id),
        business: String(r.business),
        outlet: r.outlet ? String(r.outlet) : null,
        variant: r.variant ? String(r.variant) : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /jhatka/partner/commission-rules
 *
 * Create a commission rule.
 * Body: { type, rateBps, minOrderValuePaise, maxOrderValuePaise, outlet, variant, priority, validFrom, validUntil, description }
 * Role: owner only
 */
router.post('/commission-rules', moneyAuth, requireRole('owner'), validate(V.commissionRuleBody), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.outletId).select('business').lean();
    if (!outlet) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
    }

    const { type, rateBps, minOrderValuePaise, maxOrderValuePaise, outlet: ruleOutlet, variant, priority, validFrom, validUntil, description } = req.body;

    if (!type || rateBps === undefined) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'type and rateBps required');
    }

    // Validate outlet if provided
    if (ruleOutlet) {
      const o = await JhatkaOutlet.findById(ruleOutlet);
      if (!o || String(o.business) !== String(outlet.business)) {
        throw new ApiError(httpStatus.FORBIDDEN, 'Outlet not in your business');
      }
    }

    const rule = new JhatkaCommissionRule({
      business: outlet.business,
      type,
      rateBps: Number(rateBps),
      minOrderValuePaise: Number(minOrderValuePaise || 0),
      maxOrderValuePaise: maxOrderValuePaise ? Number(maxOrderValuePaise) : null,
      outlet: ruleOutlet || null,
      variant: variant || null,
      priority: Number(priority || 0),
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validUntil: validUntil ? new Date(validUntil) : null,
      description,
      createdBy: req.user._id,
    });
    await rule.save();

    res.status(httpStatus.CREATED).json({
      commissionRule: { id: String(rule._id), type: rule.type, rateBps: rule.rateBps },
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

/**
 * POST /jhatka/partner/payouts/generate
 *
 * Generate payouts for a period.
 * Body: { periodStart, periodEnd, driverIds? }
 * Role: owner only
 */
router.post('/payouts/generate', moneyAuth, requireRole('owner'), validate(V.payoutGenerateBody), async (req, res, next) => {
  try {
    const { periodStart, periodEnd, driverIds } = req.body;

    if (!periodStart || !periodEnd) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'periodStart and periodEnd required');
    }

    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    // Get drivers for this outlet
    let drivers = await JhatkaDriver.find({
      outlet: req.outletId,
      status: { $in: ['active', 'on_delivery'] },
    }).select('_id name phone vehicle').lean();

    if (driverIds && driverIds.length) {
      drivers = drivers.filter((d) => driverIds.includes(String(d._id)));
    }

    const generated = [];

    for (const driver of drivers) {
      // Find completed deliveries in period
      const deliveries = await JhatkaDelivery.find({
        driver: driver._id,
        status: 'delivered',
        deliveredAt: { $gte: start, $lte: end },
      }).populate('order').lean();

      if (!deliveries.length) continue;

      let grossEarningsPaise = 0;
      const items = [];

      for (const d of deliveries) {
        const commission = d.order.payment.driverCommissionPaise || 0;
        grossEarningsPaise += commission;
        items.push({
          delivery: d._id,
          order: d.order._id,
          commissionPaise: commission,
        });
      }

      // Platform fee (from commission rules or default 10%)
      const platformFeeBps = 1000; // 10% default
      const platformFeePaise = Math.round(grossEarningsPaise * platformFeeBps / 10000);
      const netPayablePaise = grossEarningsPaise - platformFeePaise;

      const payout = new JhatkaOperatorPayout({
        outlet: req.outletId,
        driver: driver._id,
        periodStart: start,
        periodEnd: end,
        grossEarningsPaise,
        platformFeePaise,
        netPayablePaise,
        items,
        status: 'pending',
        generatedBy: req.user._id,
      });
      await payout.save();
      generated.push(payout);
    }

    res.status(httpStatus.CREATED).json({
      payouts: generated.map((p) => ({
        id: String(p._id),
        driver: String(p.driver),
        grossEarningsPaise: p.grossEarningsPaise,
        platformFeePaise: p.platformFeePaise,
        netPayablePaise: p.netPayablePaise,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /jhatka/partner/payouts/:id/pay
 *
 * Mark payout as paid.
 * Body: { paymentReference, notes }
 * Role: owner only
 */
router.post('/payouts/:id/pay', moneyAuth, requireRole('owner'), validate(V.idParam), validate(V.payBody), async (req, res, next) => {
  try {
    const payout = await JhatkaOperatorPayout.findById(req.params.id);
    if (!payout) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Payout not found');
    }
    if (String(payout.outlet) !== req.outletId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Payout not in this outlet');
    }
    if (payout.status === 'paid') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Payout already paid');
    }

    const { paymentReference, notes } = req.body;

    payout.status = 'paid';
    payout.paidAt = new Date();
    payout.paidBy = req.user._id;
    payout.paymentReference = paymentReference;
    payout.notes = notes;
    await payout.save();

    // Update driver
    await JhatkaDriver.findByIdAndUpdate(payout.driver, {
      $inc: { totalEarningsPaidPaise: payout.netPayablePaise },
    });

    res.json({ payout: { id: String(payout._id), status: payout.status, paidAt: payout.paidAt } });
  } catch (error) {
    next(error);
  }
});

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