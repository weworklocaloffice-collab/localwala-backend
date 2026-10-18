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
const { password } = require('./custom.validation');
const { objectId } = require('./custom.validation');

const userRegister = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    referralCode: Joi.string().allow('', null),
    locale: Joi.string().allow(),
    isEmailVerified: Joi.boolean().allow(),
    isMobileVerified: Joi.boolean().allow(),
    userAgent: Joi.string().allow(null, ''),
    verificationId: Joi.string().custom(objectId).allow(null, ''),
    verificationCode: Joi.string().allow(null, ''),
  }),
};

const userRegisterFirebaseVerification = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    referralCode: Joi.string().allow('', null),
    locale: Joi.string().allow(),
    isEmailVerified: Joi.boolean().allow(),
    isMobileVerified: Joi.boolean().allow(),
    userAgent: Joi.string().allow(null, ''),
    token: Joi.string().required(),
  }),
};

const registerAdmin = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    userAgent: Joi.string().allow(null, ''),
    locale: Joi.string().allow(),
  }),
};

const loginWithEmailPassword = {
  body: Joi.object().keys({
    email: Joi.string().required(),
    password: Joi.string().required(),
    remember: Joi.bool().required(),
    userAgent: Joi.string().allow(null, ''),
    locale: Joi.string().allow(),
  }),
};

const loginWithCountryCodeAndMobilePassword = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.string().required(),
    password: Joi.string().required(),
    remember: Joi.bool().required(),
    userAgent: Joi.string().allow(null, ''),
    locale: Joi.string().allow(),
  }),
};

const logout = {
  body: Joi.object().keys({
    refreshToken: Joi.string().required(),
  }),
};

const refreshTokens = {
  body: Joi.object().keys({
    refreshToken: Joi.string().required(),
  }),
};

const forgotPasswordWithEmail = {
  body: Joi.object().keys({
    email: Joi.string().email().required(),
    locale: Joi.string().allow(),
  }),
};

const forgotPasswordWithPhone = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    locale: Joi.string().allow(),
  }),
};

const forgotWebPasswordWithPhone = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    locale: Joi.string().allow(),
    redirectUrl: Joi.string().required(),
  }),
};

const resetPassword = {
  body: Joi.object().keys({
    password: Joi.string().required().custom(password),
    verificationId: Joi.string().custom(objectId),
    token: Joi.string().required(),
  }),
};

const resetPasswordWeb = {
  body: Joi.object().keys({
    password: Joi.string().required().custom(password),
    verificationId: Joi.string().custom(objectId),
  }),
};

const resetPasswordFirebase = {
  body: Joi.object().keys({
    password: Joi.string().required().custom(password),
    token: Joi.string().required(),
    qtoken: Joi.string().required(),
  }),
};

const resetPasswordFirebaseWeb = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    password: Joi.string().required().custom(password),
    token: Joi.string().required(),
  }),
};

const verifyEmail = {
  query: Joi.object().keys({
    token: Joi.string().required(),
  }),
};

const verifyOTP = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId),
    provider: Joi.string().required(),
    otp: Joi.string().required(),
  }),
};

const resendOTP = {
  query: Joi.object().keys({
    id: Joi.string().custom(objectId),
  }),
};

const createGuestAccount = {
  params: Joi.object().keys({
    agent: Joi.string().allow('', null),
    locale: Joi.string().allow(),
  }),
};

const emailOtpValidation = {
  body: Joi.object().keys({
    email: Joi.string().email().required(),
    locale: Joi.string().allow(),
  }),
};

const loginWithEmailOTPValidation = {
  body: Joi.object().keys({
    email: Joi.string().email().required(),
    remember: Joi.bool().required(),
    userAgent: Joi.string().allow(null, ''),
    locale: Joi.string().allow(),
    verificationId: Joi.string().custom(objectId).allow(null, ''),
    verificationCode: Joi.string().allow(null, ''),
  }),
};

const phoneOtpValidation = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    locale: Joi.string().allow(),
  }),
};

const phoneOtpWebValidation = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    locale: Joi.string().allow(),
    redirectUrl: Joi.string().required(),
  }),
};

const verifyWebSMSOTPValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    locale: Joi.string().allow(),
  }),
};

const verifyWebVersionSMSOTPValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const verifyFirebaseWebVersionSMSOTPValidation = {
  query: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    locale: Joi.string().allow(),
    role: Joi.string().required().valid('vendor', 'user'),
    redirect: Joi.string().required(),
  }),
};

const verificationIdValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const smsVerificationWebValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  // query: Joi.object().keys({
  //   id: Joi.string().custom(objectId).required(),
  //   role: Joi.string().required().valid('vendor', 'user'),
  //   redirect: Joi.string().required(),
  // }),
};

const userLoginWithPhoneOTPValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    locale: Joi.string().allow(),
    remember: Joi.bool().required(),
    userAgent: Joi.string().allow('', null),
  }),
};

const userLoginWithFirebasePhoneOTPValidation = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    token: Joi.string().required(),
    locale: Joi.string().allow(),
    remember: Joi.bool().required(),
    userAgent: Joi.string().allow('', null),
  }),
};

const userWebLoginWithFirebasePhoneOTPValidation = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobileNumber: Joi.number().required(),
    token: Joi.string().required(),
    locale: Joi.string().allow(),
    remember: Joi.bool().required(),
    userAgent: Joi.string().allow('', null),
  }),
};

const profileValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const updateProfileValidation = {
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

const getMyMediaFilesValidation = {
  params: Joi.object().keys({
    uid: Joi.string().custom(objectId).required(),
  }),
};

const checkRegisterStatusValidation = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
  }),
};

const adminAddCustomerValidation = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
  }),
};

const cityzenAddCustomerValidation = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
  }),
};

const roleValidation = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    image: Joi.string().required(),
    role: Joi.string().valid('supportTeam', 'supportSupervisor'),
  }),
};

const cityRoleValidation = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    image: Joi.string().required(),
    city: Joi.string().custom(objectId).required(),
  }),
};

const updateRoleStatusValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    status: Joi.boolean().required(),
  }),
};

const roleAccountDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const roleAccountListValidation = {
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    kind: Joi.string().valid('admin', 'accountant', 'supportTeam').required(),
    search: Joi.string().allow(null, ''),
  }),
};

const cityZenAccountListValidation = {
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    search: Joi.string().allow(null, ''),
  }),
};

const updateRoleDetailValidation = {
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
    role: Joi.string().valid('supportTeam', 'supportSupervisor'),
  }),
};

const updateCityMasterValidation = {
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
    city: Joi.string().custom(objectId).required(),
  }),
};

const googleLoginValidation = {
  body: Joi.object().keys({
    idToken: Joi.string().required(),
    remember: Joi.bool().required(),
    userAgent: Joi.string().allow(null, ''),
    locale: Joi.string().allow(),
  }),
};

const checkMobileNumberExistValidation = {
  body: Joi.object().keys({
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
  }),
};

const registerGoogleAccountValidation = {
  body: Joi.object().keys({
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    idToken: Joi.string().required(),
    remember: Joi.bool().required(),
    userAgent: Joi.string().allow(null, ''),
    locale: Joi.string().allow(),
  }),
};

const facebookLoginValidation = {
  body: Joi.object().keys({
    accessToken: Joi.string().required(),
    remember: Joi.bool().required(),
    userAgent: Joi.string().allow(null, ''),
    locale: Joi.string().allow(),
  }),
};

const registerFacebookAccountValidation = {
  body: Joi.object().keys({
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    countryCode: Joi.string().required(),
    mobile: Joi.number().required(),
    accessToken: Joi.string().required(),
    remember: Joi.bool().required(),
    userAgent: Joi.string().allow(null, ''),
    locale: Joi.string().allow(),
  }),
};

const cityMasterValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  userRegister,
  userRegisterFirebaseVerification,
  loginWithEmailPassword,
  logout,
  refreshTokens,
  forgotPasswordWithEmail,
  resetPassword,
  resetPasswordWeb,
  resetPasswordFirebase,
  resetPasswordFirebaseWeb,
  verifyEmail,
  registerAdmin,
  verifyOTP,
  resendOTP,
  createGuestAccount,
  loginWithCountryCodeAndMobilePassword,
  emailOtpValidation,
  loginWithEmailOTPValidation,
  phoneOtpValidation,
  phoneOtpWebValidation,
  verifyWebSMSOTPValidation,
  verifyWebVersionSMSOTPValidation,
  verifyFirebaseWebVersionSMSOTPValidation,
  verificationIdValidation,
  smsVerificationWebValidation,
  userLoginWithPhoneOTPValidation,
  userLoginWithFirebasePhoneOTPValidation,
  userWebLoginWithFirebasePhoneOTPValidation,
  forgotPasswordWithPhone,
  forgotWebPasswordWithPhone,
  profileValidation,
  updateProfileValidation,
  getMyMediaFilesValidation,
  checkRegisterStatusValidation,
  roleAccountListValidation,
  adminAddCustomerValidation,
  roleValidation,
  cityRoleValidation,
  updateRoleStatusValidation,
  roleAccountDetailValidation,
  updateRoleDetailValidation,
  updateCityMasterValidation,
  cityzenAddCustomerValidation,
  googleLoginValidation,
  checkMobileNumberExistValidation,
  registerGoogleAccountValidation,
  facebookLoginValidation,
  registerFacebookAccountValidation,
  cityZenAccountListValidation,
  cityMasterValidation,
};

