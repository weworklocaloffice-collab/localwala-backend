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

const Joi = require('joi');
const { objectId } = require('./custom.validation');

const createBookingValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).allow(null, ''),
    payment: Joi.string().custom(objectId).allow(null, ''),
    restaurant: Joi.string().custom(objectId).required(),
    coupon: Joi.string().custom(objectId).allow(null, ''),
    bookingDate: Joi.date().required(),
    bookingSlot: Joi.string().required(),
    guest: Joi.number().required(),
    userName: Joi.string().required(),
    userCountryCode: Joi.number().required(),
    userContact: Joi.string().required(),
    userEmail: Joi.string().required().email().required(),
    specialRequest: Joi.string().allow(null, ''),
    campaignId: Joi.string().allow(null, ''),
  }),
};

const diningBookingByUserIdValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).required(),
  }),
};

const queryValidation = {
  params: Joi.object().keys({
    uid: Joi.string().custom(objectId).required(),
    query: Joi.string().required(),
  }),
};

const diningBookingConfirmValidation = {
  body: Joi.object().keys({
    slug: Joi.string().required(),
    uid: Joi.string().custom(objectId).allow(null, ''),
    coupon: Joi.string().custom(objectId).allow(null, ''),
  }),
};

const getUserDiningBookingInformationValidation = {
  body: Joi.object().keys({
    uid: Joi.string().custom(objectId).required(),
    booking: Joi.string().custom(objectId).required(),
  }),
};

const repayPendingBookingValidation = {
  body: Joi.object().keys({
    bookingId: Joi.string().custom(objectId).required(),
    userId: Joi.string().custom(objectId).required(),
    payMethod: Joi.string().custom(objectId).required(),
    newPayMethod: Joi.string().custom(objectId).required(),
  }),
};

const cancleUserDiningBookingValidation = {
  body: Joi.object().keys({
    bookingId: Joi.string().custom(objectId).required(),
    reasonId: Joi.string().custom(objectId).required(),
  }),
};

const adminBookingValidation = {
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    status: Joi.string()
      .required()
      .allow(
        'all',
        'created',
        'accepted',
        'completed',
        'cancelled',
        'rejected',
        'refunded',
        'partially_refunded',
        'pending_payments'
      ),
    search: Joi.string().allow(null, ''),
  }),
};

const cityzenBookingValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    status: Joi.string()
      .required()
      .allow(
        'all',
        'created',
        'accepted',
        'completed',
        'cancelled',
        'rejected',
        'refunded',
        'partially_refunded',
        'pending_payments'
      ),
    search: Joi.string().allow(null, ''),
  }),
};

const diningBookingByVendorIdValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    vendor: Joi.string().custom(objectId).required(),
    status: Joi.string()
      .required()
      .allow(
        'created',
        'accepted',
        'completed',
        'cancelled',
        'rejected',
        'refunded',
        'partially_refunded'
      ),
  }),
};

const acceptDiningBookingValidation = {
  body: Joi.object().keys({
    bookingId: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().custom(objectId).required(),
  }),
};

const rejectDiningBookingValidation = {
  body: Joi.object().keys({
    bookingId: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().custom(objectId).required(),
    reasonId: Joi.string().custom(objectId).required(),
  }),
};

const completeDiningBookingValidation = {
  body: Joi.object().keys({
    bookingId: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().custom(objectId).required(),
    itemTotal: Joi.number().required().allow(null, 0),
    itemDiscount: Joi.number().required().allow(null, 0),
    couponDiscount: Joi.number().required().allow(null, 0),
    billTotal: Joi.number().required().allow(null, 0),
  }),
};

const bookingInformationValidation = {
  params: Joi.object().keys({
    bookingId: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().required(),
  }),
};

const callCustomerValidation = {
  params: Joi.object().keys({
    bookingId: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().required(),
  }),
};

const bookingInformationAdminValidation = {
  params: Joi.object().keys({
    bookingId: Joi.string().custom(objectId).required(),
  }),
};

const couponValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const supportTeamDiningValidation = {
  params: Joi.object().keys({
    bookingId: Joi.string().custom(objectId).required(),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    status: Joi.string()
      .required()
      .allow(
        'all',
        'created',
        'accepted',
        'completed',
        'cancelled',
        'rejected',
        'refunded',
        'partially_refunded',
        'pending_payments'
      ),
    search: Joi.string().allow(null, ''),
  }),
};

const exportReportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    filter: Joi.boolean(),
    search: Joi.string().allow(null, ''),
    restaurant: Joi.string().allow(null, ''),
    filterDates: Joi.string().allow(null, ''),
  }),
};

const downloadBookingReceiptValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
    locale: Joi.string().required(),
  }),
};

module.exports = {
  createBookingValidation,
  diningBookingByUserIdValidation,
  queryValidation,
  diningBookingConfirmValidation,
  getUserDiningBookingInformationValidation,
  repayPendingBookingValidation,
  cancleUserDiningBookingValidation,
  adminBookingValidation,
  diningBookingByVendorIdValidation,
  acceptDiningBookingValidation,
  rejectDiningBookingValidation,
  completeDiningBookingValidation,
  bookingInformationValidation,
  callCustomerValidation,
  bookingInformationAdminValidation,
  couponValidation,
  supportTeamDiningValidation,
  cityzenBookingValidation,
  exportValidation,
  exportReportValidation,
  downloadBookingReceiptValidation,
};

