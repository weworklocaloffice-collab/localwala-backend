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
 * modification, or use of this source or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { AUDIT_ACTIONS, recordAudit } = require('./stores.audit.service');

/**
 * The Admin side of the stores taxonomy.
 *
 * ## Why taxonomy is Admin-owned at all
 *
 * BR-10 makes categories Admin-configurable and BR-26 forbids a per-category backend
 * module. Together those mean the taxonomy is DATA and this file is the only thing that
 * writes it. The 20 seeded categories are just the initial rows; adding a twenty-first is
 * a row created here, not a deploy.
 *
 * ## Why nothing here hard-deletes
 *
 * BR-25 says historical records are never physically deleted, and a category is
 * referenced by subcategories, by `ChainProduct.category`, and by `ChainProduct.subcategory`
 * on every order line ever placed against it. Deleting one does not remove those
 * references, it orphans them — a product whose `populate('category')` returns null,
 * rendered as an unnamed row in an admin filter and a blank category on an old invoice.
 *
 * So `remove` archives. It refuses when anything still points at the row, and says what
 * is pointing at it, which turns a confusing orphaned-data bug into a clear 409.
 */

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/\s/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

const listCategories = async ({ page = 1, limit = 20, search, status } = {}) => {
  const StoreCategory = mongoose.model('StoreCategory');
  const filter = {};
  if (search) filter.name = { $regex: search, $options: 'i' };
  if (status !== undefined && status !== '') filter.status = status === 'true' || status === true;

  const [results, totalResults] = await Promise.all([
    StoreCategory.find(filter)
      .sort({ sortOrder: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StoreCategory.countDocuments(filter),
  ]);

  return { results, totalResults, page, limit, totalPages: Math.ceil(totalResults / limit) || 1 };
};

const getCategory = async (categoryId) => {
  const StoreCategory = mongoose.model('StoreCategory');
  const category = await StoreCategory.findById(categoryId).lean();
  if (!category) throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  return category;
};

const createCategory = async ({ name, icon, sortOrder, status } = {}) => {
  const StoreCategory = mongoose.model('StoreCategory');
  // `key` allows only [a-z0-9_] but `slugify` writes hyphens. The old check queried a
  // `slug` field StoreCategory does not have, so it always found nothing and a duplicate
  // name reached Mongo's unique index as a raw 500. Check the field that exists.
  const key = slugify(name).replace(/-/g, '_');

  if (await StoreCategory.isKeyTaken(key)) {
    throw new ApiError(httpStatus.CONFLICT, 'A category with this name already exists');
  }

  return StoreCategory.create({
    key,
    name,
    icon: icon || 'tablerShoppingCart',
    sortOrder: sortOrder || 0,
    status: status === undefined ? true : status,
  });
};

const updateCategory = async (categoryId, updates = {}) => {
  const StoreCategory = mongoose.model('StoreCategory');
  const category = await StoreCategory.findById(categoryId);
  if (!category) throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');

  // `key` is the stable import/seed reference and is READ-ONLY on edit; `name` is the
  // human label. The old code regenerated the key from the new name, and because
  // `slugify` writes hyphens it produced a key the model's [a-z0-9_] validator rejected,
  // so every rename failed.
  if (updates.name !== undefined) category.name = updates.name;
  if (updates.icon !== undefined) category.icon = updates.icon;
  if (updates.sortOrder !== undefined) category.sortOrder = updates.sortOrder;
  if (updates.status !== undefined) category.status = updates.status;

  await category.save();
  return category;
};

/**
 * Archive a category, refusing while a subcategory or a product still points at it.
 *
 * The reference check is the whole point. An archive that orphaned subcategories would
 * leave them unreachable from any browse path and invisible in the subcategory list.
 */
const removeCategory = async (categoryId) => {
  const StoreCategory = mongoose.model('StoreCategory');
  const StoreSubcategory = mongoose.model('StoreSubcategory');
  const ChainProduct = mongoose.model('ChainProduct');

  const category = await StoreCategory.findById(categoryId);
  if (!category) throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');

  const [subCount, productCount] = await Promise.all([
    StoreSubcategory.countDocuments({ category: category._id }),
    ChainProduct.countDocuments({ category: category._id }),
  ]);

  if (subCount > 0 || productCount > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Category is referenced by ${subCount} subcategory(ies) and ${productCount} product(s). Set status=false instead.`
    );
  }

  category.status = false;
  await category.save();
  return category;
};

// ---------------------------------------------------------------------------
// subcategories
// ---------------------------------------------------------------------------

const listSubcategories = async ({ page = 1, limit = 20, search, category, status } = {}) => {
  const StoreSubcategory = mongoose.model('StoreSubcategory');
  const filter = {};
  if (search) filter.name = { $regex: search, $options: 'i' };
  if (category) filter.category = category;
  if (status !== undefined && status !== '') filter.status = status === 'true' || status === true;

  const [results, totalResults] = await Promise.all([
    StoreSubcategory.find(filter)
      .populate('category', 'name slug')
      .sort({ sortOrder: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StoreSubcategory.countDocuments(filter),
  ]);

  return { results, totalResults, page, limit, totalPages: Math.ceil(totalResults / limit) || 1 };
};

const createSubcategory = async ({ name, category, categoryDefaults, sortOrder, status } = {}) => {
  const StoreSubcategory = mongoose.model('StoreSubcategory');
  const StoreCategory = mongoose.model('StoreCategory');

  const parent = await StoreCategory.findById(category);
  if (!parent) throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');

  const slug = slugify(name);
  // Same key/slug split as createCategory above: the key allows only [a-z0-9_].
  const key = slug.replace(/-/g, '_');
  const existing = await StoreSubcategory.findOne({ key });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'A subcategory with this name already exists');

  // The category's defaults merged with the subcategory's overrides is the whole of
  // BR-26 — one category behaving differently per subcategory without a second code path.
  const merged = { ...(parent.settings || {}), ...(categoryDefaults || {}) };

  return StoreSubcategory.create({
    key,
    name,
    slug,
    category,
    categoryDefaults: merged,
    sortOrder: sortOrder || 0,
    status: status === undefined ? true : status,
  });
};

const updateSubcategory = async (subcategoryId, updates = {}) => {
  const StoreSubcategory = mongoose.model('StoreSubcategory');
  const subcategory = await StoreSubcategory.findById(subcategoryId);
  if (!subcategory) throw new ApiError(httpStatus.NOT_FOUND, 'Subcategory not found');

  if (updates.name !== undefined) subcategory.name = updates.name;
  if (updates.categoryDefaults !== undefined) {
    subcategory.categoryDefaults = { ...(subcategory.categoryDefaults || {}), ...updates.categoryDefaults };
  }
  if (updates.sortOrder !== undefined) subcategory.sortOrder = updates.sortOrder;
  if (updates.status !== undefined) subcategory.status = updates.status;

  await subcategory.save();
  return subcategory;
};

const removeSubcategory = async (subcategoryId) => {
  const StoreSubcategory = mongoose.model('StoreSubcategory');
  const ChainProduct = mongoose.model('ChainProduct');

  const subcategory = await StoreSubcategory.findById(subcategoryId);
  if (!subcategory) throw new ApiError(httpStatus.NOT_FOUND, 'Subcategory not found');

  const productCount = await ChainProduct.countDocuments({ subcategory: subcategory._id });
  if (productCount > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Subcategory is referenced by ${productCount} product(s). Set status=false instead.`
    );
  }

  subcategory.status = false;
  await subcategory.save();
  return subcategory;
};

// ---------------------------------------------------------------------------
// brands
// ---------------------------------------------------------------------------

const listBrands = async ({ page = 1, limit = 20, search, status } = {}) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const filter = {};
  if (search) {
    // Alias search too, because a partner typing "SAMSUNG" must find "Samsung". A
    // name-only filter makes the brand look absent and invites a duplicate request.
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { aliases: { $regex: search, $options: 'i' } },
    ];
  }
  if (status) filter.status = status;

  const [results, totalResults] = await Promise.all([
    StoreBrand.find(filter)
      .populate('categories', 'name slug')
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    StoreBrand.countDocuments(filter),
  ]);

  return { results, totalResults, page, limit, totalPages: Math.ceil(totalResults / limit) || 1 };
};

