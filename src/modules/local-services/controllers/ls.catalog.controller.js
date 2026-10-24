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

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const ApiError = require('../../../utils/ApiError');
const { fromPaise } = require('../../../utils/money');
const Category = require('../models/localservice.category.model');
const Facet = require('../models/localservice.facet.model');
const Service = require('../models/localservice.service.model');
const Variant = require('../models/localservice.variant.model');

const createCategory = catchAsync(async (req, res) => {
  if (await Category.isKeyTaken(req.body.key)) throw new ApiError(httpStatus.CONFLICT, 'Category key taken');
  const doc = await Category.create(req.body);
  res.status(httpStatus.CREATED).send({ category: doc });
});

const listCategories = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Category.paginate(filter, options));
});

const createFacet = catchAsync(async (req, res) => {
  if (req.body.dataType === 'ENUM' && !(req.body.options || []).length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'ENUM facet requires options');
  }
  const doc = await Facet.create(req.body);
  res.status(httpStatus.CREATED).send({ facet: doc });
});

const listFacets = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Facet.paginate(filter, options));
});

const createService = catchAsync(async (req, res) => {
  const doc = await Service.create(req.body);
  res.status(httpStatus.CREATED).send({ service: doc });
});

const listServices = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'category']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Service.paginate(filter, options));
});

const createVariant = catchAsync(async (req, res) => {
  const doc = await Variant.create(req.body);
  res.status(httpStatus.CREATED).send({ variant: doc });
});

const listVariants = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'service']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Variant.paginate(filter, options));
});

const Template = require('../models/localservice.catalog.ext.model').LocalServiceTemplate;
const Addon = require('../models/localservice.catalog.ext.model').LocalServiceAddon;

const createTemplate = catchAsync(async (req, res) => {
  const doc = await Template.create(req.body);
  res.status(httpStatus.CREATED).send({ template: doc });
});
const listTemplates = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Template.paginate(filter, options));
});

const createAddon = catchAsync(async (req, res) => {
  const doc = await Addon.create(req.body);
  res.status(httpStatus.CREATED).send({ addon: doc });
});

const listAddons = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'service']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Addon.paginate(filter, options));
});
const updateDoc = (Model, allowed) => catchAsync(async (req, res) => {
  const doc = await Model.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  if (Model === Category && req.body.key && req.body.key !== doc.key) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Category key is immutable');
  }
  for (const k of allowed) {
    if (req.body[k] !== undefined) doc[k] = req.body[k];
  }
  await doc.save();
  res.status(httpStatus.OK).send({ doc });
});

