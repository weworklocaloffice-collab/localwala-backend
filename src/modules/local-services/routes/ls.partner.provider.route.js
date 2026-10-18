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
const controller = require('../controllers/ls.provider.controller');
const bookingController = require('../controllers/ls.booking.controller');
const V = require('../validations/ls.provider.validation');
const BV = require('../validations/ls.booking.validation');

const router = express.Router();

// Partner self-service (token-scoped, never URL provider id)
router.route('/providers').post(appAuth('localservices_partner_read'), validate(V.providerBody), controller.registerProvider).get(appAuth('localservices_partner_read'), controller.myProvider);

router.route('/providers/:id/submit').post(appAuth('localservices_partner_read'), validate(V.idParam), controller.submitProvider);

router.route('/offerings').post(appAuth('localservices_partner_read'), validate(V.offeringBody), controller.createOffering).get(appAuth('localservices_partner_read'), controller.listMyOfferings);

router.route('/offerings/:id/submit').post(appAuth('localservices_partner_read'), validate(V.idParam), controller.submitOffering);

// Partner booking actions — ownership enforced in controller (403 on foreign bookings).
router.route('/bookings').get(appAuth('localservices_partner_read'), controller.listMyBookings);

router.route('/bookings/:id').get(appAuth('localservices_partner_read'), validate(BV.bookingIdParam), controller.getBookingDetail);

router.route('/bookings/:id/:status').post(appAuth('localservices_partner_read'), validate(BV.transitionParam), controller.partnerTransitionBooking);

router.route('/bookings/:id/assign').post(appAuth('localservices_partner_read'), validate(BV.assignBody), controller.assignBooking);

router.route('/bookings/:id/quote').post(appAuth('localservices_partner_read'), validate(BV.quoteBody), bookingController.submitQuote);

router.route('/bookings/:id/release').post(appAuth('localservices_partner_read'), validate(BV.bookingIdParam), controller.releaseAssignment);

router.route('/documents').post(appAuth('localservices_partner_read'), validate(V.documentBody), controller.uploadDocument).get(appAuth('localservices_partner_read'), controller.listMyDocuments);

router.route('/earnings').get(appAuth('localservices_partner_read'), controller.myEarnings);

router.route('/quotes/:id/revise').post(appAuth('localservices_partner_read'), validate(BV.quoteBody), bookingController.reviseQuote);

module.exports = router;
