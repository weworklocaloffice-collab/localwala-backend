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
  // with no overlapping held/confirmed reservation in the window.
  const Offering = require('../models/localservice.offering.model');
  const Reservation = require('../models/localservice.reservation.model');
  const availability = require('../services/localservice.availability.service');
  const { startAt, endAt, service } = req.query;
  if (!service || !startAt || !endAt) throw new ApiError(httpStatus.BAD_REQUEST, 'service, startAt, endAt required');
  const offerings = await Offering.find({ service, status: 'active' }).populate('provider').lean();
  const { LocalServiceFeaturedPlacement } = require('../models/localservice.growth.model');
  const { isFeatured } = require('../services/localservice.growth.service');
  const placements = await LocalServiceFeaturedPlacement.find({ status: 'active' }).lean();
  const out = [];
  for (const o of offerings) {
    // Scope to this provider's holds only — a hold elsewhere must never block here.
    const existing = await Reservation.find({ provider: o.provider._id || o.provider, status: { $in: ['held', 'confirmed'] } });
    const sponsored = isFeatured(placements, { providerId: o.provider._id || o.provider, serviceId: o.service }, new Date());
    try {
      availability.assertSlotFree(existing, startAt, endAt, 10);
      out.push({ provider: o.provider, offering: o._id, available: true, sponsored });
    } catch (e) {
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

module.exports = {
  createCategory,
  listCategories,
  updateCategory: updateDoc(Category, ['name', 'description', 'icon', 'image', 'sortOrder', 'status', 'allowedBookingModes']),
  createFacet,
  listFacets,
  updateFacet: updateDoc(Facet, ['label', 'options', 'required', 'searchable', 'filterable', 'status']),
  createService,
  listServices,
  updateService: updateDoc(Service, ['name', 'description', 'bookingMode', 'pricingMode', 'baseDurationMinutes', 'minPrice', 'maxPrice', 'inspectionFee', 'inspectionFeeTreatment', 'allowedPaymentModes', 'status']),
  createVariant,
  listVariants,
  updateVariant: updateDoc(Variant, ['name', 'durationMinutes', 'basePrice', 'includedWork', 'status']),
  createTemplate,
  listTemplates,
  updateTemplate: updateDoc(Template, ['name', 'bookingMode', 'pricingMode', 'requiredFacets', 'inspectionRequired', 'depositPercent', 'cancellationCutoffHours', 'status']),
  createAddon,
  listAddons,
  updateAddon: updateDoc(Addon, ['name', 'price', 'unit', 'status']),
  searchAvailability,
  publicCategories,
  publicServices,
};
