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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const slugify = (value) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/\s/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const generateSku = (outletCode, productCode, variantCode) =>
  `${outletCode}-${productCode}-${variantCode}`.toUpperCase();

const listProducts = async ({ outlet, chain, category, subcategory, brand, search, facetKeys, inStockOnly, organicOnly, page = 1, limit = 20, sort = 'name' }) => {
  const ChainProduct = mongoose.model('ChainProduct');
  const filter = { status: 'active' };
  if (chain) filter.chain = chain;
  if (category) filter.category = category;
  if (subcategory) filter.subcategory = subcategory;
  if (brand) filter.brand = brand;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }
  if (facetKeys && facetKeys.length) {
    filter.facetKeys = { $all: facetKeys };
  }
  if (organicOnly) filter.isOrganic = true;

  const sortMap = {
    name: { name: 1 },
    newest: { createdAt: -1 },
    price_asc: { 'variants.price': 1 },
    price_desc: { 'variants.price': -1 },
  };

  const [items, total] = await Promise.all([
    ChainProduct.find(filter)
      .sort(sortMap[sort] || sortMap.name)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('category', 'name slug')
      .populate('subcategory', 'name slug')
      .lean(),
    ChainProduct.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

/**
 * A product with its VARIANTS attached.
 *
 * Variants live in their own collection (`ChainProductVariant`, keyed by `product`), not
 * as an array on `ChainProduct`, so `.populate('variants')` is not an option — there is no
 * such path to populate. They are fetched alongside and attached.
 *
 * This is what makes the customer cart reachable at all. `POST /cart/add` and
 * `POST /orders` both require a `variant` ObjectId per line, and before this returned
 * them no customer-facing route exposed a single variant id — `GET /products/:product`
 * and `GET /:store/products` both returned products with no way to learn what to send.
 * A client could not construct a valid request for ANY product, simple or multi-variant.
 *
 * Only `active` variants are returned, and the list is sorted by name so the default the
 * app shows first is stable rather than dependent on insertion order. The price shown is
 * the CHAIN's; what the customer actually pays is the outlet's, recomputed server-side by
 * `resolveBasket` (BR-36), and that is still the figure that decides the order.
 */
const getProduct = async (productId) => {
  const ChainProduct = mongoose.model('ChainProduct');
  const ChainProductVariant = mongoose.model('ChainProductVariant');
  const product = await ChainProduct.findById(productId)
    .populate('category', 'name slug')
    .populate('subcategory', 'name slug')
    .populate('brand', 'name slug logo')
    .lean();
  if (!product) throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');

  const variants = await ChainProductVariant.find({ product: product._id, status: 'active' })
    .select('name sku price compareAtPrice facetKeys image images status')
    .sort({ name: 1 })
    .lean();

  return { ...product, variants };
};

const createProduct = async ({ chain, category, subcategory, brand, name, slug, description, images, hasVariants, variantAxes, basePrice, baseMrp, tax, taxPercentage, hsn, tags, searchTerms, isOrganic, warranty, createdBy }) => {
  const ChainProduct = mongoose.model('ChainProduct');
  const product = await ChainProduct.create({
    chain,
    category,
    subcategory,
    brand,
    name,
    slug: slug || slugify(name),
    description,
    images: images || [],
    hasVariants: hasVariants || false,
    variantAxes: variantAxes || [],
    basePrice,
    baseMrp,
    tax: tax || 'inclusive',
    taxPercentage: taxPercentage || 0,
    hsn,
    tags: tags || [],
    searchTerms: searchTerms || [],
    isOrganic: isOrganic || false,
    warranty,
    status: 'active',
    createdBy,
  });
  return product;
};

const updateProduct = async (productId, updates) => {
  const ChainProduct = mongoose.model('ChainProduct');
  const product = await ChainProduct.findById(productId);
  if (!product) throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');

  const allowed = ['name', 'description', 'images', 'hasVariants', 'variantAxes', 'basePrice', 'baseMrp', 'tax', 'taxPercentage', 'hsn', 'tags', 'searchTerms', 'isOrganic', 'warranty', 'status'];
  for (const key of allowed) {
    if (updates[key] !== undefined) product[key] = updates[key];
  }
  if (updates.name && !updates.slug) product.slug = slugify(updates.name);

  await product.save();
  return product;
};

/**
 * Archive a product. NEVER deletes (BR-25).
 *
 * Named `deleteProduct` for the route it serves, but it archives and stamps the audit
 * fields. A hard delete here would orphan every order line that referenced it, and those
 * lines are the reason BR-25 exists.
 */
const deleteProduct = async (productId, { by, reason } = {}) => {
  const ChainProduct = mongoose.model('ChainProduct');
  const archived = await ChainProduct.archive(productId, { by, reason });
  if (!archived) throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  return archived;
};

const generateVariants = async ({ product, selections, priceMatrix, combinationLimit = 200 }) => {
  const ChainProductVariant = mongoose.model('ChainProductVariant');
  const axes = Object.keys(selections);
  const combinations = cartesianProduct(selections);

  if (combinations.length > combinationLimit) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `COMBINATION_LIMIT_EXCEEDED: ${combinations.length} combinations exceeds limit of ${combinationLimit}`);
  }

  const results = { created: [], existing: [] };

  for (const combo of combinations) {
    const facetKeys = axes.map((axis) => `${axis}:${combo[axis]}`);
    const name = axes.map((axis) => combo[axis]).join(' / ');
    const price = priceMatrix?.[name] || product.basePrice || 0;

    const existing = await ChainProductVariant.findOne({
      product: product._id,
      facetKeys: { $all: facetKeys },
    });

    if (existing) {
      results.existing.push(existing);
    } else {
      const variant = await ChainProductVariant.create({
        product: product._id,
        chain: product.chain,
        // SKU must be unique per COMBINATION, not per first axis.
//
// It used `combo[axes[0]]`, so a two-axis product (size x colour) produced one SKU per
// size: "M / Black" and "M / White" both became "...-M" and the unique {chain, sku} index
// threw E11000 on the second insert. Any product with more than one variant axis could
// therefore never be generated at all.
//
// Deriving from the full facet set keeps the SKU deterministic, unique per combination and
// readable on a shelf label: "...-SIZE:M|COLOR:BLACK".
sku: generateSku(
          product.chain?.toString().slice(-4) || 'STORE',
          product._id.toString().slice(-4),
          facetKeys.join('|')
        ),
        name,
        price,
        priceInPaise: Math.round(price * 100),
        attributes: combo,
        facetKeys,
        status: 'active',
      });
      results.created.push(variant);
    }
  }

  return results;
};

