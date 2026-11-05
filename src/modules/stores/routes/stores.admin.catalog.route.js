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

const express = require('express');
const validate = require('../../../middlewares/validate');
const webAuth = require('../../../middlewares/webAuth');
const controller = require('../controllers/stores.admin.taxonomy.controller');
const importController = require('../controllers/stores.admin.taxonomy.import.controller');
const brandRequestController = require('../controllers/stores.brand.request.controller');
const productsController = require('../controllers/stores.catalog.controller');
const inventoryController = require('../controllers/stores.inventory.controller');
const V = require('../validations/stores.admin.validation');
// Product/inventory reads are cross-tenant but their query shape is identical to the
// partner one, so the partner schemas are reused rather than duplicated. They live on
// the partner module, not on the admin module - referencing them through `V` left five
// routes with `validate(undefined)`, which the middleware silently skipped.
const catalogV = require('../validations/stores.validation');

const router = express.Router();

/**
 * Admin taxonomy CRUD. Mounted at `/v1/admin/stores/catalog`.
 *
 * ## Two rights, not one
 *
 * `stores_taxonomy_read` gates the lists and `stores_taxonomy_write` gates the writes.
 * A support agent who needs to read the category tree to diagnose a partner's wrong
 * product should not thereby gain the ability to create a category that every store's
 * product form will then be generated from. Read and write are separate capabilities
 * here for the same reason they are on the partner side.
 *
 * The names are reused from the existing admin role rather than invented for this file.
 * `config/roles.js` already declared `stores_taxonomy_read` / `stores_taxonomy_write` for
 * exactly this purpose, so new strings would have been a second vocabulary for one job.
 *
 * ## Ordering
 *
 * Literal `:id` segments are declared once, at the end of each block. There are no
 * literal siblings here, so ordering is not a hazard in this file — but the pattern is
 * kept so a future `GET /categories/tree` is appended above, not below, by habit.
 */

// -- taxonomy import / export -------------------------------------------------

/**
 * A file is a batch write, so it needs `stores_taxonomy_write`; the export is a read of
 * the same rows the lists expose, so it needs only `stores_taxonomy_read`. Keeping the
 * collection in the path lets one handler serve all three without a body flag that a
 * caller could point at a model name.
 */
router
  .route('/import/:collection')
  .post(
    webAuth('stores_taxonomy_write'),
    validate(V.taxonomyCollection),
    importController.importCollection
  );

router
  .route('/export/:collection')
  .get(
    webAuth('stores_taxonomy_read'),
    validate(V.taxonomyExport),
    importController.exportCollection
  );

// -- categories ---------------------------------------------------------------

router
  .route('/categories')
  .get(webAuth('stores_taxonomy_read'), validate(V.adminList), controller.listCategories)
  .post(webAuth('stores_taxonomy_write'), validate(V.categoryCreate), controller.createCategory);

router
  .route('/categories/:category')
  .patch(webAuth('stores_taxonomy_write'), validate(V.categoryUpdate), validate(V.categoryId), controller.updateCategory)
  /**
   * DELETE is archive-not-delete, and the service refuses while a subcategory or product
   * still points at the row. The name is kept because the verb is what a client expects;
   * the behaviour is documented here and in the service, because a DELETE that does not
   * delete is a surprise otherwise.
   */
  .delete(webAuth('stores_taxonomy_write'), validate(V.categoryId), controller.removeCategory);

// -- subcategories ------------------------------------------------------------

router
  .route('/subcategories')
  .get(webAuth('stores_taxonomy_read'), validate(V.subcategoryList), controller.listSubcategories)
  .post(webAuth('stores_taxonomy_write'), validate(V.subcategoryCreate), controller.createSubcategory);

router
  .route('/subcategories/:subcategory')
  .patch(webAuth('stores_taxonomy_write'), validate(V.subcategoryUpdate), validate(V.subcategoryId), controller.updateSubcategory)
  .delete(webAuth('stores_taxonomy_write'), validate(V.subcategoryId), controller.removeSubcategory);

// -- brands -------------------------------------------------------------------