const searchAvailability = catchAsync(async (req, res) => {
  // ?service=<serviceId>&startAt=&endAt= : providers holding an active offering
  // with working hours covering the window and enough free capacity.
  const Offering = require('../models/localservice.offering.model');
  const Reservation = require('../models/localservice.reservation.model');
  const { startAt, endAt, service } = req.query;
  if (!service || !startAt || !endAt) throw new ApiError(httpStatus.BAD_REQUEST, 'service, startAt, endAt required');
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid availability window');
  }
  const { LocalServiceAvailabilityRule } = require('../models/localservice.staff.model');
  const availability = require('../services/localservice.availability.service');
  const { LocalServiceCoverage } = require('../models/localservice.staff.model');
  const { isCovered } = require('../services/localservice.staff.service');

  // Optional coverage scoping: a customer may pass their locality/pincode
  // (or an address id whose locality/pincode we resolve) and providers whose
  // coverage does not include them are dropped. Without it the search behaves
  // exactly as before, so existing callers keep working.
  const locality = req.query.locality || req.query.localityName;
  const pincode = req.query.pincode;
  const addressId = req.query.address;
  let resolvedLocality = locality ? String(locality) : null;
  let resolvedPincode = pincode ? String(pincode) : null;
  if (addressId) {
    try {
      const Address = require('../../../models/user.address.model');
      const address = await Address.findById(addressId).lean();
      if (address) {
        resolvedLocality = resolvedLocality || address.locality || address.city || null;
        resolvedPincode = resolvedPincode || address.pincode || null;
      }
    } catch (e) {
      // Address lookup is best-effort; a missing address never breaks search.
    }
  }
  const coverageRequested = !!(resolvedLocality || resolvedPincode);

  const offerings = await Offering.find({ service, status: 'active' })
    .populate({
      path: 'provider',
      match: { status: 'ACTIVE', bookable: true },
      select: 'businessName providerType',
    })
    .lean();
  const { LocalServiceFeaturedPlacement } = require('../models/localservice.growth.model');
  const { isFeatured } = require('../services/localservice.growth.service');
  const placements = await LocalServiceFeaturedPlacement.find({ status: 'active' }).lean();
  const out = [];
  for (const o of offerings) {
    if (!o.provider) continue;
    const providerId = o.provider._id;
    const rule =
      (await LocalServiceAvailabilityRule.findOne({
        provider: providerId,
        service,
        day: start.getDay(),
        status: 'active',
      }).lean()) ||
      (await LocalServiceAvailabilityRule.findOne({
        provider: providerId,
        service: null,
        day: start.getDay(),
        status: 'active',
      }).lean());
    const capacity = rule && rule.capacity ? rule.capacity : 1;
    const bufferMinutes = rule && rule.bufferMinutes != null ? rule.bufferMinutes : 10;
    const existing = await Reservation.find({
      provider: providerId,
      status: { $in: ['held', 'confirmed'] },
    });
    const sponsored = isFeatured(placements, { providerId, serviceId: o.service }, new Date());
    // Coverage: a provider that does not serve the customer's address is
    // reported as unavailable rather than dropped, so the UI can show it
    // greyed out with the reason. Only when no coverage was supplied do we
    // keep the legacy behaviour (everyone is "in coverage").
    if (coverageRequested) {
      const coverage = await LocalServiceCoverage.findOne({ provider: providerId }).lean();
      const covered = isCovered(coverage, { locality: resolvedLocality, pincode: resolvedPincode });
      if (!covered) {
        out.push({ provider: o.provider, offering: o._id, available: false, sponsored, inCoverage: false });
        continue;
      }
    }
    const withinHours = availability.isWithinWorkingHours(rule, start, end);
    try {
      if (!withinHours) throw new ApiError(httpStatus.CONFLICT, 'Outside working hours');
      availability.assertSlotFree(existing, start, end, bufferMinutes, { capacity });
      out.push({ provider: o.provider, offering: o._id, available: true, sponsored });
    } catch {
      out.push({ provider: o.provider, offering: o._id, available: false, sponsored });
    }
  }
  // Sponsored first, then organic — labels kept distinct, never mixed silently.
  out.sort((a, b) => Number(b.sponsored) - Number(a.sponsored));
  res.status(httpStatus.OK).send({ results: out });
});

// Public: only active rows, no internal fields.
const publicCategories = catchAsync(async (req, res) => {
  const rows = await Category.find({ status: 'active' }).sort({ sortOrder: 1 }).lean();
  res.status(httpStatus.OK).send({ results: rows });
});

const publicServices = catchAsync(async (req, res) => {
  const filter = { status: 'active' };
  if (req.query.category) filter.category = req.query.category;
  const rows = await Service.find(filter).lean();
  res.status(httpStatus.OK).send({ results: rows });
});

const publicServiceDetail = catchAsync(async (req, res) => {
  const service = await Service.findOne({ _id: req.params.id, status: 'active' }).lean();
  if (!service) throw new ApiError(httpStatus.NOT_FOUND, 'Service not found');
  const [variants, addons] = await Promise.all([
    Variant.find({ service: service._id, status: 'active' }).lean(),
    Addon.find({ service: service._id, status: 'active' }).lean(),
  ]);
  res.status(httpStatus.OK).send({
    service,
    variants: variants.map((v) => ({ ...v, price: fromPaise(v.basePrice) })),
    addons: addons.map((a) => ({ ...a, price: fromPaise(a.price) })),
  });
});

const publicOfferings = catchAsync(async (req, res) => {
  const Offering = require('../models/localservice.offering.model');
  if (!req.query.service) throw new ApiError(httpStatus.BAD_REQUEST, 'service required');
  const filter = { service: req.query.service, status: 'active' };
  if (req.query.variant) filter.variant = req.query.variant;
  const rows = await Offering.find(filter)
    .populate({ path: 'provider', match: { status: 'ACTIVE', bookable: true } })
    .populate({ path: 'variant', match: { status: 'active' } })
    .lean();
  const results = rows
    .filter((row) => row.provider)
    .map((row) => ({
      offering: row._id,
      provider: {
        _id: row.provider._id,
        businessName: row.provider.businessName,
        providerType: row.provider.providerType,
      },
      variant: row.variant
        ? { _id: row.variant._id, name: row.variant.name, durationMinutes: row.variant.durationMinutes }
        : null,
      price: fromPaise(row.price),
      durationMinutes: row.durationMinutes,
    }));
  res.status(httpStatus.OK).send({ results });
});

