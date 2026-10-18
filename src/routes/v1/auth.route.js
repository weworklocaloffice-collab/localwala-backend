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
const validate = require('../../middlewares/validate');
const AuthValidation = require('../../validations/auth.validation');
const AuthController = require('../../controllers/auth.controller');

const router = express.Router();

router.post(
  '/verifyAccount',
  validate(AuthValidation.userRegister),
  AuthController.verifyUserRegisterAccount
);
router.post('/verifyOTP', validate(AuthValidation.verifyOTP), AuthController.verifyOTP);
router.get('/resendOTP/:id', validate(AuthValidation.resendOTP), AuthController.resendOTP);
router.post(
  '/register-user-account',
  validate(AuthValidation.userRegister),
  AuthController.register
);
router.post(
  '/register-user-account-firebase',
  validate(AuthValidation.userRegisterFirebaseVerification),
  AuthController.registerFirebaseAccount
);
router.post(
  '/register-admin-account',
  validate(AuthValidation.registerAdmin),
  AuthController.registerAdminAccount
);
router.post(
  '/customer/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.userLoginWithEmailAndPassword
);
router.post(
  '/customer/login_cmp',
  validate(AuthValidation.loginWithCountryCodeAndMobilePassword),
  AuthController.userLoginWithCountryCodeAndMobilePassword
);
router.post(
  '/customer/login_eo_verification',
  validate(AuthValidation.emailOtpValidation),
  AuthController.userLoginWithEmailOtpVerification
);
router.post(
  '/customer/login_eo',
  validate(AuthValidation.loginWithEmailOTPValidation),
  AuthController.userLoginWithEmailOtp
);
router.post(
  '/customer/login_po_verification',
  validate(AuthValidation.phoneOtpValidation),
  AuthController.userLoginWithPhoneOtpVerification
);
router.post(
  '/customer/login_po/',
  validate(AuthValidation.userLoginWithPhoneOTPValidation),
  AuthController.userLoginWithPhoneOTP
);
router.post(
  '/customer/login_po_firebase',
  validate(AuthValidation.userLoginWithFirebasePhoneOTPValidation),
  AuthController.verifyUserLoginFirebaseOTP
);
router.post(
  '/customer/login_with_google_account/',
  validate(AuthValidation.googleLoginValidation),
  AuthController.userLoginWithGoogleAccount
);
router.post(
  '/customer/check_mobile_exist/',
  validate(AuthValidation.checkMobileNumberExistValidation),
  AuthController.checkMobileNumberExist
);
router.post(
  '/customer/create_google_user_account/',
  validate(AuthValidation.registerGoogleAccountValidation),
  AuthController.createGoogleUserAccount
);
router.post(
  '/customer/login_with_facebook_account/',
  validate(AuthValidation.facebookLoginValidation),
  AuthController.userLoginWithFacebookAccount
);
router.post(
  '/customer/create_facebook_user_account/',
  validate(AuthValidation.registerFacebookAccountValidation),
  AuthController.createFacebookUserAccount
);
router.post(
  '/admin/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.adminLoginWithEmailAndPassword
);
router.post(
  '/vendor/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.vendorLoginWithEmailAndPassword
);
router.post(
  '/vendor_web/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.vendorWebLoginWithEmailAndPassword
);
router.post(
  '/vendor/login_cmp',
  validate(AuthValidation.loginWithCountryCodeAndMobilePassword),
  AuthController.vendorLoginWithCountryCodeAndMobilePassword
);
router.post(
  '/vendor/login_cmp_web',
  validate(AuthValidation.loginWithCountryCodeAndMobilePassword),
  AuthController.vendorWebLoginWithCountryCodeAndMobilePassword
);
router.post(
  '/vendor/login_eo_verification',
  validate(AuthValidation.emailOtpValidation),
  AuthController.vendorLoginWithEmailOtpVerification
);
router.post(
  '/vendor/login_eo',
  validate(AuthValidation.loginWithEmailOTPValidation),
  AuthController.vendorLoginWithEmailOtp
);
router.post(
  '/vendor/login_eo_web',
  validate(AuthValidation.loginWithEmailOTPValidation),
  AuthController.vendorWebLoginWithEmailOtp
);
router.post(
  '/vendor/login_po_verification',
  validate(AuthValidation.phoneOtpValidation),
  AuthController.vendorLoginWithPhoneOtpVerification
);
router.post(
  '/vendor/login_po_web_verification',
  validate(AuthValidation.phoneOtpWebValidation),
  AuthController.vendorWebLoginWithPhoneOtpVerification
);
router.post(
  '/vendor/login_po/',
  validate(AuthValidation.userLoginWithPhoneOTPValidation),
  AuthController.vendorLoginWithPhoneOTP
);
router.post(
  '/vendor/login_po_web/',
  validate(AuthValidation.userLoginWithPhoneOTPValidation),
  AuthController.vendorWebLoginWithPhoneOTP
);
router.post(
  '/vendor/login_po_firebase/',
  validate(AuthValidation.userLoginWithFirebasePhoneOTPValidation),
  AuthController.verifyVendorLoginFirebaseOTP
);
router.post(
  '/vendor/login_po_firebase_web/',
  validate(AuthValidation.userWebLoginWithFirebasePhoneOTPValidation),
  AuthController.verifyWebVendorLoginFirebaseOTP
);
router.post(
  '/vendor/login_with_google_account/',
  validate(AuthValidation.googleLoginValidation),
  AuthController.vendorLoginWithGoogleAccount
);
router.post(
  '/vendor/login_with_facebook_account/',
  validate(AuthValidation.facebookLoginValidation),
  AuthController.vendorLoginWithFacebookAccount
);
router.post(
  '/driver/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.driverLognWithEmailAndPassword
);
router.post(
  '/driver/login_cmp',
  validate(AuthValidation.loginWithCountryCodeAndMobilePassword),
  AuthController.driverLoginWithCountryCodeAndMobilePassword
);
router.post(
  '/driver/login_eo_verification',
  validate(AuthValidation.emailOtpValidation),
  AuthController.driverLoginWithEmailOtpVerification
);
router.post(
  '/driver/login_eo',
  validate(AuthValidation.loginWithEmailOTPValidation),
  AuthController.driverLoginWithEmailOtp
);
router.post(
  '/driver/login_po_verification',
  validate(AuthValidation.phoneOtpValidation),
  AuthController.driverLoginWithPhoneOtpVerification
);
router.post(
  '/driver/login_po/',
  validate(AuthValidation.userLoginWithPhoneOTPValidation),
  AuthController.driverLoginWithPhoneOTP
);
router.post(
  '/driver/login_po_firebase',
  validate(AuthValidation.userLoginWithFirebasePhoneOTPValidation),
  AuthController.verifyDriverLoginFirebaseOTP
);
router.post(
  '/driver/login_with_google_account/',
  validate(AuthValidation.googleLoginValidation),
  AuthController.driverLoginWithGoogleAccount
);
router.post(
  '/driver/login_with_facebook_account/',
  validate(AuthValidation.facebookLoginValidation),
  AuthController.driverLoginWithFacebookAccount
);
router.get(
  '/register_guest_account/:agent/:locale',
  validate(AuthValidation.createGuestAccount),
  AuthController.createGuestAccount
);
router.post('/logout', validate(AuthValidation.logout), AuthController.logout);
router.post('/logout_web', AuthController.logoutWeb);
router.post('/refresh-tokens-web', AuthController.refreshTokensWeb);
router.post(
  '/refresh-tokens-app',
  validate(AuthValidation.refreshTokens),
  AuthController.refreshTokensApp
);
router.post(
  '/forgot-password-email',
  validate(AuthValidation.forgotPasswordWithEmail),
  AuthController.forgotPasswordWithEmail
);
router.post(
  '/forgot-password-phone',
  validate(AuthValidation.forgotPasswordWithPhone),
  AuthController.forgotPasswordWithPhone
);
router.post(
  '/forgot-password-phone-web',
  validate(AuthValidation.forgotWebPasswordWithPhone),
  AuthController.forgotWebPasswordWithPhone
);
router.post(
  '/reset-password',
  validate(AuthValidation.resetPassword),
  AuthController.resetPassword
);
router.post(
  '/reset-web-password',
  validate(AuthValidation.resetPasswordWeb),
  AuthController.resetWebPassword
);
router.post(
  '/reset-password-firebase',
  validate(AuthValidation.resetPasswordFirebase),
  AuthController.resetPasswordFirebase
);
router.post(
  '/reset-password-firebase-web',
  validate(AuthValidation.resetPasswordFirebaseWeb),
  AuthController.resetFirebaseWebPassword
);
router.post('/verify-email', validate(AuthValidation.verifyEmail), AuthController.verifyEmail);
router.get('/installations', AuthController.isAdminSetupDone);
router.post(
  '/check-register-status',
  validate(AuthValidation.checkRegisterStatusValidation),
  AuthController.checkUserRegisterStatus
);

