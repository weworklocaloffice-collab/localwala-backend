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
const controller = require('../controllers/ls.booking.controller');
const V = require('../validations/ls.booking.validation');

const router = express.Router();

// Admin booking oversight — read-only queue + detail with history.
router.route('/bookings').get(webAuth('localservices_catalog_read'), controller.adminListBookings);
router.route('/bookings/:id').get(webAuth('localservices_catalog_read'), validate(V.bookingIdParam), controller.adminGetBooking);
router.route('/bookings/:id/invoice/void').post(webAuth('localservices_revenue_approve'), validate(V.bookingIdParam), controller.voidInvoice);
router.route('/complaints').get(webAuth('localservices_catalog_read'), controller.listAllComplaints);
router.route('/complaints/:id/resolve').post(webAuth('localservices_catalog_read'), validate(V.bookingIdParam), controller.resolveComplaint);
router.route('/refunds').get(webAuth('localservices_revenue_approve'), controller.adminListRefunds);
router.route('/refunds/:id/decision').post(webAuth('localservices_revenue_approve'), validate(V.refundDecisionBody), controller.decideRefund);

module.exports = router;
