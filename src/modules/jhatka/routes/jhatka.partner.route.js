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
 * jhatka.routes.partner.js — the six partner-facing routes. Phase 1j.
 *
 * Every route:
 *   - scopes to the caller's permitted outlets via profileService
 *   - returns only data the caller MAY see (no cross-outlet leakage)
 *   - uses jhatkaScope for picker/switch/scope routes, jhatkaAuth for mutating ones
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { jhatkaScope, jhatkaAuth, requireActiveOutlet, requireComplianceCurrent } = require('../middlewares/jhatka.tenant');
const profileService = require('../services/jhatka.profile.service');
const {
  JhatkaOutlet,
  JhatkaCompliance,
  JhatkaSubscription,
  JhatkaOrder,
  JhatkaDriver,
  JhatkaDelivery,
  JhatkaDeliveryPOD,
  JhatkaPriceOverride,
  JhatkaVariant,
} = require('../../../models');
const {
  JhatkaWastage,
  JhatkaRecurringOrder,
  JhatkaInventoryItem,
} = require('../../../models');
const analyticsService = require('../services/jhatka.analytics.service');
const dispatchService = require('../services/jhatka.dispatch.service');
const priceOverrideService = require('../services/jhatka.price-override.service');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.partner.validation');

const router = express.Router();

/**
 * POST /jhatka/partner/outlets
 *
 * The picker. Lists every outlet the caller MAY reach, with the minimal data the
 * UI needs to show a card: id, name, status, lastActive.
 *
 * Uses jhatkaScope because the caller has NO active outlet yet — they are picking
 * one. jhatkaScope populates req.permittedOutletIds and does NOT set req.outletId.
 */
