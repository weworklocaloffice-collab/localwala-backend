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
 * jhatka.admin.outlets.route.js — B1.2
 *
 * Admin CRUD for outlets, partners and franchise agreements.
 *
 * ## Schema verified, not assumed
 *
 * Written against `docs/JHATKA-ADMIN-SCHEMA-SURVEY.md`, which is generated from the
 * live Mongoose schemas. That file exists because the first taxonomy route took three
 * attempts, each built on confidently wrong field names. The specifics that matter here:
 *
 *   required : outletCode, business, businessModel, name, address.line1, city
 *   status   : draft | pending_approval | active | suspended | closed   (an ENUM, unlike
 *              JhatkaCategory/Variant/Product where `status` is a BOOLEAN)
 *   city     : a TOP-LEVEL required ObjectId ref to `City` — NOT `address.city`, and
 *              not a city name string. Writing it inside `address` produces
 *              "city: Path `city` is required" with nothing pointing at the real cause.
 *
 * ## Why these fields are guarded
 *
 * `status: 'active'` is what makes a shop visible in browse. `taxIdentity.fssai` is what
 * makes it legal to sell meat. `serviceArea.radiusKm` is what decides whether a
 * customer is told there is a shop nearby. All three are edited here by an admin with
 * no second pair of eyes, which is why each gets an explicit note rather than a silent
 * write.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const webAuth = require('../../../middlewares/webAuth');
const { JhatkaOutlet, JhatkaPartner, JhatkaFranchise, JhatkaCompliance } = require('../../../models');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');

const OUTLET_STATUS = ['draft', 'pending_approval', 'active', 'suspended', 'closed'];
const BUSINESS_MODEL = ['direct', 'franchise', 'commission_partner'];

/** Transition map. A closed shop does not reopen as `active` without a fresh approval. */
const OUTLET_TRANSITIONS = {
  draft: ['pending_approval', 'closed'],
  pending_approval: ['active', 'closed', 'draft'],
  active: ['suspended', 'closed'],
  suspended: ['active', 'closed'],
  closed: [],
};

/**
 * GET /v1/jhatka/admin/outlets
 *
 * The admin's outlet list. Filterable by status, model and city — an operator working
 * one territory needs to filter by it.
 */