const publicOfferingDetail = catchAsync(async (req, res) => {
  const Offering = require('../models/localservice.offering.model');
  const doc = await Offering.findById(req.params.id)
    .populate({ path: 'provider', match: { status: 'ACTIVE', bookable: true }, select: 'businessName providerType' })
    .populate({ path: 'variant', match: { status: 'active' } })
    .lean();
  if (!doc || !doc.provider) throw new ApiError(httpStatus.NOT_FOUND, 'Offering not found');
  const { isFeatured } = require('../services/localservice.growth.service');
  const { LocalServiceFeaturedPlacement } = require('../models/localservice.growth.model');
  const placements = await LocalServiceFeaturedPlacement.find({ status: 'active' }).lean();
  const sponsored = isFeatured(placements, { providerId: doc.provider._id, serviceId: doc.service }, new Date());
  res.status(httpStatus.OK).send({
    offering: doc._id,
    provider: {
      _id: doc.provider._id,
      businessName: doc.provider.businessName,
      providerType: doc.provider.providerType,
    },
    variant: doc.variant ? { _id: doc.variant._id, name: doc.variant.name, durationMinutes: doc.variant.durationMinutes } : null,
    price: fromPaise(doc.price),
    durationMinutes: doc.durationMinutes,
    sponsored,
  });
});

const publicProviders = catchAsync(async (req, res) => {
  const Provider = require('../models/localservice.provider.model');
  const Offering = require('../models/localservice.offering.model');
  const filter = { status: 'ACTIVE', bookable: true };
  if (req.query.service) {
    // Only providers that actually offer the service.
    const offeringProviderIds = await Offering.find({ service: req.query.service, status: 'active' })
      .distinct('provider');
    filter._id = { $in: offeringProviderIds };
  }
  const rows = await Provider.find(filter)
    .select('businessName providerType businessAddress')
    .lean();
  res.status(httpStatus.OK).send({ results: rows });
});

const publicFacets = catchAsync(async (req, res) => {
  const Facet = require('../models/localservice.facet.model');
  const filter = { status: 'active' };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.subcategory) filter.subcategory = req.query.subcategory;
  const rows = await Facet.find(filter).sort({ sortOrder: 1 }).lean();
  res.status(httpStatus.OK).send({ results: rows });
});

const publicSubcategories = catchAsync(async (req, res) => {
  const Category = require('../models/localservice.category.model');
  const parent = await Category.findOne({ _id: req.params.id, status: 'active' }).lean();
  if (!parent) throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  const rows = await Category.find({ parent: parent._id, status: 'active' }).sort({ sortOrder: 1 }).lean();
  res.status(httpStatus.OK).send({ results: rows });
});

const updateCategory = updateDoc(Category, ['name', 'description', 'icon', 'sortOrder', 'allowedBookingModes', 'status']);
const updateFacet = updateDoc(Facet, ['name', 'label', 'description', 'icon', 'sortOrder', 'options', 'required', 'searchable', 'filterable', 'status']);
const updateService = updateDoc(Service, ['name', 'description', 'bookingMode', 'pricingMode', 'baseDurationMinutes', 'minPrice', 'maxPrice', 'inspectionFee', 'inspectionFeeTreatment', 'depositPercent', 'allowedPaymentModes', 'allowedBookingModes', 'status']);
const updateVariant = updateDoc(Variant, ['name', 'sku', 'durationMinutes', 'basePrice', 'includedWork', 'status']);
const updateTemplate = updateDoc(Template, ['name', 'description', 'requiredFields', 'status']);
const updateAddon = updateDoc(Addon, ['name', 'description', 'price', 'status']);

module.exports = {
  createCategory,
  listCategories,
  createFacet,
  listFacets,
  createService,
  listServices,
  createVariant,
  listVariants,
  createTemplate,
  listTemplates,
  createAddon,
  listAddons,
  updateCategory,
  updateFacet,
  updateService,
  updateVariant,
  updateTemplate,
  updateAddon,
  searchAvailability,
  publicCategories,
  publicServices,
  publicServiceDetail,
  publicOfferings,
  publicOfferingDetail,
  publicProviders,
  publicFacets,
  publicSubcategories,
};
