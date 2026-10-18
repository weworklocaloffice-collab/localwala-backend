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
const { password, objectId } = require('./custom.validation');

const createUser = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    role: Joi.string().required().valid('user', 'admin'),
  }),
};

const getUsers = {
  query: Joi.object().keys({
    firstName: Joi.string(),
    lastName: Joi.string(),
    mobile: Joi.number(),
    role: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getUser = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId),
  }),
};

const updateUser = {
  params: Joi.object().keys({
    userId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      email: Joi.string().email(),
      password: Joi.string().custom(password),
      firstName: Joi.string(),
      lastName: Joi.string(),
      mobile: Joi.number(),
    })
    .min(1),
};

const deleteUser = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId),
  }),
};

const searchUser = {
  params: Joi.object().keys({
    name: Joi.string().allow(null, ''),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
  }),
};

const notificationListValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    user: Joi.string().custom(objectId).required(),
  }),
};

const getDriverProfileValidation = {
  params: Joi.object().keys({
    uid: Joi.string().custom(objectId).required(),
  }),
};

const vendorHeaderValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const supportTeamHeaderValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const cityzenTeamHeaderValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const getKitchenOwnerProfileValidation = {
  params: Joi.object().keys({
    uid: Joi.string().custom(objectId).required(),
  }),
};

const updateDeliverymanValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    image: Joi.string().required(),
    gender: Joi.string().required(),
    identity: Joi.string().required(),
    identityNumber: Joi.string().required(),
    identityProof: Joi.string().required(),
    drivingLicense: Joi.string().required(),
    vehicle: Joi.string().custom(objectId).required(),
  }),
};

const updateKitchenOwnerValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    image: Joi.string().required(),
    gender: Joi.string().required(),
  }),
};

const getReferralCodeValidation = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId).required(),
  }),
};

const callValidation = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId).required(),
  }),
};

const updateStatusValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
  body: Joi.object().keys({
    status: Joi.boolean().required(),
  }),
};

const webGuardValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const supportTeamCustomerDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const adminProfileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const accountantProfileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const vendorProfileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const supportTeamProfileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const cityzenProfileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const updateAdminProfileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    image: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
  }),
};

const updateAccountantProfileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    image: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
  }),
};

const updateVendorProfileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    image: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
  }),
};

const updateSupportTeamProfileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    image: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
  }),
};

const updateCityzenProfileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    image: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
  }),
};

const updateAdminPasswordValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    password: Joi.string().required().custom(password),
  }),
};

const updateAccountantPasswordValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    password: Joi.string().required().custom(password),
  }),
};

const updateVendorPasswordValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    password: Joi.string().required().custom(password),
  }),
};

const updateSupportTeamPasswordValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    password: Joi.string().required().custom(password),
  }),
};

const updateCityzenPasswordValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    password: Joi.string().required().custom(password),
  }),
};

const updatePasswordValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    password: Joi.string().required().custom(password),
  }),
};

const updateEmailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    locale: Joi.string().allow(),
  }),
};

const updateMobileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    locale: Joi.string().allow(),
  }),
};

const updateEmailAfterVerificationValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    verificationId: Joi.string().custom(objectId).required(),
  }),
};

const updateMobileAfterVerificationValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    verificationId: Joi.string().custom(objectId).required(),
  }),
};

const updateMobileAfterFirebaseVerificationValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    token: Joi.string().required(),
  }),
};

const deleteUserAccountValidation = {
  body: Joi.object().keys({
    reason: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
  }),
};

const deleteRestaurantAccountValidation = {
  body: Joi.object().keys({
    reason: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const deleteDeliverymanAccountValidation = {
  body: Joi.object().keys({
    reason: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
  }),
};

const sendNotificationValidation = {
  body: Joi.object().keys({
    to: Joi.string().required().valid('all', 'customer', 'restaurant', 'deliveryman'),
    title: Joi.string().required(),
    description: Joi.string().required(),
  }),
};

const cityzenSendNotificationValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    to: Joi.string().required().valid('all', 'customer', 'restaurant', 'deliveryman'),
    title: Joi.string().required(),
    description: Joi.string().required(),
  }),
};

const cityzenNotificationValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

const cityzenChatListValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
  }),
};

const exportValidation = {
  params: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
  }),
};

const exportRoleValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    search: Joi.string().allow(null, ''),
  }),
};

const restaurantComplaintsReportExportValidation = {
  params: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    status: Joi.boolean().required(),
  }),
};

const exportCustomerValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    filter: Joi.boolean(),
    sortBy: Joi.string().allow().valid('oldest', 'newest', 'order', 'total'),
    role: Joi.string().allow().valid('user', 'guest'),
    status: Joi.boolean(),
    joiningDate: Joi.string().allow(),
    search: Joi.string().allow(null, ''),
  }),
};