// Waiter Auth //
router.post(
  '/waiter/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.waiterLognWithEmailAndPassword
);
router.post(
  '/waiter/login_cmp',
  validate(AuthValidation.loginWithCountryCodeAndMobilePassword),
  AuthController.waiterLoginWithPhoneAndPassword
);
router.post(
  '/waiter/login_eo_verification',
  validate(AuthValidation.emailOtpValidation),
  AuthController.waiterLoginWithEmailOtpVerification
);
router.post(
  '/waiter/login_eo',
  validate(AuthValidation.loginWithEmailOTPValidation),
  AuthController.waiterLoginWithEmailOtp
);
router.post(
  '/waiter/login_po_verification',
  validate(AuthValidation.phoneOtpValidation),
  AuthController.waiterLoginWithPhoneOtpVerification
);
router.post(
  '/waiter/login_po/',
  validate(AuthValidation.userLoginWithPhoneOTPValidation),
  AuthController.waiterLoginWithPhoneOTP
);
router.post(
  '/waiter/login_po_firebase/',
  validate(AuthValidation.userLoginWithFirebasePhoneOTPValidation),
  AuthController.verifyWaiterLoginFirebaseOTP
);
router.post(
  '/waiter/login_with_google_account/',
  validate(AuthValidation.googleLoginValidation),
  AuthController.waiterLoginWithGoogleAccount
);
router.post(
  '/waiter/login_with_facebook_account/',
  validate(AuthValidation.facebookLoginValidation),
  AuthController.waiterLoginWithFacebookAccount
);
// Waiter Auth //

