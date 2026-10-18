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
const controller = require('../controllers/ls.catalog.controller');
const V = require('../validations/ls.catalog.validation');

const router = express.Router();

const READ = 'localservices_catalog_read';
const WRITE = 'localservices_catalog_write';

router.route('/categories').post(webAuth(WRITE), validate(V.categoryBody), controller.createCategory).get(webAuth(READ), controller.listCategories);
router.route('/categories/:id').patch(webAuth(WRITE), validate(V.updateBody), controller.updateCategory);

router.route('/facets').post(webAuth(WRITE), validate(V.facetBody), controller.createFacet).get(webAuth(READ), controller.listFacets);
router.route('/facets/:id').patch(webAuth(WRITE), validate(V.updateBody), controller.updateFacet);

router.route('/services').post(webAuth(WRITE), validate(V.serviceBody), controller.createService).get(webAuth(READ), controller.listServices);
router.route('/services/:id').patch(webAuth(WRITE), validate(V.updateBody), controller.updateService);

router.route('/variants').post(webAuth(WRITE), validate(V.variantBody), controller.createVariant).get(webAuth(READ), controller.listVariants);
router.route('/variants/:id').patch(webAuth(WRITE), validate(V.updateBody), controller.updateVariant);

router.route('/templates').post(webAuth(WRITE), validate(V.templateBody), controller.createTemplate).get(webAuth(READ), controller.listTemplates);
router.route('/templates/:id').patch(webAuth(WRITE), validate(V.updateBody), controller.updateTemplate);

router.route('/addons').post(webAuth(WRITE), validate(V.addonBody), controller.createAddon).get(webAuth(READ), controller.listAddons);
router.route('/addons/:id').patch(webAuth(WRITE), validate(V.updateBody), controller.updateAddon);

module.exports = router;