router.post('/outlets', jhatkaScope(), async (req, res, next) => {
  try {
    const outlets = await JhatkaOutlet.find({
      _id: { $in: req.permittedOutletIds },
    })
      .select('_id name status lastActiveOutletId updatedAt')
      .lean();

    const now = new Date();
     
    const { deriveComplianceStatus } = require('../utils/compliance.arithmetic');
    const Compliance = require('../../../models').JhatkaCompliance;

    const complianceByOutlet = await Compliance.find({ outlet: { $in: req.permittedOutletIds } })
      .select('outlet fssai')
      .lean()
      .then((arr) => arr.reduce((m, c) => {
        m[String(c.outlet)] = c.fssai;
        return m;
      }, {}));

    const data = outlets.map((o) => {
      const fssai = complianceByOutlet[String(o._id)];
      let complianceStatus = 'missing';
      if (fssai) {
         
        const { deriveComplianceStatus } = require('../utils/compliance.arithmetic');
        complianceStatus = deriveComplianceStatus(fssai, now, 30);
      }
      return {
        id: String(o._id),
        name: o.name,
        status: o.status,
        lastActive: o.lastActiveOutletId ? String(o.lastActiveOutletId) : null,
        compliance: complianceStatus,
      };
    });

    res.json({ outlets: data });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /jhatka/partner/session/outlet
 *
 * Switch the active outlet. The body carries { outletId }.
 *
 * Validation:
 *   - outletId must be in the caller's permittedOutletIds (enforced by
 *     resolveActorOutlet in jhatkaAuth)
 *   - outlet must exist and not be 'draft' or 'archived'
 *   - if outlet is 'suspended', the caller must be an owner/manager
 *
 * Uses jhatkaAuth so the token + hint resolve to a concrete outlet. The service
 * already checks scope; we just need to ensure the outlet is operable for the
 * caller's role.
 */
router.post('/session/outlet', jhatkaAuth(), validate(V.sessionOutletBody), async (req, res, next) => {
  try {
    const { outletId } = req.body;
    if (!outletId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'outletId is required');
    }

    // The hint is validated inside resolveActorOutlet via the service. If we got
    // here, req.outletId === outletId and req.outlet is the document.
    if (!req.outlet) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Outlet not found or not in your scope');
    }

    if (req.outlet.status === 'draft' || req.outlet.status === 'archived') {
      throw new ApiError(httpStatus.FORBIDDEN, `This outlet is ${req.outlet.status}`);
    }

    // Non-owner/manager cannot switch into a suspended outlet (they cannot
    // perform fulfilment there). An owner/manager may — they might be fixing it.
    if (req.outlet.status === 'suspended' && !['owner', 'manager'].includes(req.role)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'This outlet is suspended');
    }

    // Update the assignment's lastActiveOutletId so the next login opens here.
    if (req.assignment && req.assignment.lastActiveOutletId !== req.outlet._id) {
      req.assignment.lastActiveOutletId = req.outlet._id;
      await req.assignment.save();
    }

    // Update the outlet's own lastActiveOutletId for the partner-level picker.
    if (req.outlet.lastActiveOutletId !== req.user._id) {
      // JhatkaOutlet doesn't have a field for "who last opened me" — that lives
      // on the assignment. Outlet.lastActiveOutletId is the outletId that was
      // last active FOR THIS USER (via the assignment). We already updated it above.
    }

    res.json({
      outlet: {
        id: String(req.outlet._id),
        name: req.outlet.name,
        status: req.outlet.status,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/scope
 *
 * Full scope map for the UI. Returns:
 *   - permittedOutletIds[]
 *   - role
 *   - groups[] (outlet→role pairs)
 *   - isDriver / driver object
 *
 * Uses jhatkaScope (no outlet required).
 */
router.get('/scope', jhatkaScope(), async (req, res, next) => {
  try {
    const scope = await profileService.resolveActorScope(req.user._id);
    res.json({
      permittedOutletIds: (scope.permittedOutletIds || []).map(String),
      role: scope.role,
      groups: (scope.groups || []).map((g) => ({
        outletId: String(g.outletId),
        role: g.role,
        isPrimary: g.isPrimary,
      })),
      isDriver: scope.isDriver === true,
      driver: scope.driver ? {
        id: String(scope.driver._id),
        name: scope.driver.name,
        phone: scope.driver.phone,
        vehicle: scope.driver.vehicle,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/subscription-list
 *
 * The customer's view across outlets. Lists subscriptions the customer owns that
 * are active and have at least one outlet in the caller's scope.
 *
 * Uses jhatkaScope (no outlet required).
 */
/**
 * GET /jhatka/partner/subscription-list
 *
 * Subscriptions AT THIS OUTLET.
 *
 * The previous version queried `customer: req.user._id` with `'outlets.0': { $in:
 * req.permittedOutletIds }` and projected `planCode`, `cycleAnchorDay` and
 * `timezone`. None of those fields exist on `JhatkaSubscription`: it has ONE
 * `outlet` ref (not `outlets[]`), and scheduling is `scheduleType` +
 * `nextOccurrenceDate`, with no plan code and no timezone column.
 *
 * The query was also backwards for this surface. This is the PARTNER app — a
 * staff member asking "which subscriptions do I fulfil here?" — so it must be
 * scoped by outlet. Scoping by `customer` returned the subscriptions belonging to
 * whoever happened to be logged in, which for a staff session is usually none.
 *
 * Uses jhatkaScope (no outlet required): a manager may hold several outlets and
 * wants the list across all of them, which is what `permittedOutletIds` is for.
 */
router.get('/subscription-list', jhatkaScope(), async (req, res, next) => {
  try {
    const subs = await JhatkaSubscription.find({
      outlet: { $in: req.permittedOutletIds },
      status: { $in: ['active', 'paused', 'payment_failed'] },
    })
      .select('_id subscriptionNo customer outlet status scheduleType intervalCount deliverySlot paymentMode estimatedAmountPerOccurrence nextOccurrenceDate lastOccurrenceDate stats createdAt')
      .lean();

    return res.json({
      subscriptions: subs.map((s) => ({
        id: String(s._id),
        subscriptionNo: s.subscriptionNo,
        customer: s.customer ? String(s.customer) : null,
        outlet: String(s.outlet),
        status: s.status,
        scheduleType: s.scheduleType,
        intervalCount: s.intervalCount,
        deliverySlot: s.deliverySlot,
        paymentMode: s.paymentMode,
        estimatedAmountPerOccurrence: s.estimatedAmountPerOccurrence,
        nextOccurrenceDate: s.nextOccurrenceDate,
        lastOccurrenceDate: s.lastOccurrenceDate,
        consecutiveStockFailures: s.stats?.consecutiveStockFailures ?? 0,
        willAutoPause:
          s.status === 'active' && (s.stats?.consecutiveStockFailures ?? 0) >= 2,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/partner/compliance
 *
 * This outlet's compliance surface. Returns the FSSAI record plus derived status.
 *
 * Uses jhatkaAuth so we have an outlet; requires compliance current for mutating
 * routes but this is read-only so we just return the status.
 */
router.get('/compliance', jhatkaAuth(), async (req, res, next) => {
  try {
    if (!req.outletId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'This route requires an outlet session');
    }

    const compliance = await JhatkaCompliance.findOne({ outlet: req.outletId }).lean();
    if (!compliance) {
      return res.json({
        outletId: req.outletId,
        fssai: null,
        status: 'missing',
        statusLabel: 'No FSSAI record on file',
        expiresAt: null,
        daysUntilExpiry: null,
      });
    }

     
    const { deriveComplianceStatus } = require('../utils/compliance.arithmetic');
    const now = new Date();
    const status = deriveComplianceStatus(compliance.fssai, now, 30);

    let statusLabel = status;
    if (status === 'expiring') {
      const days = Math.ceil((new Date(compliance.fssai.expiresAt) - now) / 86400000);
      statusLabel = `Expires in ${days} day${days === 1 ? '' : 's'}`;
    } else if (status === 'valid') {
      statusLabel = 'Valid';
    } else if (status === 'pending') {
      statusLabel = 'Submitted, awaiting approval';
    } else if (status === 'expired') {
      statusLabel = 'Expired';
    } else if (status === 'revoked') {
      statusLabel = 'Revoked';
    }

    res.json({
      outletId: req.outletId,
      fssai: compliance.fssai ? {
        licenceNumber: compliance.fssai.licenceNumber,
        expiresAt: compliance.fssai.expiresAt,
        documentUrl: compliance.fssai.documentUrl,
      } : null,
      status,
      statusLabel,
      expiresAt: compliance.fssai?.expiresAt || null,
      daysUntilExpiry: compliance.fssai?.expiresAt
        ? Math.ceil((new Date(compliance.fssai.expiresAt) - now) / 86400000)
        : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/analytics
 *
 * Outlet dashboard summary for [from, to). B9: the Partner dashboard and the
 * admin panel both need these numbers and neither can compute them client-side.
 * Read-only; money summed in the service from moneyField getters (§0.0, F-9).
 *
 * Uses jhatkaAuth + requireActiveOutlet so the outlet is resolved server-side.
 */
router.get('/analytics', jhatkaAuth(), requireActiveOutlet, validate(V.analyticsQuery), async (req, res, next) => {
  try {
    const result = await analyticsService.outletSummary({
      models: {
        JhatkaOrder,
        JhatkaWastage,
        JhatkaSubscription,
        JhatkaRecurringOrder,
        JhatkaInventoryItem,
      },
      outletId: req.outletId,
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/partner/drivers
 *
 * Outlet riders for the dispatch picker. Eligibility mirrors the dispatch
 * guards (outlet-owned, active, not blocked); ineligible riders list with
 * the reason rather than vanishing.
 *
 * Uses jhatkaAuth + requireActiveOutlet so the outlet is resolved server-side.
 */
router.get('/drivers', jhatkaAuth(), requireActiveOutlet, async (req, res, next) => {
  try {
    const result = await dispatchService.listOutletDrivers({
      models: { JhatkaDriver },
      outletId: req.outletId,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /jhatka/partner/drivers/:driver
 *
 * Edit name, mobile, vehicle. Status moves through the transition below so
 * every change carries its reason; the outlet never changes.
 */
router.patch('/drivers/:driver', jhatkaAuth(), requireActiveOutlet, validate(V.driverParam), validate(V.driverUpdateBody), async (req, res, next) => {
  try {
    const result = await dispatchService.updateDriver({
      models: { JhatkaDriver },
      outletId: req.outletId,
      driver: req.params.driver,
      body: req.body,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/drivers/:driver/status
 *
 * Body: { status: active|inactive|suspended, reason? }. Never deleted
 * (BR-24). A blocked rider cannot be reactivated here.
 */
router.post('/drivers/:driver/status', jhatkaAuth(), requireActiveOutlet, validate(V.driverParam), validate(V.driverStatusBody), async (req, res, next) => {
  try {
    const result = await dispatchService.setDriverStatus({
      models: { JhatkaDriver },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      driver: req.params.driver,
      status: req.body?.status,
      reason: req.body?.reason,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/partner/deliveries
 *
 * Outlet deliveries, newest first. `?active=true` narrows to in-flight
 * states. Partner-side mirror of the rider's own list, scoped by outlet.
 */
router.get('/deliveries', jhatkaAuth(), requireActiveOutlet, validate(V.deliveryListQuery), async (req, res, next) => {
  try {
    const result = await dispatchService.listOutletDeliveries({
      models: { JhatkaDelivery },
      outletId: req.outletId,
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/partner/deliveries/:delivery
 *
 * One delivery with its order lines and POD, outlet-scoped.
 */
router.get('/deliveries/:delivery', jhatkaAuth(), requireActiveOutlet, validate(V.deliveryParam), async (req, res, next) => {
  try {
    const result = await dispatchService.getOutletDelivery({
      models: { JhatkaDelivery, JhatkaOrder, JhatkaDeliveryPOD },
      outletId: req.outletId,
      delivery: req.params.delivery,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/partner/price-overrides
 *
 * Outlet price overrides, newest first. Variance and force flags are computed
 * live so the console can show what needs a second approver at a glance.
 */
router.get('/price-overrides', jhatkaAuth(), requireActiveOutlet, async (req, res, next) => {
  try {
    const result = await priceOverrideService.listOverrides({
      models: { JhatkaPriceOverride },
      outletId: req.outletId,
      query: req.query,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/price-overrides
 *
 * Draft an override. Always starts `draft`: activation is the approve step,
 * so a wide variance can never slip live without a second pair of eyes.
 */
router.post('/price-overrides', jhatkaAuth(), requireActiveOutlet, validate(V.overrideBody), async (req, res, next) => {
  try {
    const result = await priceOverrideService.createOverride({
      models: { JhatkaPriceOverride, JhatkaVariant },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      body: req.body,
    });
    return res.status(httpStatus.CREATED).json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/price-overrides/:override/approve
 *
 * Owner/manager only, and beyond ±20% the approver must differ from the
 * creator. This is the control that stops one operator setting any price.
 */
router.post('/price-overrides/:override/approve', jhatkaAuth(), requireActiveOutlet, validate(V.overrideParam), async (req, res, next) => {
  try {
    const result = await priceOverrideService.approveOverride({
      models: { JhatkaPriceOverride },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      role: req.role,
      override: req.params.override,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/price-overrides/:override/revoke
 *
 * The row stays for the price audit; only its status moves.
 */
router.post('/price-overrides/:override/revoke', jhatkaAuth(), requireActiveOutlet, validate(V.overrideParam), validate(V.revokeBody), async (req, res, next) => {
  try {
    const result = await priceOverrideService.revokeOverride({
      models: { JhatkaPriceOverride },
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      role: req.role,
      override: req.params.override,
      revokeReason: req.body?.revokeReason,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/partner/health
 *
 * Liveness + outlet status. Used by the app to know if the outlet can accept
 * new work right now.
 *
 * Uses jhatkaAuth so we have an outlet.
 */
router.get('/health', jhatkaAuth(), async (req, res, next) => {
  try {
    if (!req.outlet) {
      return res.json({
        alive: true,
        outlet: null,
        canAcceptNewWork: false,
        reason: 'no outlet session',
      });
    }

    const capabilities = req.outlet.capabilities
      ? req.outlet.capabilities()
      : { acceptNewOrders: req.outlet.status === 'active' };

     
    const { deriveComplianceStatus } = require('../utils/compliance.arithmetic');
    const Compliance = require('../../../models').JhatkaCompliance;
    const compliance = await Compliance.findOne({ outlet: req.outletId }).lean();
    let complianceStatus = 'missing';
    if (compliance?.fssai) {
      complianceStatus = deriveComplianceStatus(compliance.fssai, new Date(), 30);
    }

    res.json({
      alive: true,
      outlet: {
        id: req.outletId,
        name: req.outlet.name,
        status: req.outlet.status,
      },
      canAcceptNewWork: capabilities.acceptNewOrders === true,
      compliance: complianceStatus,
    });
  } catch (error) {
    next(error);
  }
});


/**
 * GET /jhatka/partner/customers/search?q=
 *
 * Find a customer to subscribe on behalf of. Scoped to customers with at least
 * one order at THIS outlet — a partner may not enumerate platform users they
 * have never served. That scoping is the privacy model, not an optimization:
 * without it this endpoint is a user directory behind a partner login.
 *
 * Requires 2+ characters (an empty query is a dump, not a search) and caps at
 * 20 rows. Matches name or phone substring, case-insensitive. Phone is returned
 * in full — the outlet already has the relationship, having delivered to them —
 * but nothing else about the user leaks: no email, no addresses, no other
 * outlets' orders.
 */
router.get('/customers/search', jhatkaAuth(), requireActiveOutlet, validate(V.customerSearchQuery), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Search needs at least 2 characters');
    }
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\module.exports = router;');
    const match = new RegExp(escaped, 'i');

    // Outlet's customers first: distinct user ids with an order here. The $in
    // keeps the User query bounded no matter how large the platform grows.
    const outletCustomerIds = await JhatkaOrder.distinct('customer', { outlet: req.outletId });
    if (!outletCustomerIds.length) {
      return res.json({ customers: [] });
    }

    // firstName/lastName/mobile — verified against the live User schema, which
    // has no `name` or `phone` fields. Querying those would match nothing
    // on every request while looking correct in review.
    const { User } = require('../../../models');
    const users = await User.find({
      _id: { $in: outletCustomerIds },
      $or: [{ firstName: match }, { lastName: match }, { mobile: match }],
    })
      .select('_id firstName lastName mobile')
      .limit(20)
      .lean();

    return res.json({
      customers: users.map((u) => ({
        id: String(u._id),
        name: [u.firstName, u.lastName].filter(Boolean).join(' ') || '—',
        phone: u.mobile || '',
      })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;