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
const controller = require('../controllers/ls.booking.controller');
const V = require('../validations/ls.booking.validation');

const router = express.Router();

router.route('/bookings').post(appAuth('localservices_customer_read'), validate(V.createBookingBody), controller.createBooking).get(appAuth('localservices_customer_read'), controller.listMyBookings);

router.route('/bookings/:id').get(appAuth('localservices_customer_read'), validate(V.bookingIdParam), controller.getMyBooking);

router.route('/bookings/:id/payment').get(appAuth('localservices_customer_read'), validate(V.bookingIdParam), controller.getBookingPayment);

router.route('/bookings/:id/pay').post(appAuth('localservices_customer_read'), validate(V.paymentBody), controller.initiatePayment);

// Target status is route param (realestate pattern), allow-listed by service table.
router.route('/bookings/:id/:status').post(appAuth('localservices_customer_read'), validate(V.transitionParam), controller.transitionBooking);

router.route('/bookings/:id/quote').post(appAuth('localservices_partner_read'), validate(V.quoteBody), controller.submitQuote);

router.route('/quotes/:id/accept').post(appAuth('localservices_customer_read'), validate(V.bookingIdParam), controller.acceptQuote);

router.route('/bookings/:id/reschedule').post(appAuth('localservices_customer_read'), validate(V.rescheduleBody), controller.rescheduleBooking);

router.route('/bookings/:id/dispute').post(appAuth('localservices_customer_read'), validate(V.disputeBody), controller.disputeBooking);

router.route('/bookings/:id/review').post(appAuth('localservices_customer_read'), validate(V.reviewBody), controller.submitReview);

router.route('/bookings/:id/invoice').get(appAuth('localservices_customer_read'), validate(V.bookingIdParam), controller.getInvoice);

router.route('/reviews').get(controller.listReviews);

router.route('/complaints').post(appAuth('localservices_customer_read'), validate(V.complaintBody), controller.createComplaint).get(appAuth('localservices_customer_read'), controller.listMyComplaints);

module.exports = router;
