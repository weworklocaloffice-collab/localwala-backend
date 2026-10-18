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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const {
  DairyCategory,
  DairySubCategory,
  DairyBrand,
  DairyProduct,
  DairySku,
  Business,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');

/**
 * Catalogue services for the four-level hierarchy:
 *
 *   Category → SubCategory → Product → Pack Size (SKU)
 *
 * The taxonomy above Product is platform-wide and shared; Product and SKU are
 * per-outlet, so each outlet curates its own list with its own price and stock.
 */

const paginate = (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  return { limit, page, skip: (page - 1) * limit };
};

// //// Categories ////

const createCategory = async (param) => {
  const existing = await DairyCategory.findOne({ key: param.key });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Category key already exists');
  }
  return DairyCategory.create(param);
};

const listCategories = async (options) => {
  const { limit, page, skip } = paginate(options);

  const query = { status: true };
  if (options.featured !== undefined) {
    query.featured = options.featured === 'true' || options.featured === true;
  }

  const [categories, totalResults] = await Promise.all([
    DairyCategory.find(query).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(limit),
    DairyCategory.countDocuments(query),
  ]);

  return { categories, totalResults, page, limit };
};

const updateCategory = async (id, param) => {
  const category = await DairyCategory.findById(id);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(category, param);
  await category.save();
  return category;
};

/**
 * Deleting a category with children would orphan the subtree, so it is blocked
 * rather than cascading silently.
 */
const deleteCategory = async (id) => {
  const category = await DairyCategory.findById(id);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const [subs, products] = await Promise.all([
    DairySubCategory.countDocuments({ category: category._id }),
    DairyProduct.countDocuments({ category: category._id }),
  ]);

  if (subs > 0 || products > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot delete: ${subs} sub-categor(ies) and ${products} product(s) still reference this category`
    );
  }

  await category.deleteOne();
  return category;
};

// //// Sub-categories ////

const createSubCategory = async (param) => {
  const category = await DairyCategory.findById(param.category);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }
  return DairySubCategory.create(param);
};

const listSubCategories = async (options) => {
  const { limit, page, skip } = paginate(options);

  const query = { status: true };
  if (options.category) {
    query.category = new mongoose.Types.ObjectId(options.category);
  }

  const [subCategories, totalResults] = await Promise.all([
    DairySubCategory.find(query)
      .populate('category', 'name key slug image')
      .sort({ sortOrder: 1, name: 1 })
      .skip(skip)
      .limit(limit),
    DairySubCategory.countDocuments(query),
  ]);

  return { subCategories, totalResults, page, limit };
};

const updateSubCategory = async (id, param) => {
  const subCategory = await DairySubCategory.findById(id);
  if (!subCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(subCategory, param);
  await subCategory.save();
  return subCategory;
};

const deleteSubCategory = async (id) => {
  const subCategory = await DairySubCategory.findById(id);
  if (!subCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const products = await DairyProduct.countDocuments({ subCategory: subCategory._id });
  if (products > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot delete: ${products} product(s) still reference this sub-category`
    );
  }
  await subCategory.deleteOne();
  return subCategory;
};

// //// Brands ////

const createBrand = async (param) => {
  return DairyBrand.create(param);
};

const listBrands = async (options) => {
  const { limit, page, skip } = paginate(options);
  const query = { status: true };

  const [brands, totalResults] = await Promise.all([
    DairyBrand.find(query).sort({ sortOrder: 1, name: 1 }).skip(skip).limit(limit),
    DairyBrand.countDocuments(query),
  ]);

  return { brands, totalResults, page, limit };
};

const updateBrand = async (id, param) => {
  const brand = await DairyBrand.findById(id);
  if (!brand) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(brand, param);
  await brand.save();
  return brand;
};

/**
 * Removes a brand, but only while nothing references it.
 *
 * Hard delete, matching `deleteCategory` and `deleteSubCategory` rather than
 * inventing a second deletion style for the same screen. A brand is only ever
 * referenced by a product, so that is the one count worth taking.
 *
 * The guard is the point: without it, deleting a brand would leave products
 * pointing at an id that no longer resolves, and a catalog row that reports a
 * brand it cannot name.
 */
