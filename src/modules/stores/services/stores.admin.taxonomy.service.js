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
  const slug = slugify(name);
  const existing = await StoreCategory.findOne({ slug });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'A category with this name already exists');

  // `key` allows only [a-z0-9_] but `slugify` writes hyphens. Deriving the key straight
  // from the slug made every create throw ValidationError, so no admin category could
  // ever be created. The slug keeps hyphens (it is URL-facing); the key takes underscores.
  return StoreCategory.create({
    key: slug.replace(/-/g, '_'),
    name,
    slug,
    icon: icon || 'tablerShoppingCart',
    sortOrder: sortOrder || 0,
    status: status === undefined ? true : status,
  });
};

const updateCategory = async (categoryId, updates = {}) => {
  const StoreCategory = mongoose.model('StoreCategory');
  const category = await StoreCategory.findById(categoryId);
  if (!category) throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');

  if (updates.name && updates.name !== category.name) {
    const slug = slugify(updates.name);
    const clash = await StoreCategory.findOne({ slug, _id: { $ne: category._id } });
    if (clash) throw new ApiError(httpStatus.CONFLICT, 'A category with this name already exists');
    category.slug = slug;
    category.key = slug;
  }
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
const createBrand = async ({ name, aliases, categories, originCountry, website, description, status } = {}) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const slug = slugify(name);
  const existing = await StoreBrand.findOne({ slug });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'A brand with this name already exists');

  if (status === 'approved' && (!categories || !categories.length)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'A brand cannot be approved without a category');
  }

  return StoreBrand.create({
    name,
    slug,
    aliases: aliases || [],
    categories: categories || [],
    originCountry,
    website,
    description,
    status: status || 'pending',
    isVerified: status === 'approved',
  });
};

const updateBrand = async (brandId, updates = {}) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const brand = await StoreBrand.findById(brandId);
  if (!brand) throw new ApiError(httpStatus.NOT_FOUND, 'Brand not found');

  if (updates.status === 'approved' && !(brand.categories || []).length) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'A brand cannot be approved without a category');
  }

  const allowed = ['name', 'aliases', 'categories', 'subcategories', 'originCountry', 'website', 'description', 'logo', 'banner', 'status', 'isVerified'];
  for (const key of allowed) {
    if (updates[key] !== undefined) brand[key] = updates[key];
  }

  await brand.save();
  return brand;
};

const removeBrand = async (brandId) => {
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
  await brand.save();
  return brand;
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
  listAttributeTemplates,
  createAttributeTemplate,
  updateAttributeTemplate,
  removeAttributeTemplate,
  slugify,
};