router.get('/outlets', webAuth('jhatka_catalog_read'), async (req, res, next) => {
  try {
    const { status, businessModel, city, search, page = 1, limit = 50 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (businessModel) query.businessModel = businessModel;
    if (city) query.city = city;
    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [{ name: new RegExp(safe, 'i') }, { outletCode: new RegExp(safe, 'i') }];
    }

    const [outlets, total] = await Promise.all([
      JhatkaOutlet.find(query)
        .populate('city', 'name state')
        .sort({ createdAt: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Math.min(200, Math.max(1, Number(limit))))
        .lean(),
      JhatkaOutlet.countDocuments(query),
    ]);

    return res.json({
      outlets,
      page: Number(page),
      limit: Number(limit),
      total,
      count: outlets.length,
    });
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/admin/outlets/:outlet */
router.get('/outlets/:outlet', webAuth('jhatka_catalog_read'), validate(V.namedParam('outlet')), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.params.outlet)
      .populate('city', 'name state')
      .populate('partner')
      .lean();

    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

    // Compliance alongside, because "is this shop legal to sell meat" is the first
    // question an operator asks and it is a different collection.
    const compliance = await JhatkaCompliance.find({ outlet: outlet._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ outlet, compliance });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/outlets
 *
 * Body: `{ outletCode, business, businessModel, name, address: { line1, city, ... } }`
 *
 * Created as `pending_approval`, NEVER `active`. An operator adding a shop has not
 * verified its FSSAI licence, its bank details or that it exists; activating it here
 * would put unverified meat in front of customers. Activation is a separate,
 * deliberate act.
 */
router.post('/outlets', webAuth('jhatka_catalog_write'), validate(V.outletBody), async (req, res, next) => {
  try {
    const { outletCode, business, businessModel, name, address, city, serviceArea, location } =
      req.body || {};

    for (const [field, label] of [
      ['outletCode', 'outletCode'], ['business', 'business'],
      ['businessModel', 'businessModel'], ['name', 'name'], ['city', 'city'],
    ]) {
      if (!req.body?.[field]) {
        throw new ApiError(httpStatus.BAD_REQUEST, `${label} is required`, true, '', {
          code: 'MISSING_REQUIRED_FIELD', field,
        });
      }
    }

    if (!BUSINESS_MODEL.includes(businessModel)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `businessModel must be one of ${BUSINESS_MODEL.join(' | ')}`,
        true, '', { code: 'INVALID_BUSINESS_MODEL', allowed: BUSINESS_MODEL, received: businessModel }
      );
    }

    // `address.line1` is required too, and is separate from the top-level `city`.
    if (!address?.line1) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'address.line1 is required', true, '', {
        code: 'MISSING_REQUIRED_FIELD', field: 'address.line1',
      });
    }

    const outlet = await JhatkaOutlet.create({
      outletCode: String(outletCode).toUpperCase().trim(),
      business,
      businessModel,
      name,
      address,
      // TOP-LEVEL, ref to `City`. See the note in the file docblock.
      city,
      location,
      serviceArea,
      // Never `active` on create. See the docblock.
      status: 'pending_approval',
    });

    return res.status(201).json({ outlet: outlet.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /v1/jhatka/admin/outlets/:outlet
 *
 * Status moves go through `OUTLET_TRANSITIONS`, so a closed outlet cannot be reopened
 * as `active` by accident — it has to come back through `pending_approval`. An operator
 * who closes a shop by mistake should not be able to undo it in one click, because the
 * shop may have closed for a compliance reason.
 */
router.patch('/outlets/:outlet', webAuth('jhatka_catalog_write'), validate(V.namedParam('outlet')), validate(V.outletBody), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.params.outlet);
    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

    const {
      name, address, location, serviceArea, territory, orderConfig, taxIdentity,
      operatingHours, status, statusReason, cancellationConfig, paymentConfig,
      driverPayoutMode, minDeliveryMinutes,
    } = req.body || {};

    if (status !== undefined && status !== outlet.status) {
      if (!OUTLET_STATUS.includes(status)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `status must be one of ${OUTLET_STATUS.join(' | ')}`,
          true, '', { code: 'INVALID_STATUS', allowed: OUTLET_STATUS, received: status }
        );
      }

      const allowed = OUTLET_TRANSITIONS[outlet.status] || [];
      if (!allowed.includes(status)) {
        throw new ApiError(
          httpStatus.CONFLICT,
          `An outlet cannot go from ${outlet.status} to ${status}`,
          true, '',
          { code: 'ILLEGAL_STATUS_TRANSITION', from: outlet.status, to: status, allowed }
        );
      }

      // Activating without a valid FSSAI licence would put unsellable meat on sale.
      // Refused with the reason rather than allowed and caught later by a cron.
      if (status === 'active') {
        const compliance = await JhatkaCompliance.findOne({
          outlet: outlet._id,
          'fssai.expiresAt': { $gt: new Date() },
        }).lean();
        if (!compliance) {
          throw new ApiError(
            httpStatus.CONFLICT,
            'Cannot activate: no valid (unexpired) FSSAI licence on file',
            true, '',
            { code: 'FSSAI_REQUIRED' }
          );
        }
      }

      outlet.status = status;
      outlet.statusReason = statusReason;
      if (status === 'suspended') outlet.suspensionReason = statusReason;
      if (status === 'active') outlet.activatedAt = new Date();
    }

    if (name !== undefined) outlet.name = name;
    if (address !== undefined) outlet.address = { ...(outlet.address || {}), ...address };
    if (location !== undefined) outlet.location = location;
    if (serviceArea !== undefined) outlet.serviceArea = { ...(outlet.serviceArea || {}), ...serviceArea };
    if (territory !== undefined) outlet.territory = territory;
    if (orderConfig !== undefined) outlet.orderConfig = { ...(outlet.orderConfig || {}), ...orderConfig };
    if (taxIdentity !== undefined) outlet.taxIdentity = { ...(outlet.taxIdentity || {}), ...taxIdentity };
    if (operatingHours !== undefined) outlet.operatingHours = operatingHours;
    if (cancellationConfig !== undefined) {
      outlet.cancellationConfig = { ...(outlet.cancellationConfig || {}), ...cancellationConfig };
    }
    if (paymentConfig !== undefined) {
      outlet.paymentConfig = { ...(outlet.paymentConfig || {}), ...paymentConfig };
    }
    if (driverPayoutMode !== undefined) outlet.driverPayoutMode = driverPayoutMode;
    if (minDeliveryMinutes !== undefined) outlet.minDeliveryMinutes = Number(minDeliveryMinutes);

    await outlet.save();
    return res.json({ outlet: outlet.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/partners
 *
 * Commission partners (-12). Separate from outlets because a partner may own several
 * outlets, and the payout/commission rules attach to the PARTNER, not the shop.
 */
router.get('/partners', webAuth('jhatka_commission_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;

    const partners = await JhatkaPartner.find(query)
      .populate('owner', 'name mobile email')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ partners, count: partners.length });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/partners
 *
 * `owner` is REQUIRED and is a `User` id — the person who receives money. Accepting a
 * display name here would create a partner nobody can pay.
 */
router.post('/partners', webAuth('jhatka_commission_write'), async (req, res, next) => {
  try {
    const { partnerCode, business, owner, name, settlementCycle, payoutMethod, creditTermDays } =
      req.body || {};

    for (const f of ['partnerCode', 'business', 'owner', 'name']) {
      if (!req.body?.[f]) {
        throw new ApiError(httpStatus.BAD_REQUEST, `${f} is required`, true, '', {
          code: 'MISSING_REQUIRED_FIELD', field: f,
        });
      }
    }

    const partner = await JhatkaPartner.create({
      partnerCode: String(partnerCode).toUpperCase().trim(),
      business,
      owner,
      name,
      settlementCycle: settlementCycle || 'monthly',
      payoutMethod: payoutMethod || 'bank',
      creditTermDays: creditTermDays === undefined ? undefined : Number(creditTermDays),
      // Never `active` on create — the payout destination has not been verified.
      status: 'pending',
    });

    return res.status(201).json({ partner: partner.toObject() });
  } catch (error) {
    return next(error);
  }
});

/** PATCH /v1/jhatka/admin/partners/:partner */
router.patch('/partners/:partner', webAuth('jhatka_commission_write'), validate(V.namedParam('partner')), async (req, res, next) => {
  try {
    const partner = await JhatkaPartner.findById(req.params.partner);
    if (!partner) throw new ApiError(httpStatus.NOT_FOUND, 'Partner not found');

    const { name, settlementCycle, payoutMethod, creditTermDays, commissionRule, status,
      statusReason, tdsApplicable, tdsRatePercent } = req.body || {};

    if (name !== undefined) partner.name = name;
    if (settlementCycle !== undefined) partner.settlementCycle = settlementCycle;
    if (payoutMethod !== undefined) partner.payoutMethod = payoutMethod;
    if (creditTermDays !== undefined) partner.creditTermDays = Number(creditTermDays);
    if (commissionRule !== undefined) partner.commissionRule = commissionRule;
    if (tdsApplicable !== undefined) partner.tdsApplicable = !!tdsApplicable;
    if (tdsRatePercent !== undefined) partner.tdsRatePercent = Number(tdsRatePercent);
    if (status !== undefined) {
      partner.status = status;
      partner.statusReason = statusReason;
      if (status === 'active') partner.activatedAt = new Date();
      if (status === 'terminated') partner.terminatedAt = new Date();
    }

    await partner.save();
    return res.json({ partner: partner.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/franchises
 *
 * -13.3. Present for completeness — this vertical's OPERATING model is the
 * commission partner; a franchise record exists so the model is populated when one is
 * ever used, and so an admin cannot create one by accident without seeing this.
 */
router.get('/franchises', webAuth('jhatka_commission_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;

    const franchises = await JhatkaFranchise.find(query)
      .populate('outlet', 'name outletCode')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ franchises, count: franchises.length });
  } catch (error) {
    return next(error);
  }
});

/** PATCH /v1/jhatka/admin/franchises/:franchise */
router.patch('/franchises/:franchise', webAuth('jhatka_commission_write'), validate(V.namedParam('franchise')), async (req, res, next) => {
  try {
    const franchise = await JhatkaFranchise.findById(req.params.franchise);
    if (!franchise) throw new ApiError(httpStatus.NOT_FOUND, 'Franchise not found');

    const { name, status, statusReason, revenueSharePercentage, supplyModel,
      procurementEnabled, royalty } = req.body || {};

    if (name !== undefined) franchise.name = name;
    if (status !== undefined) {
      franchise.status = status;
      franchise.statusReason = statusReason;
      if (status === 'terminated') franchise.terminatedAt = new Date();
    }
    if (revenueSharePercentage !== undefined) {
      franchise.revenueSharePercentage = Number(revenueSharePercentage);
    }
    if (supplyModel !== undefined) franchise.supplyModel = supplyModel;
    if (procurementEnabled !== undefined) franchise.procurementEnabled = !!procurementEnabled;
    if (royalty !== undefined) franchise.royalty = { ...(franchise.royalty || {}), ...royalty };

    await franchise.save();
    return res.json({ franchise: franchise.toObject() });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.OUTLET_STATUS = OUTLET_STATUS;
module.exports.OUTLET_TRANSITIONS = OUTLET_TRANSITIONS;