const deleteBrand = async (id) => {
  const brand = await DairyBrand.findById(id);
  if (!brand) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const products = await DairyProduct.countDocuments({ brand: brand._id });
  if (products > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot delete: ${products} product(s) still reference this brand`
    );
  }

  await brand.deleteOne();
  return brand;
};

// //// Products ////

/**
 * Validates that the sub-category actually belongs to the category, so a product
 * can never sit under a mismatched pair.
 */
const assertCategoryPair = async (categoryId, subCategoryId) => {
  if (!subCategoryId) return;
  const subCategory = await DairySubCategory.findById(subCategoryId).select('category');
  if (!subCategory) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Sub-category not found');
  }
  if (subCategory.category.toString() !== new mongoose.Types.ObjectId(categoryId).toString()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Sub-category does not belong to the given category');
  }
};

const createProduct = async (param) => {
  const business = await Business.findById(param.business);
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  }
  await assertCategoryPair(param.category, param.subCategory);

  let subCategoryName;
  if (param.subCategory) {
    const sub = await DairySubCategory.findById(param.subCategory).select('name');
    subCategoryName = sub ? sub.name : undefined;
  }

  return DairyProduct.create({ ...param, subCategoryName });
};

const listProducts = async (options) => {
  const { limit, page, skip } = paginate(options);

  const query = { status: true };

  if (options.business) {
    query.business = new mongoose.Types.ObjectId(options.business);
  }
  if (options.category) {
    query.category = new mongoose.Types.ObjectId(options.category);
  }
  if (options.subCategory) {
    query.subCategory = new mongoose.Types.ObjectId(options.subCategory);
  }
  if (options.brand) {
    query.brand = new mongoose.Types.ObjectId(options.brand);
  }
  // The two independent dimensions behind the flat sub-category list.
  if (options.fatLevel) {
    query['attributes.fatLevel'] = options.fatLevel;
  }
  if (options.milkType) {
    query['attributes.milkType'] = options.milkType;
  }
  if (options.variant) {
    query['attributes.variant'] = options.variant;
  }
  if (options.search) {
    query.name = { $regex: options.search, $options: 'i' };
  }

  const [products, totalResults] = await Promise.all([
    DairyProduct.find(query)
      .populate('category', 'name key slug')
      .populate('subCategory', 'name slug')
      .populate('brand', 'name slug logo')
      .sort({ sortOrder: 1, name: 1 })
      .skip(skip)
      .limit(limit),
    DairyProduct.countDocuments(query),
  ]);

  return { products, totalResults, page, limit };
};

/**
 * Product detail with its SKUs attached.
 *
 * Pack size is the purchasable unit: one product, several SKUs, each with its own
 * price and stock. Only in-stock SKUs are returned by default because showing an
 * unbuyable pack size is noise on a storefront.
 */
const getProductDetail = async (id, options, business) => {
  // `business` is only supplied on partner routes; the public storefront passes
  // nothing and sees every product.
  const filter = { _id: id };
  if (business) {
    filter.business = new mongoose.Types.ObjectId(business);
  }

  const product = await DairyProduct.findOne(filter)
    .populate('category', 'name key slug')
    .populate('subCategory', 'name slug')
    .populate('brand', 'name slug logo');

  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }

  const skuQuery = { product: product._id, status: true };
  if (!options.includeOutOfStock) {
    skuQuery.inStock = true;
  }

  const skus = await DairySku.find(skuQuery).sort({ 'packSize.quantity': 1 });

  return { product, skus };
};

/**
 * Loads a record, but only if it belongs to `business`.
 *
 * Partner routes name a product or SKU in the path while the outlet itself
 * comes from the token. Looking the record up by id alone would let a partner
 * pass another outlet's id and edit it, so the outlet is part of the lookup
 * rather than a check afterwards. A record owned by someone else is reported as
 * "not found" so the endpoint does not confirm that it exists.
 *
 * @param {Model} model DairyProduct or DairySku
 * @param {string} id record id
 * @param {string} [business] outlet the caller is acting for
 * @param {string} label used in the error message
 * @returns {Promise<Document>}
 */
const findOwned = async (model, id, business, label) => {
  const filter = { _id: id };
  if (business) {
    filter.business = new mongoose.Types.ObjectId(business);
  }
  const record = await model.findOne(filter);
  if (!record) {
    throw new ApiError(httpStatus.NOT_FOUND, `${label} not found`);
  }
  return record;
};

const updateProduct = async (id, param, business) => {
  const product = await findOwned(DairyProduct, id, business, 'Product');
  if (param.category || param.subCategory) {
    await assertCategoryPair(param.category || product.category, param.subCategory ?? product.subCategory);
  }

  Object.assign(product, param);
  await product.save();

  // Keep the denormalised label in step.
  if (product.subCategory) {
    const sub = await DairySubCategory.findById(product.subCategory).select('name');
    if (sub) {
      product.subCategoryName = sub.name;
      await product.save();
    }
  }

  return product;
};

const deleteProduct = async (id, business) => {
  const product = await findOwned(DairyProduct, id, business, 'Product');
  const skus = await DairySku.countDocuments({ product: product._id });
  if (skus > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot delete: ${skus} pack size(s) still reference this product`
    );
  }
  await product.deleteOne();
  return product;
};

