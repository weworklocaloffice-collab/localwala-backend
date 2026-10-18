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
const controller = require('../controllers/ls.provider.controller');
const V = require('../validations/ls.provider.validation');

const router = express.Router();

// Admin moderation — cross-provider by design (no outlet scoping).
// Mounted at /admin/providers, so list lives at '/' (not '/providers').
// NOTE: '/' + '/:id' are GETs; '/:id/:status' etc are POSTs — no overlap.
router.route('/').get(webAuth('localservices_catalog_read'), controller.adminListProviders);
router.route('/offerings').get(webAuth('localservices_catalog_read'), controller.adminListOfferings);
router.route('/:id').get(webAuth('localservices_catalog_read'), validate(V.idParam), controller.adminGetProvider);
router.route('/:id/:status').post(webAuth('localservices_catalog_write'), validate(V.statusParam), controller.transitionProvider);

// Offering moderation: draft -> pending -> active, active <-> inactive.
router.route('/offerings/:id/:status').post(webAuth('localservices_catalog_write'), validate(V.statusParam), controller.transitionOffering);

// Document verification: pending -> verified (immutable) | rejected.
router.route('/documents/:id/:status').post(webAuth('localservices_catalog_write'), validate(V.statusParam), controller.verifyDocument);

// Verification queue across providers (filter ?status=pending).
router.route('/documents').get(webAuth('localservices_catalog_read'), controller.adminListDocuments);

module.exports = router;