/**
 * A brand cannot be approved with no category.
 *
 * §5.7.4: a brand with no taxonomy has no browse path and no landing page, so approving
 * it publishes something unreachable. This is the one brand rule enforced at write time
 * rather than left to the review screen.
 */
const createBrand = async ({ name, aliases, categories, originCountry, website, description, status, by } = {}) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const slug = slugify(name);
  const existing = await StoreBrand.findOne({ slug });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'A brand with this name already exists');

  if (status === 'approved' && (!categories || !categories.length)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'A brand cannot be approved without a category');
  }

  const brand = await StoreBrand.create({
    name,
    slug,
    aliases: aliases || [],
    categories: categories || [],
    originCountry,
    website,
    description,
    status: status || 'pending',
    isVerified: false,
  });

  await recordAudit({
    actor: by || undefined,
    role: 'admin',
    action: AUDIT_ACTIONS.brandCreated,
    targetType: 'StoreBrand',
    targetId: brand._id,
    after: { name: brand.name, slug: brand.slug, status: brand.status },
  });

  return brand;
};

const updateBrand = async (brandId, updates = {}, { by } = {}) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const brand = await StoreBrand.findById(brandId);
  if (!brand) throw new ApiError(httpStatus.NOT_FOUND, 'Brand not found');

  // Approval may arrive in the same PATCH as the categories it depends on. The old check
  // read the brand's current categories, so "approve + assign category" was rejected while
  // a later "approve" with no body change succeeded.
  const nextCategories =
    updates.categories !== undefined ? updates.categories : brand.categories || [];
  if (updates.status === 'approved' && !nextCategories.length) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'A brand cannot be approved without a category');
  }

  const before = {
    name: brand.name,
    status: brand.status,
    isVerified: brand.isVerified,
    categories: brand.categories,
  };

  const allowed = ['name', 'aliases', 'categories', 'subcategories', 'originCountry', 'website', 'description', 'logo', 'banner', 'status'];
  for (const key of allowed) {
    if (updates[key] !== undefined) brand[key] = updates[key];
  }
  brand.isVerified = brand.status === 'approved' && StoreBrand.isCertified(brand);

  await brand.save();

  await recordAudit({
    actor: by,
    role: 'admin',
    action: AUDIT_ACTIONS.brandUpdated,
    targetType: 'StoreBrand',
    targetId: brand._id,
    before,
    after: { name: brand.name, status: brand.status, isVerified: brand.isVerified },
  });

  return brand;
};

