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

const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const dairyCatalogService = require('../services/dairy.catalog.service');

// //// Categories ////

const categoryCreate = catchAsync(async (req, res) => {
  const category = await dairyCatalogService.createCategory(req.body);
  res.send({ category });
});

const categoryList = catchAsync(async (req, res) => {
  const result = await dairyCatalogService.listCategories(req.query);
  res.send(pick(result, ['categories', 'totalResults', 'page', 'limit']));
});

const categoryUpdate = catchAsync(async (req, res) => {
  const category = await dairyCatalogService.updateCategory(req.params.id, req.body);
  res.send({ category });
});

const categoryDelete = catchAsync(async (req, res) => {
  const category = await dairyCatalogService.deleteCategory(req.params.id);
  res.send({ category });
});

// //// Sub-categories ////

const subCategoryCreate = catchAsync(async (req, res) => {
  const subCategory = await dairyCatalogService.createSubCategory(req.body);
  res.send({ subCategory });
});

const subCategoryList = catchAsync(async (req, res) => {
  const result = await dairyCatalogService.listSubCategories(req.query);
  res.send(pick(result, ['subCategories', 'totalResults', 'page', 'limit']));
});

const subCategoryUpdate = catchAsync(async (req, res) => {
  const subCategory = await dairyCatalogService.updateSubCategory(req.params.id, req.body);
  res.send({ subCategory });
});

const subCategoryDelete = catchAsync(async (req, res) => {
  const subCategory = await dairyCatalogService.deleteSubCategory(req.params.id);
  res.send({ subCategory });
});

// //// Brands ////

const brandCreate = catchAsync(async (req, res) => {
  const brand = await dairyCatalogService.createBrand(req.body);
  res.send({ brand });
});

const brandList = catchAsync(async (req, res) => {
  const result = await dairyCatalogService.listBrands(req.query);
  res.send(pick(result, ['brands', 'totalResults', 'page', 'limit']));
});

const brandUpdate = catchAsync(async (req, res) => {
  const brand = await dairyCatalogService.updateBrand(req.params.id, req.body);
  res.send({ brand });
});

/**
 * Removes a brand, unless a product still references it.
 *
 * The refusal comes from the service, which counts the products — so the same
 * answer comes back whether the caller is the admin screen or a script.
 */
const brandDelete = catchAsync(async (req, res) => {
  const brand = await dairyCatalogService.deleteBrand(req.params.id);
  res.send({ brand });
});

// //// Products ////

const productCreate = catchAsync(async (req, res) => {
  const product = await dairyCatalogService.createProduct(req.body);
  res.send({ product });
});

const productList = catchAsync(async (req, res) => {
  const result = await dairyCatalogService.listProducts(req.query);
  res.send(pick(result, ['products', 'totalResults', 'page', 'limit']));
});

const productDetail = catchAsync(async (req, res) => {
  const result = await dairyCatalogService.getProductDetail(req.params.id, req.query);
  res.send(result);
});

const productUpdate = catchAsync(async (req, res) => {
    const product = await dairyCatalogService.updateProduct(req.params.id, req.body, req.outletId);
    res.send({ product });
  });
  
  const productDelete = catchAsync(async (req, res) => {
    const product = await dairyCatalogService.deleteProduct(req.params.id, req.outletId);
    res.send({ product });
  });

/** Faceted search for the customer app's browse and search screens. */
const productSearch = catchAsync(async (req, res) => {
  const result = await dairyCatalogService.searchProducts(req.query);
  res.send(pick(result, ['products', 'totalResults', 'page', 'limit']));
});

// //// SKUs ////

const skuCreate = catchAsync(async (req, res) => {
  const sku = await dairyCatalogService.createSku(req.body);
  res.send({ sku });
});

const skuList = catchAsync(async (req, res) => {
    const result = await dairyCatalogService.listSkus({
      ...req.query,
      // Last write wins, so a `?business=` in the query cannot widen the list
      // beyond the outlet the token identifies.
      business: req.outletId,
    });
    res.send(pick(result, ['skus', 'totalResults', 'page', 'limit']));
  });

const skuUpdate = catchAsync(async (req, res) => {
    const sku = await dairyCatalogService.updateSku(req.params.id, req.body, req.outletId);
    res.send({ sku });
  });
  
  const stockAdjust = catchAsync(async (req, res) => {
    const sku = await dairyCatalogService.adjustSkuStock(req.params.id, req.body, req.outletId);
    res.send({ sku });
  });

// //// Tree, import, health ////

/** Category tree with counts, for the customer browse screen. */
const categoryTree = catchAsync(async (req, res) => {
  const tree = await dairyCatalogService.getCategoryTree(req.query);
  res.send({ categories: tree.categories });
});

const importProducts = catchAsync(async (req, res) => {
  const result = await dairyCatalogService.importProducts(req.outletId, req.body.products);
  res.send(result);
});

/**
 * Consistency report for the admin dashboard — catches a bad import showing up
 * as an empty category rather than a hard failure at browse time.
 */
const catalogHealth = catchAsync(async (req, res) => {
  const health = await dairyCatalogService.getCatalogHealth();
  res.send({ health });
});

module.exports = {
  categoryCreate,
  categoryList,
  categoryUpdate,
  categoryDelete,
  subCategoryCreate,
  subCategoryList,
  subCategoryUpdate,
  subCategoryDelete,
  brandCreate,
  brandList,
  brandUpdate,
  brandDelete,
  productCreate,
  productList,
  productDetail,
  productUpdate,
  productDelete,
  productSearch,
  skuCreate,
  skuList,
  skuUpdate,
  stockAdjust,
  categoryTree,
  importProducts,
  catalogHealth,
};