// //// SKUs ////

const createSku = async (param) => {
  const product = await DairyProduct.findById(param.product);
  if (!product) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  }

  const business = param.business || product.business;

  return DairySku.create({
    ...param,
    business: new mongoose.Types.ObjectId(business),
    category: product.category,
    subCategory: product.subCategory,
    brand: product.brand,
  });
};

/**
 * Adjusts stock, recording the delta rather than overwriting.
 *
 * Accepting an absolute figure would let a typo silently delete a day's stock,
 * and there is no audit trail to reconstruct it from.
 */
const adjustSkuStock = async (id, param, business) => {
  const sku = await findOwned(DairySku, id, business, 'SKU');

  const next = sku.availableQty + param.delta;
  if (next < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Stock cannot go negative (would be ${next})`);
  }

  sku.availableQty = next;
  sku.inStock = next > 0;
  await sku.save();

  return sku;
};

const listSkus = async (options) => {
  const { limit, page, skip } = paginate(options);

  const query = { status: true };
  if (options.business) {
    query.business = new mongoose.Types.ObjectId(options.business);
  }
  if (options.product) {
    query.product = new mongoose.Types.ObjectId(options.product);
  }
  if (options.inStock !== undefined) {
    query.inStock = options.inStock === 'true' || options.inStock === true;
  }
  if (options.reusableContainer !== undefined) {
    query.reusableContainer = options.reusableContainer === 'true' || options.reusableContainer === true;
  }

  const [skus, totalResults] = await Promise.all([
    DairySku.find(query)
      .populate('product', 'name slug')
      .populate('brand', 'name slug')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit),
    DairySku.countDocuments(query),
  ]);

  return { skus, totalResults, page, limit };
};

const updateSku = async (id, param, business) => {
  const sku = await findOwned(DairySku, id, business, 'SKU');
  Object.assign(sku, param);
  await sku.save();
  return sku;
};

// //// Tree / browse ////

/**
 * The full category tree with counts, for the customer app's browse screen.
 *
 * Counts are aggregated once rather than per node — a naive per-category count
 * would issue 40+ queries to render one screen.
 *
 * @param {Object} options
 */
const getCategoryTree = async (options) => {
  const businessId = options.business ? new mongoose.Types.ObjectId(options.business) : null;

  const matchProduct = { status: true };
  if (businessId) {
    matchProduct.business = businessId;
  }

  const [categories, subs, productCounts, skuCounts] = await Promise.all([
    DairyCategory.find({ status: true }).sort({ sortOrder: 1, name: 1 }).lean(),
    DairySubCategory.find({ status: true }).lean(),
    DairyProduct.aggregate([
      { $match: matchProduct },
      { $group: { _id: { category: '$category', subCategory: '$subCategory' }, count: { $sum: 1 } } },
    ]),
    DairySku.aggregate([
      { $match: businessId ? { business: businessId, status: true } : { status: true } },
      { $group: { _id: '$product', count: { $sum: 1 }, inStock: { $sum: { $cond: ['$inStock', 1, 0] } } } },
    ]),
  ]);

  const skuByProduct = new Map(skuCounts.map((s) => [s._id.toString(), s]));

  const productCountFor = (categoryId, subCategoryId) => {
    return productCounts
      .filter((p) => {
        const c = p._id.category ? p._id.category.toString() : null;
        const s = p._id.subCategory ? p._id.subCategory.toString() : null;
        if (c !== categoryId.toString()) return false;
        // A product with no sub-category still counts toward its category.
        if (!subCategoryId) return true;
        return s === subCategoryId.toString();
      })
      .reduce((sum, p) => sum + p.count, 0);
  };

  const tree = categories.map((category) => {
    const children = subs
      .filter((s) => s.category && s.category.toString() === category._id.toString())
      .map((sub) => ({
        _id: sub._id,
        name: sub.name,
        slug: sub.slug,
        image: sub.image,
        productCount: productCountFor(category._id, sub._id),
      }));

    return {
      _id: category._id,
      key: category.key,
      name: category.name,
      slug: category.slug,
      image: category.image,
      icon: category.icon,
      productCount: productCountFor(category._id, null),
      subCategories: children,
    };
  });

  return { categories: tree, skuIndex: Array.from(skuByProduct.entries()) };
};

/**
 * Faceted search: products matching the filters, plus the counts a customer needs
 * to see which filters are still worth applying.
 *
 * @param {Object} options
 */
const searchProducts = async (options) => {
  const { limit, page, skip } = paginate(options);

  const query = { status: true };
  if (options.business) {
    query.business = new mongoose.Types.ObjectId(options.business);
  }
  if (options.category) query.category = new mongoose.Types.ObjectId(options.category);
  if (options.subCategory) query.subCategory = new mongoose.Types.ObjectId(options.subCategory);
  if (options.brand) query.brand = new mongoose.Types.ObjectId(options.brand);
  if (options.fatLevel) query['attributes.fatLevel'] = options.fatLevel;
  if (options.milkType) query['attributes.milkType'] = options.milkType;
  if (options.search) query.name = { $regex: options.search, $options: 'i' };

  // Price range is a SKU-level filter, so products are filtered by having at
  // least one SKU inside the band rather than by a product-level price.
  //
  // IMPORTANT: callers send RUPEES but `DairySku.price` is stored in paise
  // (rupees-in setter, paise-out getter). Querying with the raw input compares
  // rupees against paise and silently returns the wrong rows, so the bounds are
  // converted here. Same trap as every money field in this codebase.
  if (options.minPrice !== undefined || options.maxPrice !== undefined) {
    const skuMatch = { product: { $exists: true }, status: true };
    if (options.business) skuMatch.business = new mongoose.Types.ObjectId(options.business);
    if (options.minPrice !== undefined) skuMatch.price = { $gte: Math.round(options.minPrice * 100) };
    if (options.maxPrice !== undefined) {
      skuMatch.price = { ...(skuMatch.price || {}), $lte: Math.round(options.maxPrice * 100) };
    }

    const matching = await DairySku.find(skuMatch).distinct('product');
    query._id = { $in: matching };
  }

  const [products, totalResults] = await Promise.all([
    DairyProduct.find(query)
      .populate('category', 'name key slug')
      .populate('subCategory', 'name slug')
      .populate('brand', 'name slug logo')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit),
    DairyProduct.countDocuments(query),
  ]);

  // Attach the buyable pack sizes so the results screen can render without a
  // second round trip per product.
  const productIds = products.map((p) => p._id);
  const skus = productIds.length
    ? await DairySku.find({ product: { $in: productIds }, status: true, inStock: true }).sort({ 'packSize.quantity': 1 })
    : [];

  const skusByProduct = skus.reduce((acc, sku) => {
    const key = sku.product.toString();
    acc[key] = acc[key] || [];
    acc[key].push(sku);
    return acc;
  }, {});

  return {
    products: products.map((p) => ({ ...p.toJSON(), skus: skusByProduct[p._id.toString()] || [] })),
    totalResults,
    page,
    limit,
  };
};

/**
 * Bulk-imports products for one outlet, used by the import/export engine.
 */
const importProducts = async (businessId, rows) => {
  const business = await Business.findById(businessId);
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    const exists = await DairyProduct.findOne({ business: business._id, name: row.name });
    if (exists) {
      skipped += 1;
      continue;
    }
    await createProduct({ ...row, business: business._id });
    created += 1;
  }

  return { created, skipped };
};

/**
 * Consistency check across the tree, surfaced on the admin dashboard so a bad
 * import is caught rather than showing as an empty category to customers.
 */
const getCatalogHealth = async () => {
  const [products, skus] = await Promise.all([
    DairyProduct.find({ status: true }).select('_id category subCategory').lean(),
    DairySku.find({ status: true }).select('_id product').lean(),
  ]);

  const orphanProductSku = products.filter((p) => !p.category).length;
  const skusWithoutProduct = skus.filter((s) => !s.product).length;
  const productsWithoutSku = new Set(
    products.map((p) => p._id.toString()).filter((id) => !skus.some((s) => s.product && s.product.toString() === id))
  ).size;

  return {
    totalCategories: await DairyCategory.countDocuments({ status: true }),
    totalSubCategories: await DairySubCategory.countDocuments({ status: true }),
    totalProducts: products.length,
    totalSkus: skus.length,
    orphanProductSku,
    skusWithoutProduct,
    productsWithoutSku,
  };
};

module.exports = {
  createCategory,
  listCategories,
  updateCategory,
  deleteCategory,
  createSubCategory,
  listSubCategories,
  updateSubCategory,
  deleteSubCategory,
  createBrand,
  listBrands,
  updateBrand,
  deleteBrand,
  createProduct,
  listProducts,
  getProductDetail,
  updateProduct,
  deleteProduct,
  createSku,
  adjustSkuStock,
  listSkus,
  updateSku,
  getCategoryTree,
  searchProducts,
  importProducts,
  getCatalogHealth,
};