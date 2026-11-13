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
const { status: httpStatus } = require('http-status');
const validate = require('../../../middlewares/validate');
const appAuth = require('../../../middlewares/appAuth');
const controller = require('../controllers/ls.booking.controller');
const favoriteService = require('../services/ls.favorite.service');
const V = require('../validations/ls.booking.validation');

const router = express.Router();

const listFavorites = async (req, res) => {
  const result = await favoriteService.listFavorites({
    customer: req.user._id,
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
  });
  res.status(httpStatus.OK).send(result);
};

const getFavorite = async (req, res) => {
  const result = await favoriteService.isFavorite({
    customer: req.user._id,
    service: req.params.service,
  });
  res.status(httpStatus.OK).send(result);
};

const addFavorite = async (req, res) => {
  const result = await favoriteService.addFavorite({
    customer: req.user._id,
    service: req.params.service,
  });
  res.status(httpStatus.OK).send(result);
};

const removeFavorite = async (req, res) => {
  const result = await favoriteService.removeFavorite({
    customer: req.user._id,
    service: req.params.service,
  });
  res.status(httpStatus.OK).send(result);
};

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

router.route('/bookings/:id/complete-confirmation').post(appAuth('localservices_customer_read'), validate(V.bookingIdParam), controller.confirmCompletion);

router.route('/bookings/:id/review').post(appAuth('localservices_customer_read'), validate(V.reviewBody), controller.submitReview);

router.route('/bookings/:id/invoice').get(appAuth('localservices_customer_read'), validate(V.bookingIdParam), controller.getInvoice);
router.route('/bookings/:id/invoice/pdf').get(appAuth('localservices_customer_read'), validate(V.bookingIdParam), controller.getInvoicePdf);

router.route('/reviews').get(controller.listReviews);

router.route('/complaints').post(appAuth('localservices_customer_read'), validate(V.complaintBody), controller.createComplaint).get(appAuth('localservices_customer_read'), controller.listMyComplaints);

router.route('/favorites').get(validate(V.favoriteListQuery), appAuth('localservices_customer_read'), listFavorites);

router.route('/services/:service/favorite').get(validate(V.favoriteServiceParam), appAuth('localservices_customer_read'), getFavorite).post(validate(V.favoriteServiceParam), appAuth('localservices_customer_read'), addFavorite).delete(validate(V.favoriteServiceParam), appAuth('localservices_customer_read'), removeFavorite);

module.exports = router;
