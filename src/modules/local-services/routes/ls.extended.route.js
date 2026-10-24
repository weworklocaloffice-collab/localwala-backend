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
const appAuth = require('../../../middlewares/appAuth');
const webAuth = require('../../../middlewares/webAuth');
const recurring = require('../controllers/ls.recurring.controller');
const lead = require('../controllers/ls.lead.controller');
const growth = require('../controllers/ls.growth.controller');
const V = require('../validations/ls.extended.validation');

const router = express.Router();

// Customer: recurring agreements + leads
router.route('/recurring').post(appAuth('localservices_customer_read'), validate(V.recurringBody), recurring.createAgreement).get(appAuth('localservices_customer_read'), recurring.listAgreements);
router.route('/recurring/:id/:status').post(appAuth('localservices_customer_read'), validate(V.idParam), recurring.setAgreementStatus);
router.route('/occurrences').get(appAuth('localservices_customer_read'), recurring.listOccurrences);
router.route('/leads').post(appAuth('localservices_customer_read'), validate(V.leadBody), lead.createLead).get(appAuth('localservices_customer_read'), lead.listLeads);

// Partner: qualify/invalidate leads + subscribe to plan
router.route('/leads/:id/qualify').post(appAuth('localservices_partner_read'), validate(V.idParam), lead.qualifyLead);
router.route('/leads/:id/invalidate').post(appAuth('localservices_partner_read'), validate(V.idParam), lead.invalidateLead);
router.route('/subscriptions').post(appAuth('localservices_partner_read'), growth.subscribe);

// Admin: plans + featured + lead oversight
router.route('/admin/plans').post(webAuth('localservices_catalog_write'), validate(V.planBody), growth.createPlan).get(webAuth('localservices_catalog_read'), growth.listPlans);
router.route('/admin/plans/:id').patch(webAuth('localservices_catalog_write'), validate(V.planStatusBody), growth.updatePlanStatus);
router.route('/admin/featured').post(webAuth('localservices_catalog_write'), validate(V.featuredBody), growth.createFeatured).get(webAuth('localservices_catalog_read'), growth.listFeatured);
router.route('/admin/featured/:id').patch(webAuth('localservices_catalog_write'), validate(V.featuredStatusBody), growth.updateFeaturedStatus);
router.route('/admin/leads').get(webAuth('localservices_revenue_read'), lead.listAllLeads);

module.exports = router;