// Kitchen Auth //
router.post(
  '/kitchen/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.kitchenOwnerLoginWithEmailAndPassword
);
router.post(
  '/kitchen/login_cmp',
  validate(AuthValidation.loginWithCountryCodeAndMobilePassword),
  AuthController.kitchenLoginWithPhoneAndPassword
);
router.post(
  '/kitchen/login_eo_verification',
  validate(AuthValidation.emailOtpValidation),
  AuthController.kitchenLoginWithEmailOtpVerification
);
router.post(
  '/kitchen/login_eo',
  validate(AuthValidation.loginWithEmailOTPValidation),
  AuthController.kitchenLoginWithEmailOtp
);
router.post(
  '/kitchen/login_po_verification',
  validate(AuthValidation.phoneOtpValidation),
  AuthController.kitchenLoginWithPhoneOtpVerification
);
router.post(
  '/kitchen/login_po/',
  validate(AuthValidation.userLoginWithPhoneOTPValidation),
  AuthController.kitchenLoginWithPhoneOTP
);
router.post(
  '/kitchen/login_po_firebase/',
  validate(AuthValidation.userLoginWithFirebasePhoneOTPValidation),
  AuthController.verifyKitchenLoginFirebaseOTP
);
router.post(
  '/kitchen/login_with_google_account/',
  validate(AuthValidation.googleLoginValidation),
  AuthController.kitchenLoginWithGoogleAccount
);
router.post(
  '/kitchen/login_with_facebook_account/',
  validate(AuthValidation.facebookLoginValidation),
  AuthController.kitchenLoginWithFacebookAccount
);
// Kitchen Auth //

// Dairy Auth //
// Serves both dairy roles. An owner-operator holds `dairyPartner` and
// `dairyDriver` simultaneously; availability is derived server-side by
// `modules/dairy/services/dairy.profile.service.js` and returned as `profile`.
router.post(
  '/dairy/login_po_verification',
  validate(AuthValidation.phoneOtpValidation),
  AuthController.dairyLoginWithPhoneOtpVerification
);
router.post(
  '/dairy/login_po/',
  validate(AuthValidation.userLoginWithPhoneOTPValidation),
  AuthController.dairyLoginWithPhoneOTP
);
// Dairy Auth //

// Accountant Auth //
router.post(
  '/accountant/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.loginAccountantWithEmailAndPassword
);
// Accountant Auth //

// Bank Auth //
router.post(
  '/bank/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.loginBankWithEmailAndPassword
);
// Bank Auth //

// Support Team Auth //
router.post(
  '/support_team/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.loginSupportTeamWithEmailAndPassword
);
// Support Team Auth //

// City Master Team Auth //
router.post(
  '/cityzen/login',
  validate(AuthValidation.loginWithEmailPassword),
  AuthController.loginCityzenWithEmailAndPassword
);
// City Master Team Auth //

// Web Otp Verification Auth //
router.get(
  '/web_verification/:id',
  validate(AuthValidation.smsVerificationWebValidation),
  AuthController.webOtpVerification
);
// Web Otp Verification Auth //
module.exports = router;

