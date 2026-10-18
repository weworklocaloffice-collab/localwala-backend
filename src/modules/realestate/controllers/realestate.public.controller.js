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
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const ApiError = require('../../../utils/ApiError');
const RealEstatePropertyDocument = require('../models/realestate.property.document.model');
const categoryService = require('../services/realestate.category.service');
const propertyService = require('../services/realestate.property.service');
const searchService = require('../services/realestate.property.search.service');
const { extractSpecFilters } = require('../validations/realestate.public.validation');

/**
 * Public Real Estate endpoints.
 *
 * ## The rule every handler here obeys
 *
 * A public handler may only ever return a `PUBLISHED` property. `findByIdOrCode` in
 * the property service does NOT filter on status — it is shared with the admin
 * surface — so the check happens here, in `assertPubliclyVisible`, and it happens
 * before any document is read.
 *
 * Reading documents before that check would be worse than a bad response: the document
 * access middleware would happily return the `CUSTOMER_VISIBLE` papers for a listing
 * that is still in review. The listing must be public first, the papers second.
 */

/**
 * 404 rather than 403 for a non-public listing.
 *
 * A 403 confirms the listing exists, which tells a competitor that a vendor is
 * preparing a launch. A 404 is both the truth from the customer's side (there is
 * nothing here for you) and the safer answer.
 *
 * @param {object} property
 * @throws {ApiError} 404
 */
const assertPubliclyVisible = (property) => {
  if (!property) throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
  if (property.status !== searchService.PUBLIC_STATUS) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
  }
  return property;
};

/**
 * Strip fields a public caller must never receive.
 *
 * `createdBy` / `updatedBy` / `statusReason` / `entitlement` / `vendor` are internal
 * facts. `entitlement` in particular would expose which package a competitor bought.
 *
 * @param {object} property
 * @param {string} [actorType]
 * @returns {object}
 */
const toPublicProperty = (property) => {
  if (!property) return property;
  const out = { ...property };
  delete out.createdBy;
  delete out.updatedBy;
  delete out.statusReason;
  delete out.entitlement;
  delete out.vendor;
  // A "price on request" listing must not leak the figure through any path.
  if (out.priceOnRequest === true) {
    delete out.price;
  }
  return out;
};

// ---------------------------------------------------------------- categories

/**
 * List active categories.
 */
const listCategories = catchAsync(async (req, res) => {
  const categories = await categoryService.listActive();
  res.send({
    results: categories.map((c) => ({
      id: c._id,
      key: c.key,
      name: c.name,
      group: c.group,
      icon: c.icon,
      description: c.description,
      transactionTypes: c.transactionTypes || [],
      sortOrder: c.sortOrder,
    })),
  });
});

/**
 * Categories grouped into the five primary groups the app renders.
 */
const groupedCategories = catchAsync(async (req, res) => {
  const grouped = await categoryService.listGrouped();
  const out = {};
  Object.entries(grouped).forEach(([group, list]) => {
    out[group] = list.map((c) => ({
      id: c._id,
      key: c.key,
      name: c.name,
      icon: c.icon,
      transactionTypes: c.transactionTypes || [],
    }));
  });
  res.send({ groups: out });
});

/**
 * One category, including the filter controls a client needs to render.
 */
const getCategory = catchAsync(async (req, res) => {
  const category = await categoryService.findByKey(req.params.key);
  if (!category || category.status === false) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }
  res.send({
    id: category._id,
    key: category.key,
    name: category.name,
    group: category.group,
    description: category.description,
    transactionTypes: category.transactionTypes || [],
    amenities: category.amenityOptions || [],
    // The descriptors a form or filter panel renders. Only the filterable ones — the
    // public surface has no business enumerating every internal spec field.
    filters: propertyService.filterableFields(category).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      options: f.options,
      unit: f.unit,
      min: f.min,
      max: f.max,
    })),
  });
});

// ------------------------------------------------------------------ search

/**
 * Paginated search. Blueprint §12.
 */
const searchProperties = catchAsync(async (req, res) => {
  const query = extractSpecFilters(req.query);
  const result = await searchService.search(query);

  res.send({
    ...result,
    results: result.results.map(toPublicProperty),
  });
});

/**
 * Nearby listings, nearest first. Blueprint §12's map/radius filter.
 */
