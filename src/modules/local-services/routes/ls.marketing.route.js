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
const controller = require('../controllers/ls.marketing.controller');
const V = require('../validations/ls.marketing.validation');

const router = express.Router();

// Public: live sponsored campaigns for a locality / pincode / city
router.route('/public/marketing/featured').get(validate(V.featuredQuery), controller.listFeatured);

// Customer: impression / click tracking
router
  .route('/customer/marketing/campaigns/:campaign/events')
  .post(
    appAuth('localservices_customer_read'),
    validate(V.eventBody),
    controller.recordEvent
  );

// Partner: browse packages, buy and manage campaigns
router
  .route('/partner/marketing/packages')
  .get(appAuth('localservices_partner_read'), validate(V.packageListQuery), controller.listPartnerPackages);

router
  .route('/partner/marketing/campaigns')
  .get(appAuth('localservices_partner_read'), validate(V.campaignListQuery), controller.listPartnerCampaigns)
  .post(appAuth('localservices_partner_read'), validate(V.campaignCreateBody), controller.createCampaign);

router
  .route('/partner/marketing/campaigns/:campaign/pay')
  .post(appAuth('localservices_partner_read'), validate(V.campaignPayBody), controller.payCampaign);

router
  .route('/partner/marketing/campaigns/:campaign/status')
  .patch(appAuth('localservices_partner_read'), validate(V.campaignStatusBody), controller.updateCampaignStatus);

// Admin: packages + campaign moderation
router
  .route('/admin/marketing/packages')
  .get(webAuth('localservices_catalog_read'), validate(V.packageListQuery), controller.listAdminPackages)
  .post(webAuth('localservices_catalog_write'), validate(V.packageBody), controller.createPackage);

router
  .route('/admin/marketing/packages/:packageId')
  .patch(webAuth('localservices_catalog_write'), validate(V.updatePackageBody), controller.updatePackage);

router
  .route('/admin/marketing/campaigns')
  .get(webAuth('localservices_catalog_read'), validate(V.campaignListQuery), controller.listAdminCampaigns);

router
  .route('/admin/marketing/campaigns/:campaign/review')
  .patch(webAuth('localservices_catalog_write'), validate(V.campaignReviewBody), controller.reviewCampaign);

module.exports = router;