router
  .route('/brands')
  .get(webAuth('stores_taxonomy_read'), validate(V.brandList), controller.listBrands)
  .post(webAuth('stores_taxonomy_write'), validate(V.brandCreate), controller.createBrand);

router
  .route('/brands/:brand')
  .patch(webAuth('stores_taxonomy_write'), validate(V.brandUpdate), validate(V.brandId), controller.updateBrand)
  .delete(webAuth('stores_taxonomy_write'), validate(V.brandId), controller.removeBrand);

router.post(
  '/brands/:brand/certifications',
  webAuth('stores_taxonomy_write'),
  validate(V.brandCertificationCreate),
  controller.addBrandCertification
);

router.patch(
  '/brands/:brand/certifications/:index',
  webAuth('stores_taxonomy_write'),
  validate(V.brandCertificationReview),
  controller.reviewBrandCertification
);

router.post(
  '/brands/:brand/merge',
  webAuth('stores_taxonomy_write'),
  validate(V.brandMerge),
  controller.mergeBrand
);

// -- brand requests -----------------------------------------------------------

router
  .route('/brand-requests')
  .get(
    webAuth('stores_taxonomy_read'),
    validate(V.brandRequestList),
    brandRequestController.adminListRequests
  );

router
  .route('/brand-requests/:request')
  .patch(
    webAuth('stores_taxonomy_write'),
    validate(V.brandRequestReview),
    brandRequestController.reviewRequest
  );

// -- attribute templates ------------------------------------------------------

router
  .route('/attribute-templates')
  .get(webAuth('stores_taxonomy_read'), validate(V.adminList), controller.listAttributeTemplates)
  .post(webAuth('stores_taxonomy_write'), validate(V.attributeTemplateCreate), controller.createAttributeTemplate);

router
  .route('/attribute-templates/:template')
  .patch(webAuth('stores_taxonomy_write'), validate(V.attributeTemplateUpdate), validate(V.attributeTemplateId), controller.updateAttributeTemplate)
  .delete(webAuth('stores_taxonomy_write'), validate(V.attributeTemplateId), controller.removeAttributeTemplate);

// -- products (admin read + approval) ----------------------------------------
//
// Admin product reads are CROSS-TENANT: an admin investigating a dispute needs
// the product regardless of which chain it belongs to. The partner-facing
// routes in stores.catalog.route.js are tenant-scoped (BR-38); the admin reads
// are deliberately not.
//
// Approval gate: when a chain has `productApprovalRequired` on, a new product
// lands in `approval.status = 'pending'`. Admin approves or rejects here.
// Approve flips `approval.status` to 'approved' AND sets `status = 'active'`.

router.get(
  '/products',
  webAuth('stores_taxonomy_read'),
  validate(catalogV.productAdminList),
  productsController.listProducts
);

router.get(
  '/products/:product',
  webAuth('stores_taxonomy_read'),
  productsController.getProduct
);

/**
 * Product approval is a one-step state change. PATCH is the right verb: the
 * resource already exists, we are flipping one field. The service enforces
 * the from/to transition table; the route is a thin wrapper.
 */
router.patch(
  '/products/:product/approval',
  webAuth('stores_taxonomy_write'),
  validate(catalogV.productApproval),
  productsController.approveProduct
);

// -- inventory (admin read) -------------------------------------------------
//
// Admin inventory reads are cross-tenant too. No mutation: inventory writes
// must revalidate outlet scope (BR-38), which is service work on the partner
// side. The inventory-drift console is the admin's operational surface.

router.get(
  '/inventory/stock',
  webAuth('stores_taxonomy_read'),
  validate(catalogV.inventoryStockList),
  inventoryController.getStockForOutlet
);

router.get(
  '/inventory/stock/low',
  webAuth('stores_taxonomy_read'),
  validate(catalogV.inventoryStockList),
  inventoryController.getLowStockItems
);

router.get(
  '/inventory/movements',
  webAuth('stores_taxonomy_read'),
  validate(catalogV.inventoryMovementList),
  inventoryController.getMovements
);

module.exports = router;