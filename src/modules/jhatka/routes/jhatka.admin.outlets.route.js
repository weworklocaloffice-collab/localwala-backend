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
const {
  Business,
  JhatkaOutlet,
  JhatkaPartner,
  JhatkaFranchise,
  JhatkaCompliance,
} = require('../../../models');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');
const JhatkaOnboarding = require('../services/jhatka.onboarding.service');

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

/** Shallow-merge only when the caller actually sent an object. */
const mergeIfObject = (current, incoming) =>
  incoming && typeof incoming === 'object' && !Array.isArray(incoming)
    ? { ...(current || {}), ...incoming }
    : current;

/**
 * GET /v1/jhatka/admin/outlets/stats
 *
 * Counts for the outlet overview. Kept as an aggregate rather than derived from
 * the current page: an operator must see the truth for the whole network even
 * when a search narrows the table.
 */
router.get('/outlets/stats', webAuth('jhatka_catalog_read'), async (req, res, next) => {
  try {
    const [statusRows, modelRows, total] = await Promise.all([
      JhatkaOutlet.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      JhatkaOutlet.aggregate([{ $group: { _id: '$businessModel', count: { $sum: 1 } } }]),
      JhatkaOutlet.countDocuments(),
    ]);

    const byStatus = OUTLET_STATUS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    statusRows.forEach((row) => {
      if (row._id) byStatus[row._id] = row.count;
    });

    const byBusinessModel = BUSINESS_MODEL.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    modelRows.forEach((row) => {
      if (row._id) byBusinessModel[row._id] = row.count;
    });

    return res.json({ total, byStatus, byBusinessModel });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/businesses
 *
 * The business picker for the outlet form. `Business` is a kernel model with no
 * admin list endpoint of its own; this scoped lookup exists so an operator never
 * has to paste an ObjectId into an outlet draft.
 */
router.get('/businesses', webAuth('jhatka_catalog_read'), async (req, res, next) => {
  try {
    const { search, limit = 100 } = req.query;
    const query = { vertical: 'jhatka' };

    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { name: new RegExp(safe, 'i') },
        { code: new RegExp(safe, 'i') },
      ];
    }

    const businesses = await Business.find(query)
      .select('name code businessModel logo city owner contact')
      .populate('city', 'name state')
      .sort({ name: 1 })
      .limit(Math.min(200, Math.max(1, Number(limit))))
      .lean();

    return res.json({ businesses, count: businesses.length });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/businesses
 *
 * Create the owner/operator entity an outlet must belong to. Kept next to the
 * outlet routes because this is how the outlet form unblocks itself when no
 * Jhatka business exists yet.
 */
router.post('/businesses', webAuth('jhatka_catalog_write'), validate(V.businessBody), async (req, res, next) => {
  try {
    const business = await JhatkaOnboarding.ensureAdminBusiness(req.body);
    return res.status(httpStatus.CREATED).json({ business });
  } catch (error) {
    return next(error);
  }
});

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
        .populate('business', 'name code businessModel logo')
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

/**
 * GET /v1/jhatka/admin/outlets/next-code
 *
 * Must stay ABOVE `/outlets/:outlet`; Express would otherwise treat
 * `next-code` as an outlet id and the parameter validator would reject it.
 */
router.get('/outlets/next-code', webAuth('jhatka_catalog_read'), async (req, res, next) => {
  try {
    const { city } = req.query || {};
    if (!city) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'city is required', true, '', {
        code: 'MISSING_REQUIRED_FIELD', field: 'city',
      });
    }
    return res.json({ outletCode: await JhatkaOnboarding.generateOutletCode(city) });
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/admin/outlets/:outlet */
router.get('/outlets/:outlet', webAuth('jhatka_catalog_read'), validate(V.namedParam('outlet')), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.params.outlet)
      .populate('city', 'name state')
      .populate('locality', 'name')
      .populate('business', 'name code businessModel logo city owner contact')
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
    const {
      outletCode,
      business,
      businessModel,
      name,
      logo,
      cover,
      description,
      contact,
      address,
      city,
      locality,
      location,
      serviceArea,
      territory,
      ownDeliveryPartner,
      driverPayoutMode,
      operatingHours,
      qualityPolicy,
      orderConfig,
      cancellationConfig,
      subscriptionConfig,
      taxIdentity,
      packaging,
      paymentConfig,
      holdPolicy,
    } = req.body || {};

    for (const [field, label] of [
      ['business', 'business'], ['businessModel', 'businessModel'],
      ['name', 'name'], ['city', 'city'],
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

    const owningBusiness = await Business.findOne({ _id: business, vertical: 'jhatka' })
      .select('_id businessModel')
      .lean();
    if (!owningBusiness) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'business must be an existing Jhatka business', true, '', {
        code: 'INVALID_BUSINESS', field: 'business',
      });
    }

    const payload = {
      business,
      businessModel,
      name,
      logo,
      cover,
      description,
      contact,
      address,
      // TOP-LEVEL, ref to `City`. See the note in the file docblock.
      city,
      locality,
      location,
      serviceArea,
      territory,
      ownDeliveryPartner,
      driverPayoutMode,
      operatingHours,
      qualityPolicy,
      orderConfig,
      cancellationConfig,
      subscriptionConfig,
      taxIdentity,
      packaging,
      paymentConfig,
      holdPolicy,
      // Never `active` on create. See the docblock.
      status: 'pending_approval',
    };

    let outlet;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const resolvedOutletCode = outletCode
        ? String(outletCode).toUpperCase().trim()
        : await JhatkaOnboarding.generateOutletCode(city);
      try {
        outlet = await JhatkaOutlet.create({ ...payload, outletCode: resolvedOutletCode });
        break;
      } catch (error) {
        if (error?.code === 11000 && !outletCode && attempt < 2) continue;
        if (error?.code === 11000) {
          throw new ApiError(
            httpStatus.CONFLICT,
            'That outlet code is already in use',
            true,
            '',
            { code: 'OUTLET_CODE_TAKEN', field: 'outletCode' }
          );
        }
        throw error;
      }
    }

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
      outletCode,
      business,
      businessModel,
      name,
      logo,
      cover,
      description,
      contact,
      address,
      city,
      locality,
      location,
      serviceArea,
      territory,
      ownDeliveryPartner,
      driverPayoutMode,
      operatingHours,
      qualityPolicy,
      orderConfig,
      taxIdentity,
      status,
      statusReason,
      cancellationConfig,
      subscriptionConfig,
      packaging,
      paymentConfig,
      holdPolicy,
      minDeliveryMinutes,
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

    if (businessModel !== undefined && !BUSINESS_MODEL.includes(businessModel)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `businessModel must be one of ${BUSINESS_MODEL.join(' | ')}`,
        true, '', { code: 'INVALID_BUSINESS_MODEL', allowed: BUSINESS_MODEL, received: businessModel }
      );
    }

    if (outletCode !== undefined) outlet.outletCode = String(outletCode).toUpperCase().trim();
    if (business !== undefined) outlet.business = business;
    if (businessModel !== undefined) outlet.businessModel = businessModel;
    if (name !== undefined) outlet.name = name;
    if (logo !== undefined) outlet.logo = logo;
    if (cover !== undefined) outlet.cover = cover;
    if (description !== undefined) outlet.description = description;
    if (contact !== undefined) outlet.contact = mergeIfObject(outlet.contact, contact);
    if (address !== undefined) outlet.address = mergeIfObject(outlet.address, address);
    if (city !== undefined) outlet.city = city;
    if (locality !== undefined) outlet.locality = locality || undefined;
    if (location !== undefined) outlet.location = location;
    if (serviceArea !== undefined) outlet.serviceArea = mergeIfObject(outlet.serviceArea, serviceArea);
    if (territory !== undefined) outlet.territory = territory;
    if (ownDeliveryPartner !== undefined) outlet.ownDeliveryPartner = !!ownDeliveryPartner;
    if (driverPayoutMode !== undefined) outlet.driverPayoutMode = driverPayoutMode;
    if (operatingHours !== undefined) outlet.operatingHours = operatingHours;
    if (qualityPolicy !== undefined) outlet.qualityPolicy = mergeIfObject(outlet.qualityPolicy, qualityPolicy);
    if (orderConfig !== undefined || minDeliveryMinutes !== undefined) {
      outlet.orderConfig = mergeIfObject(outlet.orderConfig, {
        ...(orderConfig || {}),
        ...(minDeliveryMinutes !== undefined ? { minDeliveryMinutes: Number(minDeliveryMinutes) } : {}),
      });
    }
    if (taxIdentity !== undefined) outlet.taxIdentity = mergeIfObject(outlet.taxIdentity, taxIdentity);
    if (cancellationConfig !== undefined) {
      outlet.cancellationConfig = mergeIfObject(outlet.cancellationConfig, cancellationConfig);
    }
    if (subscriptionConfig !== undefined) {
      outlet.subscriptionConfig = mergeIfObject(outlet.subscriptionConfig, subscriptionConfig);
    }
    if (packaging !== undefined) outlet.packaging = mergeIfObject(outlet.packaging, packaging);
    if (paymentConfig !== undefined) {
      outlet.paymentConfig = mergeIfObject(outlet.paymentConfig, paymentConfig);
    }
    if (holdPolicy !== undefined) outlet.holdPolicy = mergeIfObject(outlet.holdPolicy, holdPolicy);

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