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
const controller = require('../controllers/ls.revenue.controller');
const V = require('../validations/ls.revenue.validation');

const router = express.Router();

// webAuth (cookie), NOT appAuth: Angular admin panel authenticates by cookie.
// Rights are disjoint per vertical — never borrow a dairy/stores right.
const READ = 'localservices_revenue_read';
const WRITE = 'localservices_revenue_write';
const APPROVE = 'localservices_revenue_approve';

router.route('/rules').post(webAuth(WRITE), validate(V.ruleBody), controller.createRule).get(webAuth(READ), controller.listRules);

router.route('/rules/:id').get(webAuth(READ), validate(V.idParam), controller.getRule);

router.route('/rules/:id/clone').post(webAuth(WRITE), validate(V.idParam), controller.cloneRule);

// Target status is a route param + Joi allow-list enforced in service table (realestate pattern).
router.route('/rules/:id/:status').post(webAuth(APPROVE), validate(V.statusParam), controller.transitionRule);

router.route('/preview').post(webAuth(READ), validate(V.previewBody), controller.previewRevenue);

router.route('/mapping').get(webAuth(READ), controller.getMapping);

router.route('/entries').get(webAuth(READ), controller.listEntries);

router.route('/entries/export').get(webAuth(READ), controller.exportEntries);

router.route('/summary').get(webAuth(READ), controller.revenueSummary);

router.route('/settlements/generate').post(webAuth(APPROVE), controller.generateSettlement);

router.route('/settlements/:id/:status').post(webAuth(APPROVE), controller.markSettlement);

module.exports = router;
