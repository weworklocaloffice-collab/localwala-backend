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
const dairyInventoryLotService = require('../services/dairy.inventory.lot.service');

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
  // The authenticated outlet is authoritative; never trust an outlet id from
  // the app payload when creating a partner-owned catalogue item.
  const product = await dairyCatalogService.createProduct({
    ...req.body,
    business: req.outletId,
  });
  res.send({ product });
});

const productList = catchAsync(async (req, res) => {
  const result = await dairyCatalogService.listProducts(req.query);
  res.send(pick(result, ['products', 'totalResults', 'page', 'limit']));
});

const partnerProductList = catchAsync(async (req, res) => {
  const result = await dairyCatalogService.listProducts({
    ...req.query,
    business: req.outletId,
  });
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
  const result = await dairyCatalogService.searchProducts({
    ...req.query,
    userId: req.user?._id,
  });
  res.send(pick(result, ['products', 'totalResults', 'page', 'limit']));
});

// //// SKUs ////

const skuCreate = catchAsync(async (req, res) => {
  const sku = await dairyCatalogService.createSku(req.body, req.outletId);
  res.send({ sku });
});

const skuList = catchAsync(async (req, res) => {
    const result = await dairyCatalogService.listSkus({
      ...req.query,
      // Last write wins, so a `?business=` in the query cannot widen the list
      // beyond the outlet the token identifies.
      business: req.outletId,
      // The partner inventory editor must be able to restore an intentionally
      // paused SKU. Customer/catalog reads keep the active-only default.
      includeInactive: true,
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

const skuLots = catchAsync(async (req, res) => {
  const result = await dairyInventoryLotService.listLots(req.params.id, req.outletId);
  res.send(result);
});

const receiveSkuLot = catchAsync(async (req, res) => {
  const lot = await dairyInventoryLotService.receiveLot(req.params.id, req.outletId, req.body, req.user && req.user._id);
  res.status(201).send({ lot });
});

const writeOffSkuLot = catchAsync(async (req, res) => {
  const lot = await dairyInventoryLotService.writeOffLot(req.params.id, req.outletId, req.params.lot, req.body, req.user && req.user._id);
  res.send({ lot });
});

const setSkuLotDisposition = catchAsync(async (req, res) => {
  const lot = await dairyInventoryLotService.setLotDisposition(req.params.id, req.outletId, req.params.lot, req.body, req.user && req.user._id);
  res.send({ lot });
});

const inventoryMovements = catchAsync(async (req, res) => {
  res.send(await dairyInventoryLotService.listInventoryMovements({
    businessId: req.outletId,
    skuId: req.query.sku,
    lotId: req.query.lot,
    eventType: req.query.eventType,
    from: req.query.from,
    to: req.query.to,
    page: req.query.page,
    limit: req.query.limit,
  }));
});

const inventoryReport = catchAsync(async (req, res) => {
  res.send({ report: await dairyInventoryLotService.getInventoryReport({
    businessId: req.outletId,
    from: req.query.from,
    to: req.query.to,
  }) });
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

/** Public outlet profile for the customer app's outlet screen. */
const businessProfile = catchAsync(async (req, res) => {
  const business = await dairyCatalogService.getBusinessProfile(req.params.id);
  res.send(business);
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
  partnerProductList,
  productDetail,
  productUpdate,
  productDelete,
  productSearch,
  skuCreate,
  skuList,
  skuUpdate,
  stockAdjust,
  skuLots,
  receiveSkuLot,
  writeOffSkuLot,
  setSkuLotDisposition,
  inventoryMovements,
  inventoryReport,
  categoryTree,
  importProducts,
  catalogHealth,
  businessProfile,
};