const exportWalletFundValidation = {
  params: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    query: Joi.string().allow(null, ''),
  }),
};

const loyalityPointValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    filter: Joi.boolean(),
    type: Joi.string().allow(null, '').valid('order', 'coupon'),
    status: Joi.boolean(),
    range: Joi.string().allow(null, ''),
    search: Joi.string().allow(null, ''),
  }),
};

const exportLoyalityPointsValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    filter: Joi.boolean(),
    filterType: Joi.string().allow(null, '').valid('order', 'coupon'),
    status: Joi.boolean(),
    range: Joi.string().allow(null, ''),
    search: Joi.string().allow(null, ''),
  }),
};

const exportCustomerReportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    search: Joi.string().allow(null, ''),
    kind: Joi.string().valid('all', 'user', 'guest'),
  }),
};

const adminComplaintValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    status: Joi.boolean(),
    search: Joi.string().allow(null, ''),
  }),
};

const cityzenComplaintValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    status: Joi.boolean(),
    search: Joi.string().allow(null, ''),
  }),
};

const cityzenRestaurantComplaintValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    status: Joi.boolean(),
    search: Joi.string().allow(null, ''),
  }),
};

const adminRestaurantComplaintValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    status: Joi.boolean(),
    search: Joi.string().allow(null, ''),
  }),
};

const adminComplaintExportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    status: Joi.boolean(),
    search: Joi.string().allow(null, ''),
  }),
};

const adminRestaurantComplaintExportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    status: Joi.boolean(),
    search: Joi.string().allow(null, ''),
  }),
};

const deletedAccountValidation = {
  query: Joi.object().keys({
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    search: Joi.string().allow(null, ''),
  }),
};

const exportDeletedAccountValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    search: Joi.string().allow(null, ''),
  }),
};

const downloadImportValidation = {
  query: Joi.object().keys({
    link: Joi.string().required(),
  }),
};

const importCollectionValidation = {
  body: Joi.object().keys({
    file: Joi.binary().allow(),
    type: Joi.string().valid('excel', 'csv'),
  }),
};

const importAuthRoleCollectionValidation = {
  query: Joi.object().keys({
    role: Joi.string().required().valid('accountant', 'admin', 'cityMaster', 'supportTeam'),
  }),
  body: Joi.object().keys({
    file: Joi.binary().allow(),
    type: Joi.string().valid('excel', 'csv'),
  }),
};

const chatExportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
  }),
};

const adminUserContactDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const updateLocaleValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    locale: Joi.string().required(),
  }),
};

module.exports = {
  createUser,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  searchUser,
  idValidation,
  notificationListValidation,
  getDriverProfileValidation,
  updateDeliverymanValidation,
  getReferralCodeValidation,
  callValidation,
  updateStatusValidation,
  webGuardValidation,
  supportTeamCustomerDetailValidation,
  adminProfileValidation,
  accountantProfileValidation,
  vendorProfileValidation,
  supportTeamProfileValidation,
  cityzenProfileValidation,
  updateAdminProfileValidation,
  updateAccountantProfileValidation,
  updateVendorProfileValidation,
  updateSupportTeamProfileValidation,
  updateCityzenProfileValidation,
  updateAdminPasswordValidation,
  updateAccountantPasswordValidation,
  updateVendorPasswordValidation,
  updateSupportTeamPasswordValidation,
  updateCityzenPasswordValidation,
  updatePasswordValidation,
  updateEmailValidation,
  updateEmailAfterVerificationValidation,
  updateMobileValidation,
  updateMobileAfterVerificationValidation,
  updateMobileAfterFirebaseVerificationValidation,
  deleteUserAccountValidation,
  deleteRestaurantAccountValidation,
  deleteDeliverymanAccountValidation,
  getKitchenOwnerProfileValidation,
  updateKitchenOwnerValidation,
  sendNotificationValidation,
  vendorHeaderValidation,
  supportTeamHeaderValidation,
  cityzenSendNotificationValidation,
  cityzenTeamHeaderValidation,
  cityzenNotificationValidation,
  cityzenChatListValidation,
  exportValidation,
  restaurantComplaintsReportExportValidation,
  exportCustomerValidation,
  exportWalletFundValidation,
  loyalityPointValidation,
  exportLoyalityPointsValidation,
  exportCustomerReportValidation,
  adminComplaintValidation,
  cityzenComplaintValidation,
  cityzenRestaurantComplaintValidation,
  adminComplaintExportValidation,
  adminRestaurantComplaintValidation,
  adminRestaurantComplaintExportValidation,
  deletedAccountValidation,
  exportDeletedAccountValidation,
  exportRoleValidation,
  downloadImportValidation,
  importCollectionValidation,
  importAuthRoleCollectionValidation,
  chatExportValidation,
  adminUserContactDetailValidation,
  updateLocaleValidation,
};