const cartesianProduct = (selections) => {
  const axes = Object.keys(selections);
  if (axes.length === 0) return [{}];

  let result = [{}];
  for (const axis of axes) {
    const values = selections[axis];
    const next = [];
    for (const partial of result) {
      for (const value of values) {
        next.push({ ...partial, [axis]: value });
      }
    }
    result = next;
  }
  return result;
};

const getProductForm = async ({ category, subcategory }) => {
  const StoreSubcategory = mongoose.model('StoreSubcategory');
  const StoreAttributeTemplate = mongoose.model('StoreAttributeTemplate');

  const filter = {};
  if (subcategory) filter._id = subcategory;
  else if (category) filter.category = category;

  const sub = await StoreSubcategory.findOne(filter).lean();
  if (!sub) throw new ApiError(httpStatus.NOT_FOUND, 'Subcategory not found');

  const templates = await StoreAttributeTemplate.find({ status: true }).sort({ displayOrder: 1 }).lean();

  return {
    attributes: templates.map((t) => ({
      ...t,
      variantAxis: t.variantAxis || false,
    })),
    brand: { required: sub.categoryDefaults?.brandRequired || false },
    tax: { allowedTypes: ['inclusive', 'exclusive', 'none'], hsnRequired: sub.categoryDefaults?.hsnRequired || false },
    warranty: { required: sub.categoryDefaults?.warrantyRequired || false },
    variants: {
      axes: templates.filter((t) => t.variantAxis).map((t) => t.slug),
      combinationLimit: 200,
    },
  };
};

/**
 * Admin product approval (BR-09 / productApprovalRequired chains).
 *
 * Approving flips `approval.status` to 'approved' and, if the product was
 * awaiting approval, sets `status` to 'active' so the product is visible
 * to customers. Rejecting only changes the approval state — the partner
 * can still edit and resubmit.
 */
const approveProduct = async (productId, { status, by, note } = {}) => {
  if (!['approved', 'rejected'].includes(status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'approval status must be approved or rejected');
  }
  const ChainProduct = mongoose.model('ChainProduct');
  const product = await ChainProduct.findById(productId);
  if (!product) throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');

  product.approval = {
    status,
    by,
    at: new Date(),
    note: note || undefined,
  };
  // Approving a product that was waiting goes live. Rejecting does not
  // touch the catalogue status — the partner can revise and resubmit.
  if (status === 'approved' && product.status === 'active') {
    // already active; nothing to do
  } else if (status === 'approved') {
    product.status = 'active';
  }
  await product.save();
  return product;
};

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  generateVariants,
  getProductForm,
  slugify,
  generateSku,
};