const nearbyProperties = catchAsync(async (req, res) => {
  const query = extractSpecFilters(req.query);
  const results = await searchService.nearby(Number(req.query.lng), Number(req.query.lat), query);
  res.send({ results: results.map(toPublicProperty) });
});

/**
 * Most-viewed published listings. Blueprint §44's "featured" strip.
 *
 * NOT paid promotion — see `searchService.featured`.
 */
const featuredProperties = catchAsync(async (req, res) => {
  const results = await searchService.featured(Number(req.query.limit) || 10);
  res.send({ results: results.map(toPublicProperty) });
});

/**
 * Newest published listings.
 */
const recentProperties = catchAsync(async (req, res) => {
  const results = await searchService.recent(Number(req.query.limit) || 10);
  res.send({ results: results.map(toPublicProperty) });
});

// ------------------------------------------------------------------ detail

/**
 * Property detail.
 */
const getProperty = catchAsync(async (req, res) => {
  const property = assertPubliclyVisible(await propertyService.findByIdOrCode(req.params.id));
  res.send(toPublicProperty(property));
});

/**
 * Property detail by human-facing code.
 */
const getPropertyByCode = catchAsync(async (req, res) => {
  const property = assertPubliclyVisible(await propertyService.findByIdOrCode(req.params.code));
  res.send(toPublicProperty(property));
});

/**
 * Listings similar to one property.
 */
const similarProperties = catchAsync(async (req, res) => {
  const property = assertPubliclyVisible(await propertyService.findByIdOrCode(req.params.id));
  const results = await searchService.similar(property, Number(req.query.limit) || 6);
  res.send({ results: results.map(toPublicProperty) });
});

/**
 * The safe verification summary for a property (blueprint §14, BR-18).
 *
 * Note the order: the listing must be publicly visible BEFORE any document is read,
 * and the read is scoped by `req.documentAccess.buildQuery` so a customer only ever
 * sees `CUSTOMER_VISIBLE` rows. `searchService.verificationSummary` then reduces that
 * to document TYPES — no ids, no urls, no filenames.
 */
const getPropertyVerification = catchAsync(async (req, res) => {
  const property = assertPubliclyVisible(await propertyService.findByIdOrCode(req.params.id));

  const documents = await RealEstatePropertyDocument.find(
    req.documentAccess.buildQuery(property._id)
  )
    .select('category visibility status')
    .lean();

  res.send(searchService.verificationSummary(property, documents));
});

/**
 * The filter vocabulary across every active category.
 *
 * A search filter sheet needs to know which controls to draw before the customer has
 * picked a category. Without this the client either hardcodes the spec vocabulary —
 * which breaks the moment an operator adds a field — or fetches every category in turn.
 *
 * Distinct keys across categories, with the union of their options. A key that appears
 * in two categories with different options (e.g. `furnishing` on apartments and on
 * commercial) yields the merged option set.
 */
const listFilters = catchAsync(async (req, res) => {
  const categories = await categoryService.listActive();

  const byKey = new Map();
  categories.forEach((c) => {
    propertyService.filterableFields(c).forEach((f) => {
      const existing = byKey.get(f.key);
      if (!existing) {
        byKey.set(f.key, {
          key: f.key,
          label: f.label,
          type: f.type,
          unit: f.unit,
          min: f.min,
          max: f.max,
          options: f.options ? [...f.options] : undefined,
          categories: [c.key],
        });
        return;
      }
      existing.categories.push(c.key);
      if (f.options) {
        existing.options = [...new Set([...(existing.options || []), ...f.options])];
      }
    });
  });

  res.send({
    price: { min: 0 },
    transactionTypes: ['BUY', 'RENT'],
    readiness: ['READY_TO_MOVE', 'UNDER_CONSTRUCTION', 'NEW', 'RESALE'],
    specs: [...byKey.values()],
    // So the client can explain the cap rather than silently returning nothing.
    search: { maxRadiusMeters: searchService.maxRadiusMeters() },
  });
});

module.exports = {
  listCategories,
  groupedCategories,
  getCategory,
  listFilters,
  searchProperties,
  nearbyProperties,
  featuredProperties,
  recentProperties,
  getProperty,
  getPropertyByCode,
  similarProperties,
  getPropertyVerification,
};