const removeBrand = async (brandId, { by } = {}) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const ChainProduct = mongoose.model('ChainProduct');

  const brand = await StoreBrand.findById(brandId);
  if (!brand) throw new ApiError(httpStatus.NOT_FOUND, 'Brand not found');

  const productCount = await ChainProduct.countDocuments({ brand: brand._id });
  if (productCount > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Brand is referenced by ${productCount} product(s). Set status=archived instead.`
    );
  }

  brand.status = 'archived';
  brand.isVerified = false;
  await brand.save();

  await recordAudit({
    actor: by,
    role: 'admin',
    action: AUDIT_ACTIONS.brandArchived,
    targetType: 'StoreBrand',
    targetId: brand._id,
    after: { status: 'archived' },
  });

  return brand;
};

const addBrandCertification = async (brandId, payload = {}) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const brand = await StoreBrand.findById(brandId);
  if (!brand) throw new ApiError(httpStatus.NOT_FOUND, 'Brand not found');
  if (brand.status === 'archived' || brand.mergedInto) {
    throw new ApiError(httpStatus.CONFLICT, 'Certifications cannot be added to an archived brand');
  }

  if (payload.chain) {
    const duplicate = (brand.certifications || []).some(
      (certification) =>
        certification.chain &&
        String(certification.chain) === String(payload.chain) &&
        certification.status === 'pending'
    );
    if (duplicate) {
      throw new ApiError(httpStatus.CONFLICT, 'A pending certification already exists for this brand');
    }
  }

  brand.certifications.push({
    chain: payload.chain || undefined,
    requestedBy: payload.requestedBy || undefined,
    submittedAt: payload.submittedAt || (payload.chain ? new Date() : undefined),
    type: payload.type,
    number: payload.number || undefined,
    validFrom: payload.validFrom || undefined,
    validTo: payload.validTo || undefined,
    document: payload.document || undefined,
    status: 'pending',
  });
  await brand.save();

  await recordAudit({
    actor: payload.requestedBy || undefined,
    role: payload.requestedByRole || 'admin',
    action: AUDIT_ACTIONS.brandCertificationAdded,
    targetType: 'StoreBrand',
    targetId: brand._id,
    chain: payload.chain || undefined,
    after: {
      index: brand.certifications.length - 1,
      type: payload.type,
      status: 'pending',
    },
  });

  return { brand, index: brand.certifications.length - 1 };
};

const reviewBrandCertification = async (brandId, index, { status, rejectionReason, by } = {}) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const brand = await StoreBrand.findById(brandId);
  if (!brand) throw new ApiError(httpStatus.NOT_FOUND, 'Brand not found');

  const certification = brand.certifications[index];
  if (!certification) throw new ApiError(httpStatus.NOT_FOUND, 'Certification not found');
  if (certification.status === 'expired') {
    throw new ApiError(httpStatus.CONFLICT, 'Expired certifications cannot be reviewed again');
  }
  if (status === 'approved' && certification.validTo && certification.validTo <= new Date()) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'An expired certification cannot be approved');
  }

  const beforeStatus = certification.status;
  certification.status = status;
  certification.verifiedBy = by || undefined;
  certification.verifiedAt = new Date();
  certification.rejectionReason = status === 'rejected' ? rejectionReason || undefined : undefined;
  if (status === 'approved') certification.expiredAt = undefined;

  brand.isVerified = brand.status === 'approved' && StoreBrand.isCertified(brand);
  await brand.save();

  await recordAudit({
    actor: by,
    role: 'admin',
    action: AUDIT_ACTIONS.brandCertificationReviewed,
    targetType: 'StoreBrand',
    targetId: brand._id,
    before: { index, status: beforeStatus },
    after: { index, status, rejectionReason: status === 'rejected' ? rejectionReason : undefined },
  });

  return brand;
};

const expireBrandCertifications = async () => {
  const StoreBrand = mongoose.model('StoreBrand');
  const now = new Date();
  const brands = await StoreBrand.find({
    $or: [{ 'certifications.0': { $exists: true } }, { isVerified: true }],
  });

  let expired = 0;
  let badgesCleared = 0;

  for (const brand of brands) {
    let changed = false;

    for (const certification of brand.certifications) {
      if (
        certification.status === 'approved' &&
        certification.validTo &&
        certification.validTo <= now
      ) {
        certification.status = 'expired';
        certification.expiredAt = now;
        expired += 1;
        changed = true;
      }
    }

    const nextVerified = brand.status === 'approved' && StoreBrand.isCertified(brand);
    if (Boolean(brand.isVerified) !== nextVerified) {
      brand.isVerified = nextVerified;
      if (!nextVerified) badgesCleared += 1;
      changed = true;
    }

    if (changed) await brand.save();
  }

  return { expired, brandsChecked: brands.length, badgesCleared };
};

const uniqueIds = (left = [], right = []) => {
  const seen = new Set((left || []).map(String));
  const merged = [...(left || [])];
  for (const value of right || []) {
    if (!seen.has(String(value))) {
      seen.add(String(value));
      merged.push(value);
    }
  }
  return merged;
};

/**
 * Merge a duplicate brand into the canonical one.
 *
 * A merge is a multi-collection write: products and brand requests move, the target's
 * aliases/taxonomy/certifications are unioned, and the duplicate is archived with a
 * pointer back to the survivor. A partial move would leave products split across two
 * brands, so this runs in a transaction. Nothing is hard-deleted (BR-25).
 */
const mergeBrand = async (sourceId, { targetBrand, note, by } = {}) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const ChainProduct = mongoose.model('ChainProduct');
  const StoreBrandRequest = mongoose.model('StoreBrandRequest');

  if (String(sourceId) === String(targetBrand)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A brand cannot be merged into itself');
  }

  const session = await mongoose.startSession();
  let outcome;
  try {
    outcome = await session.withTransaction(async () => {
      const [source, target] = await Promise.all([
        StoreBrand.findById(sourceId).session(session),
        StoreBrand.findById(targetBrand).session(session),
      ]);

      if (!source) throw new ApiError(httpStatus.NOT_FOUND, 'Duplicate brand not found');
      if (!target) throw new ApiError(httpStatus.NOT_FOUND, 'Target brand not found');
      if (source.mergedInto) {
        throw new ApiError(httpStatus.CONFLICT, 'This brand has already been merged');
      }
      if (source.status === 'archived') {
        throw new ApiError(httpStatus.CONFLICT, 'Archived brands cannot be merged');
      }
      if (target.status !== 'approved') {
        throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Target brand must be approved');
      }

      const movedProducts = await ChainProduct.countDocuments({ brand: source._id }).session(session);
      await ChainProduct.updateMany(
        { brand: source._id },
        { $set: { brand: target._id } },
        { session }
      );
      await StoreBrandRequest.updateMany(
        { brand: source._id },
        { $set: { brand: target._id } },
        { session }
      );

      // Aliases drive partner search; carry the duplicate's name and aliases across so a
      // partner typing the old spelling still finds the canonical row.
      const aliases = new Map();
      const addAlias = (value) => {
        const clean = String(value || '').trim();
        if (clean && !aliases.has(clean.toLowerCase())) aliases.set(clean.toLowerCase(), clean);
      };
      (target.aliases || []).forEach(addAlias);
      addAlias(source.name);
      (source.aliases || []).forEach(addAlias);
      target.aliases = [...aliases.values()];

      target.categories = uniqueIds(target.categories, source.categories);
      target.subcategories = uniqueIds(target.subcategories, source.subcategories);

      const certifications = new Map();
      for (const certification of [...(target.certifications || []), ...(source.certifications || [])]) {
        const value = certification.toObject ? certification.toObject() : certification;
        const key = `${value.type || ''}|${value.number || ''}|${value.document || ''}`;
        if (!certifications.has(key)) certifications.set(key, value);
      }
      target.certifications = [...certifications.values()];

      for (const field of ['originCountry', 'website', 'description', 'logo', 'banner', 'supportContact', 'supportPhone']) {
        if (!target[field] && source[field]) target[field] = source[field];
      }

      const totalRatings = (target.ratingCount || 0) + (source.ratingCount || 0);
      if (totalRatings > 0) {
        target.rating =
          ((target.rating || 0) * (target.ratingCount || 0) +
            (source.rating || 0) * (source.ratingCount || 0)) /
          totalRatings;
        target.ratingCount = totalRatings;
      }
      target.isVerified = target.status === 'approved' && StoreBrand.isCertified(target);

      source.status = 'archived';
      source.isVerified = false;
      source.mergedInto = target._id;
      source.mergedAt = new Date();
      source.mergedBy = by || undefined;
      source.mergeNote = note || undefined;

      await target.save({ session });
      await source.save({ session });

      return { source, target, movedProducts };
    });
  } finally {
    await session.endSession();
  }

  // Audit AFTER the transaction has committed: a row written inside the session would be
  // discarded with it, so a retried merge would leave no trail at all.
  await recordAudit({
    actor: by,
    role: 'admin',
    action: AUDIT_ACTIONS.brandMerged,
    targetType: 'StoreBrand',
    targetId: targetBrand,
    before: { sourceStatus: outcome.source.status },
    after: { target: String(targetBrand), archivedSource: String(outcome.source._id) },
    meta: { movedProducts: outcome.movedProducts, note },
  });

  return outcome;
};

// ---------------------------------------------------------------------------
// attribute templates
// ---------------------------------------------------------------------------

const listAttributeTemplates = async ({ page = 1, limit = 20, search } = {}) => {
  const StoreAttributeTemplate = mongoose.model('StoreAttributeTemplate');
  const filter = {};
  if (search) filter.name = { $regex: search, $options: 'i' };

  const [results, totalResults] = await Promise.all([
    StoreAttributeTemplate.find(filter).sort({ displayOrder: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreAttributeTemplate.countDocuments(filter),
  ]);

  return { results, totalResults, page, limit, totalPages: Math.ceil(totalResults / limit) || 1 };
};

const createAttributeTemplate = async (payload = {}) => {
  const StoreAttributeTemplate = mongoose.model('StoreAttributeTemplate');
  const slug = slugify(payload.name);
  const existing = await StoreAttributeTemplate.findOne({ slug });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'An attribute template with this name already exists');

  return StoreAttributeTemplate.create({
    ...payload,
    name: payload.name,
    slug,
    status: payload.status === undefined ? true : payload.status,
  });
};

const updateAttributeTemplate = async (templateId, updates = {}) => {
  const StoreAttributeTemplate = mongoose.model('StoreAttributeTemplate');
  const template = await StoreAttributeTemplate.findById(templateId);
  if (!template) throw new ApiError(httpStatus.NOT_FOUND, 'Attribute template not found');

  const allowed = ['name', 'type', 'options', 'unit', 'filterable', 'searchable', 'required', 'variantAxis', 'isOrganicRelevant', 'displayOrder', 'status'];
  for (const key of allowed) {
    if (updates[key] !== undefined) template[key] = updates[key];
  }

  await template.save();
  return template;
};

const removeAttributeTemplate = async (templateId) => {
  const StoreAttributeTemplate = mongoose.model('StoreAttributeTemplate');
  const template = await StoreAttributeTemplate.findById(templateId);
  if (!template) throw new ApiError(httpStatus.NOT_FOUND, 'Attribute template not found');

  // A template generates variants. Removing one that variants already carry as an
  // attribute value would make that value unrenderable on every historic order line,
  // so this is a status flip with no reference check — the template stays resolvable.
  template.status = false;
  await template.save();
  return template;
};

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  removeCategory,
  listSubcategories,
  createSubcategory,
  updateSubcategory,
  removeSubcategory,
  listBrands,
  createBrand,
  updateBrand,
  removeBrand,
  addBrandCertification,
  reviewBrandCertification,
  expireBrandCertifications,
  mergeBrand,
  listAttributeTemplates,
  createAttributeTemplate,
  updateAttributeTemplate,
  removeAttributeTemplate,
  slugify,
};