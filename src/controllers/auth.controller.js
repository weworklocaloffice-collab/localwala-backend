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

const config = require('../config/config');
const admin = require('firebase-admin');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { OAuth2Client } = require('google-auth-library');
const superagent = require('superagent');
const { status: httpStatus } = require('http-status');
const otpGenerator = require('otp-generator');
const catchAsync = require('../utils/catchAsync');
const {
  authService,
  userService,
  tokenService,
  walletService,
  restaurantService,
  userSettingService,
  businessSettingsService,
  emailConfigService,
  otpVerificationService,
  referralService,
  guestUserInfoService,
  smsProviderConfigService,
  waiterService,
  socialSigninService,
  kitchenOwnerService,
} = require('../services');
const { Wallet, ReferralCode } = require('../models');
const pick = require('../utils/pick');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const dairyProfileService = require('../modules/dairy/services/dairy.profile.service');

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '0.0.0.0';
};

const getClientUserAgent = (req) => req.get('user-agent') || 'unknown';

const isSecureRequest = (req) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.toLowerCase().includes('https')) {
    return true;
  }
  return Boolean(req.secure);
};

const getCookieOptions = (req) => {
  const secureByConfig =
    config.jwt.cookieSecure === 'true'
      ? true
      : config.jwt.cookieSecure === 'false'
        ? false
        : isSecureRequest(req);

  const sameSiteByConfig = config.jwt.cookieSameSite || (secureByConfig ? 'none' : 'lax');
  const shouldUseSecure = sameSiteByConfig === 'none' ? true : secureByConfig;

  const options = {
    httpOnly: true,
    secure: shouldUseSecure,
    sameSite: sameSiteByConfig,
    maxAge: config.jwt.cookieMaxAgeMs,
  };

  if (config.jwt.cookieDomain) {
    options.domain = config.jwt.cookieDomain;
  }

  return options;
};

const getClearCookieOptions = () => {
  const isProduction = config.env === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
  };
};

const setWebAuthCookies = (req, res, tokens, remember = false) => {
  const cookieOptions = getCookieOptions(req);
  res.cookie(config.jwt.cookieName, tokens.access.token, cookieOptions);
  // The refresh cookie must ALWAYS be set: the panel guard calls
  // refresh-tokens-web on every load, and without this cookie it 401s even
  // seconds after a successful login (remember:false never set it at all).
  // Without "remember" it is a session cookie that dies with the browser.
  res.cookie(config.jwt.refreshCookieName, tokens.refresh.token, {
    ...cookieOptions,
    ...(remember ? { maxAge: config.jwt.refreshCookieMaxAgeMs } : {}),
  });
};

const clearWebAuthCookies = (res) => {
  res.clearCookie(config.jwt.cookieName, getClearCookieOptions());
  res.clearCookie(config.jwt.refreshCookieName, getClearCookieOptions());
};

const register = catchAsync(async (req, res) => {
  const userVerification = await userSettingService.getVerificationStatus();
  if (userVerification !== null && userVerification.signUpVerification === true) {
    const verificationStatus = await otpVerificationService.verifyOtpForAuthentication(
      req.body.verificationId,
      req.body.verificationCode
    );
    if (
      verificationStatus !== null &&
      verificationStatus.id &&
      verificationStatus.id !== null &&
      verificationStatus.id !== '' &&
      verificationStatus.id === req.body.verificationId
    ) {
      const user = await userService.createUser(req.body);
      const ip = req.connection.remoteAddress;
      const tokens = await tokenService.generateAuthTokens(user, ip, req.body.userAgent);
      const walletData = new Wallet({
        holderId: user.id,
      });
      const referralCode = new ReferralCode({
        holderId: user.id,
      });
      await walletService.createWallet(walletData);
      await referralService.createReferralCode(referralCode);
      const referral = await referralService.redeemReferralCode(req.body.referralCode, user.id);
      res.status(201).send({ user, tokens, referral });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    const user = await userService.createUser(req.body);
    const ip = req.connection.remoteAddress;
    const tokens = await tokenService.generateAuthTokens(user, ip, req.body.userAgent);
    const walletData = new Wallet({
      holderId: user.id,
    });
    const referralCode = new ReferralCode({
      holderId: user.id,
    });
    await walletService.createWallet(walletData);
    await referralService.createReferralCode(referralCode);
    const referral = await referralService.redeemReferralCode(req.body.referralCode, user.id);
    res.status(201).send({ user, tokens, referral });
  }
});

const registerFirebaseAccount = catchAsync(async (req, res) => {
  const userVerification = await userSettingService.getVerificationStatus();
  if (userVerification !== null && userVerification.signUpVerification === true) {
    const { countryCode, mobile, token } = req.body;
    const userMobileNumber = `${countryCode}${mobile}`;
    const cleanedUserMobileNumber = userMobileNumber.replace(/\+/g, '');
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (
      decodedToken &&
      decodedToken !== null &&
      decodedToken.phone_number !== null &&
      decodedToken.phone_number !== ''
    ) {
      const cleanedFirebaseMobileNumber = decodedToken.phone_number.replace(/\+/g, '');
      if (cleanedUserMobileNumber === cleanedFirebaseMobileNumber) {
        const user = await userService.createUser(req.body);
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(user, ip, req.body.userAgent);
        const walletData = new Wallet({
          holderId: user.id,
        });
        const referralCode = new ReferralCode({
          holderId: user.id,
        });
        await walletService.createWallet(walletData);
        await referralService.createReferralCode(referralCode);
        const referral = await referralService.redeemReferralCode(req.body.referralCode, user.id);
        res.status(201).send({ user, tokens, referral });
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    const user = await userService.createUser(req.body);
    const ip = req.connection.remoteAddress;
    const tokens = await tokenService.generateAuthTokens(user, ip, req.body.userAgent);
    const walletData = new Wallet({
      holderId: user.id,
    });
    const referralCode = new ReferralCode({
      holderId: user.id,
    });
    await walletService.createWallet(walletData);
    await referralService.createReferralCode(referralCode);
    const referral = await referralService.redeemReferralCode(req.body.referralCode, user.id);
    res.status(201).send({ user, tokens, referral });
  }
});

const createGuestAccount = catchAsync(async (req, res) => {
  const ip = req.connection.remoteAddress;
  const { agent, locale } = req.params;
  const info = await guestUserInfoService.checkRegister(ip, agent);
  if (info == null) {
    const emailRandom = `guest_${(Math.random() + 1).toString(36).substring(2)}@foodbite.com`;
    const randomNumber = '0000000000';
    const appLocale = locale;
    const userBody = {
      email: emailRandom,
      password: `password##${emailRandom}##`,
      firstName: 'Guest',
      lastName: 'User',
      countryCode: 1,
      mobile: randomNumber,
      isEmailVerified: false,
      isMobileVerified: false,
      locale: appLocale,
    };
    const user = await userService.createGuestUser(userBody);
    const tokens = await tokenService.generateAuthTokens(user, ip, agent);
    const walletData = new Wallet({
      holderId: user.id,
    });
    const referralCode = new ReferralCode({
      holderId: user.id,
    });
    await guestUserInfoService.saveGuestMeta({ uid: user.id, ip, agent });
    await walletService.createWallet(walletData);
    await referralService.createReferralCode(referralCode);
    const referral = await referralService.redeemReferralCode(req.body.referralCode, user.id);
    res.status(201).send({ user, tokens, referral, signup: true });
  } else {
    const user = await authService.guestUserLogin(info.user);
    const tokens = await tokenService.generateAuthTokens(user, ip, agent);

    res.send({ user, tokens, signup: false });
  }
});

const registerAdminAccount = catchAsync(async (req, res) => {
  const user = await userService.registerAdminAccountInitial(req.body);
  const tokens = await tokenService.generateAuthTokens(
    user,
    getClientIp(req),
    getClientUserAgent(req)
  );
  setWebAuthCookies(req, res, tokens, true);
  const auth = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
  };
  res.status(201).send({ auth });
});

const userLoginWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, remember, userAgent, locale } = req.body;
  const user = await authService.loginUserWithEmailAndPassword(email, password, locale);
  const ip = req.connection.remoteAddress;
  const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
  if (remember === false) {
    delete tokens.refresh;
  }
  res.send({ user, tokens, success: true });
});

const userLoginWithCountryCodeAndMobilePassword = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, password, remember, userAgent, locale } = req.body;
  const user = await authService.loginUserWithCountryCodeAndPassword(
    countryCode,
    mobileNumber,
    password,
    locale
  );
  const ip = req.connection.remoteAddress;
  const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
  if (remember === false) {
    delete tokens.refresh;
  }
  res.send({ user, tokens, success: true });
});

const userLoginWithEmailOtpVerification = catchAsync(async (req, res) => {
  const { email, locale } = req.body;
  const user = await authService.loginWithEmailOtpVerification(email, locale);
  const otpConfigs = await businessSettingsService.getOtpConfig();
  let generatedOTP;
  let otpType = 'num';
  let otpLengths = 6;
  let canResendOtps = false;
  if (
    otpConfigs &&
    otpConfigs !== null &&
    otpConfigs.otpType &&
    otpConfigs.otpType !== null &&
    otpConfigs.otpType !== ''
  ) {
    otpType = otpConfigs.otpType;
  }

  if (otpConfigs && otpConfigs !== null && otpConfigs.canResendOtp !== null) {
    canResendOtps = otpConfigs.canResendOtp;
  }

  if (
    otpConfigs &&
    otpConfigs !== null &&
    otpConfigs.otpLength &&
    otpConfigs.otpLength !== null &&
    otpConfigs.otpLength !== ''
  ) {
    otpLengths = otpConfigs.otpLength;
  }

  if (otpType === 'num') {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: true,
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  } else if (otpType === 'numstr') {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: true,
      upperCaseAlphabets: true,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  } else {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: false,
      upperCaseAlphabets: true,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  }
  const sendEmail = await emailConfigService.sendVerificationEmail(
    user.email,
    generatedOTP,
    req.body.locale
  );
  if (sendEmail) {
    const otpData = await otpVerificationService.saveOTP({
      provider: req.body.email,
      otp: generatedOTP,
      mode: 'email_otp',
      locale: req.body.locale,
    });
    if (otpData) {
      res.status(201).send({
        sent: true,
        mode: 'email_otp',
        otpLength: otpLengths,
        canResendOtp: canResendOtps,
        id: otpData.id,
        provider: req.body.email,
      });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const userLoginWithEmailOtp = catchAsync(async (req, res) => {
  const { email, remember, userAgent, locale, verificationId, verificationCode } = req.body;
  const verificationStatus = await otpVerificationService.verifyOtpForAuthentication(
    verificationId,
    verificationCode
  );
  if (
    verificationStatus !== null &&
    verificationStatus.id &&
    verificationStatus.id !== null &&
    verificationStatus.id !== '' &&
    verificationStatus.id === verificationId
  ) {
    const user = await authService.loginWithEmailOtpVerification(email, locale);
    const ip = req.connection.remoteAddress;
    const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
    if (remember === false) {
      delete tokens.refresh;
    }
    res.send({ user, tokens, success: true });
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const userLoginWithPhoneOtpVerification = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale } = req.body;
  const user = await authService.loginUserWithPhoneOTP(countryCode, mobileNumber, locale);
  const toNumber = `+${user.countryCode}${user.mobile}`;
  const smsProvider = await smsProviderConfigService.sendOTPSMS(
    user.countryCode,
    user.mobile,
    toNumber,
    locale
  );
  res.send(smsProvider);
});

const verifyUserLoginFirebaseOTP = catchAsync(async (req, res) => {
  try {
    const { countryCode, mobileNumber, token, locale, remember, userAgent } = req.body;
    const userMobileNumber = `${countryCode}${mobileNumber}`;
    const cleanedUserMobileNumber = userMobileNumber.replace(/\+/g, '');
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (
      decodedToken &&
      decodedToken !== null &&
      decodedToken.phone_number !== null &&
      decodedToken.phone_number !== ''
    ) {
      const cleanedFirebaseMobileNumber = decodedToken.phone_number.replace(/\+/g, '');
      if (cleanedUserMobileNumber === cleanedFirebaseMobileNumber) {
        const user = await authService.loginUserWithPhoneOTP(countryCode, mobileNumber, locale);
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
        if (remember === false) {
          delete tokens.refresh;
        }
        res.send({ user, tokens, success: true });
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error, extra: '' });
  }
});

const userLoginWithPhoneOTP = catchAsync(async (req, res) => {
  const { id, locale, remember, userAgent } = req.body;
  const verification = await otpVerificationService.verifyWithPhoneOTP(id);
  if (verification && verification !== null && verification.id === id) {
    const mobileNumber = verification.provider.split(',');
    if (checkArrayNotEmpty(mobileNumber) && mobileNumber.length === 3) {
      const user = await authService.loginUserWithPhoneOTP(
        mobileNumber[0],
        mobileNumber[1],
        locale
      );
      const ip = req.connection.remoteAddress;
      const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
      if (remember === false) {
        delete tokens.refresh;
      }
      res.send({ user, tokens, success: true });
    } else {
      res.status(404).send({ code: 404, message: 'Not found', extra: '' });
    }
  } else {
    res.status(404).send({ code: 404, message: 'Not found', extra: '' });
  }
});

const adminLoginWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, remember } = req.body;
  const user = await authService.loginAdminWithEmailAndPassword(email, password);
  const tokens = await tokenService.generateAuthTokens(
    user,
    getClientIp(req),
    getClientUserAgent(req)
  );
  setWebAuthCookies(req, res, tokens, remember);
  const auth = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
  };
  res.status(201).send({ auth });
});

const vendorLoginWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, remember, userAgent, locale } = req.body;
  const user = await authService.loginVendorWithEmailAndPassword(email, password, locale);
  const ip = req.connection.remoteAddress;
  const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
  const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
  if (remember === false) {
    delete tokens.refresh;
  }
  if (user && user.role === 'vendorOutlet') {
    const manager = await restaurantService.getRestaurantByIdVendorLogin(vendor.outletManagerId);
    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
    res.send({ user, tokens, vendor, manager, restaurant });
  } else {
    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
    res.send({ user, tokens, vendor, restaurant });
  }
});

const vendorWebLoginWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, locale, remember } = req.body;
  const user = await authService.loginVendorWithEmailAndPassword(email, password, locale);
  const tokens = await tokenService.generateAuthTokens(
    user,
    getClientIp(req),
    getClientUserAgent(req)
  );
  setWebAuthCookies(req, res, tokens, remember);
  const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
  if (user && user.role === 'vendorOutlet') {
    const manager = await restaurantService.getRestaurantByIdVendorLogin(vendor.outletManagerId);
    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
    res.send({ user, vendor, manager, restaurant });
  } else {
    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
    res.send({ user, vendor, restaurant });
  }
});

const vendorLoginWithCountryCodeAndMobilePassword = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, password, remember, userAgent, locale } = req.body;
  const user = await authService.loginVendorWithPhoneAndPassword(
    countryCode,
    mobileNumber,
    password,
    locale
  );
  const ip = req.connection.remoteAddress;
  const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
  const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
  if (remember === false) {
    delete tokens.refresh;
  }
  if (user && user.role === 'vendorOutlet') {
    const manager = await restaurantService.getRestaurantByIdVendorLogin(vendor.outletManagerId);
    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
    res.send({ user, tokens, vendor, manager, restaurant });
  } else {
    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
    res.send({ user, tokens, vendor, restaurant });
  }
});

const vendorWebLoginWithCountryCodeAndMobilePassword = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, password, remember, locale } = req.body;
  const user = await authService.loginVendorWithPhoneAndPassword(
    countryCode,
    mobileNumber,
    password,
    locale
  );
  const tokens = await tokenService.generateAuthTokens(
    user,
    getClientIp(req),
    getClientUserAgent(req)
  );
  setWebAuthCookies(req, res, tokens, remember);
  const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
  if (user && user.role === 'vendorOutlet') {
    const manager = await restaurantService.getRestaurantByIdVendorLogin(vendor.outletManagerId);
    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
    res.send({ user, vendor, manager, restaurant });
  } else {
    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
    res.send({ user, vendor, restaurant });
  }
});

const vendorLoginWithEmailOtpVerification = catchAsync(async (req, res) => {
  const { email, locale } = req.body;
  const user = await authService.vendorLoginWithEmailOtpVerification(email, locale);
  const otpConfigs = await businessSettingsService.getOtpConfig();
  let generatedOTP;
  let otpType = 'num';
  let otpLengths = 6;
  let canResendOtps = false;
  if (
    otpConfigs &&
    otpConfigs !== null &&
    otpConfigs.otpType &&
    otpConfigs.otpType !== null &&
    otpConfigs.otpType !== ''
  ) {
    otpType = otpConfigs.otpType;
  }

  if (otpConfigs && otpConfigs !== null && otpConfigs.canResendOtp !== null) {
    canResendOtps = otpConfigs.canResendOtp;
  }

  if (
    otpConfigs &&
    otpConfigs !== null &&
    otpConfigs.otpLength &&
    otpConfigs.otpLength !== null &&
    otpConfigs.otpLength !== ''
  ) {
    otpLengths = otpConfigs.otpLength;
  }

  if (otpType === 'num') {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: true,
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  } else if (otpType === 'numstr') {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: true,
      upperCaseAlphabets: true,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  } else {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: false,
      upperCaseAlphabets: true,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  }
  const sendEmail = await emailConfigService.sendVerificationEmail(
    user.email,
    generatedOTP,
    req.body.locale
  );
  if (sendEmail) {
    const otpData = await otpVerificationService.saveOTP({
      provider: req.body.email,
      otp: generatedOTP,
      mode: 'email_otp',
      locale: req.body.locale,
    });
    if (otpData) {
      res.status(201).send({
        sent: true,
        mode: 'email_otp',
        otpLength: otpLengths,
        canResendOtp: canResendOtps,
        id: otpData.id,
        provider: req.body.email,
      });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const vendorLoginWithEmailOtp = catchAsync(async (req, res) => {
  const { email, remember, userAgent, locale, verificationId, verificationCode } = req.body;
  const verificationStatus = await otpVerificationService.verifyOtpForAuthentication(
    verificationId,
    verificationCode
  );
  if (
    verificationStatus !== null &&
    verificationStatus.id &&
    verificationStatus.id !== null &&
    verificationStatus.id !== '' &&
    verificationStatus.id === verificationId
  ) {
    const user = await authService.vendorLoginWithEmailOtpVerification(email, locale);
    const ip = req.connection.remoteAddress;
    const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
    const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
    if (remember === false) {
      delete tokens.refresh;
    }
    if (user && user.role === 'vendorOutlet') {
      const manager = await restaurantService.getRestaurantByIdVendorLogin(vendor.outletManagerId);
      const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
      res.send({ user, tokens, vendor, manager, restaurant });
    } else {
      const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
      res.send({ user, tokens, vendor, restaurant });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const vendorWebLoginWithEmailOtp = catchAsync(async (req, res) => {
  const { email, remember, locale, verificationId, verificationCode } = req.body;
  const verificationStatus = await otpVerificationService.verifyOtpForAuthentication(
    verificationId,
    verificationCode
  );
  if (
    verificationStatus !== null &&
    verificationStatus.id &&
    verificationStatus.id !== null &&
    verificationStatus.id !== '' &&
    verificationStatus.id === verificationId
  ) {
    const user = await authService.vendorLoginWithEmailOtpVerification(email, locale);
    const tokens = await tokenService.generateAuthTokens(
      user,
      getClientIp(req),
      getClientUserAgent(req)
    );
    setWebAuthCookies(req, res, tokens, remember);
    const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
    if (user && user.role === 'vendorOutlet') {
      const manager = await restaurantService.getRestaurantByIdVendorLogin(vendor.outletManagerId);
      const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
      res.send({ user, vendor, manager, restaurant });
    } else {
      const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
      res.send({ user, vendor, restaurant });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const vendorLoginWithPhoneOtpVerification = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale } = req.body;
  const user = await authService.vendorLoginWithPhoneOTP(countryCode, mobileNumber, locale);
  const toNumber = `+${user.countryCode}${user.mobile}`;
  const smsProvider = await smsProviderConfigService.sendOTPSMS(
    user.countryCode,
    user.mobile,
    toNumber,
    locale
  );
  res.send(smsProvider);
});

const vendorWebLoginWithPhoneOtpVerification = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale, redirectUrl } = req.body;
  const user = await authService.vendorLoginWithPhoneOTP(countryCode, mobileNumber, locale);
  const toNumber = `+${user.countryCode}${user.mobile}`;
  const smsProvider = await smsProviderConfigService.sendOTPSMS(
    user.countryCode,
    user.mobile,
    toNumber,
    locale,
    'web',
    redirectUrl,
    'login'
  );
  res.send(smsProvider);
  // res.send({ user, countryCode, mobileNumber, locale, redirectUrl });
});

const vendorLoginWithPhoneOTP = catchAsync(async (req, res) => {
  const { id, locale, remember, userAgent } = req.body;
  const verification = await otpVerificationService.verifyWithPhoneOTP(id);
  if (verification && verification !== null && verification.id === id) {
    const mobileNumber = verification.provider.split(',');
    if (checkArrayNotEmpty(mobileNumber) && mobileNumber.length === 3) {
      const user = await authService.vendorLoginWithPhoneOTP(
        mobileNumber[0],
        mobileNumber[1],
        locale
      );
      const ip = req.connection.remoteAddress;
      const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
      const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
      if (remember === false) {
        delete tokens.refresh;
      }
      if (user && user.role === 'vendorOutlet') {
        const manager = await restaurantService.getRestaurantByIdVendorLogin(
          vendor.outletManagerId
        );
        const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
        res.send({ user, tokens, vendor, manager, restaurant });
      } else {
        const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
        res.send({ user, tokens, vendor, restaurant });
      }
    } else {
      res.status(404).send({ code: 404, message: 'Not found', extra: '' });
    }
  } else {
    res.status(404).send({ code: 404, message: 'Not found', extra: '' });
  }
});

const vendorWebLoginWithPhoneOTP = catchAsync(async (req, res) => {
  const { id, locale, remember } = req.body;
  const verification = await otpVerificationService.verifyWithPhoneOTP(id);
  if (verification && verification !== null && verification.id === id) {
    const mobileNumber = verification.provider.split(',');
    if (checkArrayNotEmpty(mobileNumber) && mobileNumber.length === 3) {
      const user = await authService.vendorLoginWithPhoneOTP(
        mobileNumber[0],
        mobileNumber[1],
        locale
      );
      const tokens = await tokenService.generateAuthTokens(
        user,
        getClientIp(req),
        getClientUserAgent(req)
      );
      setWebAuthCookies(req, res, tokens, remember);
      const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
      if (user && user.role === 'vendorOutlet') {
        const manager = await restaurantService.getRestaurantByIdVendorLogin(
          vendor.outletManagerId
        );
        const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
        res.send({ user, vendor, manager, restaurant });
      } else {
        const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
        res.send({ user, vendor, restaurant });
      }
    } else {
      res.status(404).send({ code: 404, message: 'Not found', extra: '' });
    }
  } else {
    res.status(404).send({ code: 404, message: 'Not found', extra: '' });
  }
});

const verifyVendorLoginFirebaseOTP = catchAsync(async (req, res) => {
  try {
    const { countryCode, mobileNumber, token, locale, remember, userAgent } = req.body;
    const userMobileNumber = `${countryCode}${mobileNumber}`;
    const cleanedUserMobileNumber = userMobileNumber.replace(/\+/g, '');
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (
      decodedToken &&
      decodedToken !== null &&
      decodedToken.phone_number !== null &&
      decodedToken.phone_number !== ''
    ) {
      const cleanedFirebaseMobileNumber = decodedToken.phone_number.replace(/\+/g, '');
      if (cleanedUserMobileNumber === cleanedFirebaseMobileNumber) {
        const user = await authService.vendorLoginWithPhoneOTP(countryCode, mobileNumber, locale);
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
        const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
        if (remember === false) {
          delete tokens.refresh;
        }
        if (user && user.role === 'vendorOutlet') {
          const manager = await restaurantService.getRestaurantByIdVendorLogin(
            vendor.outletManagerId
          );
          const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
          res.send({ user, tokens, vendor, manager, restaurant });
        } else {
          const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
          res.send({ user, tokens, vendor, restaurant });
        }
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error, extra: '' });
  }
});

const verifyWebVendorLoginFirebaseOTP = catchAsync(async (req, res) => {
  try {
    const { countryCode, mobileNumber, token, locale, remember, userAgent } = req.body;
    const userMobileNumber = `${countryCode}${mobileNumber}`;
    const cleanedUserMobileNumber = userMobileNumber.replace(/\+/g, '');
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (
      decodedToken &&
      decodedToken !== null &&
      decodedToken.phone_number !== null &&
      decodedToken.phone_number !== ''
    ) {
      const cleanedFirebaseMobileNumber = decodedToken.phone_number.replace(/\+/g, '');
      if (cleanedUserMobileNumber === cleanedFirebaseMobileNumber) {
        const user = await authService.vendorLoginWithPhoneOTP(countryCode, mobileNumber, locale);
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
        const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
        if (remember === false) {
          delete tokens.refresh;
        }
        if (user && user.role === 'vendorOutlet') {
          const manager = await restaurantService.getRestaurantByIdVendorLogin(
            vendor.outletManagerId
          );
          const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
          res.send({ user, tokens, vendor, manager, restaurant });
        } else {
          const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
          res.send({ user, tokens, vendor, restaurant });
        }
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error, extra: '' });
  }
});

const driverLognWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, remember, userAgent, locale } = req.body;
  const user = await authService.loginDriverWithEmailAndPassword(email, password, locale);
  const ip = req.connection.remoteAddress;
  const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
  if (remember === false) {
    delete tokens.refresh;
  }
  res.send({ user, tokens });
});

const driverLoginWithCountryCodeAndMobilePassword = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, password, remember, userAgent, locale } = req.body;
  const user = await authService.loginDriverWithCountryCodeAndPassword(
    countryCode,
    mobileNumber,
    password,
    locale
  );
  const ip = req.connection.remoteAddress;
  const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
  if (remember === false) {
    delete tokens.refresh;
  }
  res.send({ user, tokens });
});

const driverLoginWithEmailOtpVerification = catchAsync(async (req, res) => {
  const { email, locale } = req.body;
  const user = await authService.loginDriverWithEmailOtpVerification(email, locale);
  const otpConfigs = await businessSettingsService.getOtpConfig();
  let generatedOTP;
  let otpType = 'num';
  let otpLengths = 6;
  let canResendOtps = false;
  if (
    otpConfigs &&
    otpConfigs !== null &&
    otpConfigs.otpType &&
    otpConfigs.otpType !== null &&
    otpConfigs.otpType !== ''
  ) {
    otpType = otpConfigs.otpType;
  }

  if (otpConfigs && otpConfigs !== null && otpConfigs.canResendOtp !== null) {
    canResendOtps = otpConfigs.canResendOtp;
  }

  if (
    otpConfigs &&
    otpConfigs !== null &&
    otpConfigs.otpLength &&
    otpConfigs.otpLength !== null &&
    otpConfigs.otpLength !== ''
  ) {
    otpLengths = otpConfigs.otpLength;
  }

  if (otpType === 'num') {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: true,
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  } else if (otpType === 'numstr') {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: true,
      upperCaseAlphabets: true,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  } else {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: false,
      upperCaseAlphabets: true,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  }
  const sendEmail = await emailConfigService.sendVerificationEmail(
    user.email,
    generatedOTP,
    req.body.locale
  );
  if (sendEmail) {
    const otpData = await otpVerificationService.saveOTP({
      provider: req.body.email,
      otp: generatedOTP,
      mode: 'email_otp',
      locale: req.body.locale,
    });
    if (otpData) {
      res.status(201).send({
        sent: true,
        mode: 'email_otp',
        otpLength: otpLengths,
        canResendOtp: canResendOtps,
        id: otpData.id,
        provider: req.body.email,
      });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const driverLoginWithEmailOtp = catchAsync(async (req, res) => {
  const { email, remember, userAgent, locale, verificationId, verificationCode } = req.body;
  const verificationStatus = await otpVerificationService.verifyOtpForAuthentication(
    verificationId,
    verificationCode
  );
  if (
    verificationStatus !== null &&
    verificationStatus.id &&
    verificationStatus.id !== null &&
    verificationStatus.id !== '' &&
    verificationStatus.id === verificationId
  ) {
    const user = await authService.loginDriverWithEmailOtpVerification(email, locale);
    const ip = req.connection.remoteAddress;
    const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
    if (remember === false) {
      delete tokens.refresh;
    }
    res.send({ user, tokens });
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const driverLoginWithPhoneOtpVerification = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale } = req.body;
  const user = await authService.driverLoginWithPhoneOTP(countryCode, mobileNumber, locale);
  const toNumber = `+${user.countryCode}${user.mobile}`;
  const smsProvider = await smsProviderConfigService.sendOTPSMS(
    user.countryCode,
    user.mobile,
    toNumber,
    locale
  );
  res.send(smsProvider);
});

const driverLoginWithPhoneOTP = catchAsync(async (req, res) => {
  const { id, locale, remember, userAgent } = req.body;
  const verification = await otpVerificationService.verifyWithPhoneOTP(id);
  if (verification && verification !== null && verification.id === id) {
    const mobileNumber = verification.provider.split(',');
    if (checkArrayNotEmpty(mobileNumber) && mobileNumber.length === 3) {
      const user = await authService.driverLoginWithPhoneOTP(
        mobileNumber[0],
        mobileNumber[1],
        locale
      );
      const ip = req.connection.remoteAddress;
      const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
      if (remember === false) {
        delete tokens.refresh;
      }
      res.send({ user, tokens });
    } else {
      res.status(404).send({ code: 404, message: 'Not found', extra: '' });
    }
  } else {
    res.status(404).send({ code: 404, message: 'Not found', extra: '' });
  }
});

const verifyDriverLoginFirebaseOTP = catchAsync(async (req, res) => {
  try {
    const { countryCode, mobileNumber, token, locale, remember, userAgent } = req.body;
    const userMobileNumber = `${countryCode}${mobileNumber}`;
    const cleanedUserMobileNumber = userMobileNumber.replace(/\+/g, '');
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (
      decodedToken &&
      decodedToken !== null &&
      decodedToken.phone_number !== null &&
      decodedToken.phone_number !== ''
    ) {
      const cleanedFirebaseMobileNumber = decodedToken.phone_number.replace(/\+/g, '');
      if (cleanedUserMobileNumber === cleanedFirebaseMobileNumber) {
        const user = await authService.driverLoginWithPhoneOTP(countryCode, mobileNumber, locale);
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
        if (remember === false) {
          delete tokens.refresh;
        }
        res.send({ user, tokens });
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error, extra: '' });
  }
});

const waiterLognWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, remember, userAgent, locale } = req.body;
  const user = await authService.loginWaiterWithEmailAndPassword(email, password, locale);
  const ip = req.connection.remoteAddress;
  const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
  const waiter = await waiterService.getWaiterLoginInfo(user.id);
  if (remember === false) {
    delete tokens.refresh;
  }
  res.send({ user, tokens, waiter });
});

const waiterLoginWithPhoneAndPassword = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, password, remember, userAgent, locale } = req.body;
  const user = await authService.loginWaiterWithCountryCodeAndPassword(
    countryCode,
    mobileNumber,
    password,
    locale
  );
  const ip = req.connection.remoteAddress;
  const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
  const waiter = await waiterService.getWaiterLoginInfo(user.id);
  if (remember === false) {
    delete tokens.refresh;
  }
  res.send({ user, tokens, waiter });
});

const waiterLoginWithEmailOtpVerification = catchAsync(async (req, res) => {
  const { email, locale } = req.body;
  const user = await authService.loginWaiterWithEmailOtpVerification(email, locale);
  const otpConfigs = await businessSettingsService.getOtpConfig();
  let generatedOTP;
  let otpType = 'num';
  let otpLengths = 6;
  let canResendOtps = false;
  if (
    otpConfigs &&
    otpConfigs !== null &&
    otpConfigs.otpType &&
    otpConfigs.otpType !== null &&
    otpConfigs.otpType !== ''
  ) {
    otpType = otpConfigs.otpType;
  }

  if (otpConfigs && otpConfigs !== null && otpConfigs.canResendOtp !== null) {
    canResendOtps = otpConfigs.canResendOtp;
  }

  if (
    otpConfigs &&
    otpConfigs !== null &&
    otpConfigs.otpLength &&
    otpConfigs.otpLength !== null &&
    otpConfigs.otpLength !== ''
  ) {
    otpLengths = otpConfigs.otpLength;
  }

  if (otpType === 'num') {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: true,
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  } else if (otpType === 'numstr') {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: true,
      upperCaseAlphabets: true,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  } else {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: false,
      upperCaseAlphabets: true,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  }
  const sendEmail = await emailConfigService.sendVerificationEmail(
    user.email,
    generatedOTP,
    req.body.locale
  );
  if (sendEmail) {
    const otpData = await otpVerificationService.saveOTP({
      provider: req.body.email,
      otp: generatedOTP,
      mode: 'email_otp',
      locale: req.body.locale,
    });
    if (otpData) {
      res.status(201).send({
        sent: true,
        mode: 'email_otp',
        otpLength: otpLengths,
        canResendOtp: canResendOtps,
        id: otpData.id,
        provider: req.body.email,
      });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const waiterLoginWithEmailOtp = catchAsync(async (req, res) => {
  const { email, remember, userAgent, locale, verificationId, verificationCode } = req.body;
  const verificationStatus = await otpVerificationService.verifyOtpForAuthentication(
    verificationId,
    verificationCode
  );
  if (
    verificationStatus !== null &&
    verificationStatus.id &&
    verificationStatus.id !== null &&
    verificationStatus.id !== '' &&
    verificationStatus.id === verificationId
  ) {
    const user = await authService.loginWaiterWithEmailOtpVerification(email, locale);
    const ip = req.connection.remoteAddress;
    const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
    const waiter = await waiterService.getWaiterLoginInfo(user.id);
    if (remember === false) {
      delete tokens.refresh;
    }
    res.send({ user, tokens, waiter });
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const waiterLoginWithPhoneOtpVerification = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale } = req.body;
  const user = await authService.loginWaiterWithPhoneOTP(countryCode, mobileNumber, locale);
  const toNumber = `+${user.countryCode}${user.mobile}`;
  const smsProvider = await smsProviderConfigService.sendOTPSMS(
    user.countryCode,
    user.mobile,
    toNumber,
    locale
  );
  res.send(smsProvider);
});

const waiterLoginWithPhoneOTP = catchAsync(async (req, res) => {
  const { id, locale, remember, userAgent } = req.body;
  const verification = await otpVerificationService.verifyWithPhoneOTP(id);
  if (verification && verification !== null && verification.id === id) {
    const mobileNumber = verification.provider.split(',');
    if (checkArrayNotEmpty(mobileNumber) && mobileNumber.length === 3) {
      const user = await authService.loginWaiterWithPhoneOTP(
        mobileNumber[0],
        mobileNumber[1],
        locale
      );
      const ip = req.connection.remoteAddress;
      const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
      const waiter = await waiterService.getWaiterLoginInfo(user.id);
      if (remember === false) {
        delete tokens.refresh;
      }
      res.send({ user, tokens, waiter });
    } else {
      res.status(404).send({ code: 404, message: 'Not found', extra: '' });
    }
  } else {
    res.status(404).send({ code: 404, message: 'Not found', extra: '' });
  }
});

const verifyWaiterLoginFirebaseOTP = catchAsync(async (req, res) => {
  try {
    const { countryCode, mobileNumber, token, locale, remember, userAgent } = req.body;
    const userMobileNumber = `${countryCode}${mobileNumber}`;
    const cleanedUserMobileNumber = userMobileNumber.replace(/\+/g, '');
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (
      decodedToken &&
      decodedToken !== null &&
      decodedToken.phone_number !== null &&
      decodedToken.phone_number !== ''
    ) {
      const cleanedFirebaseMobileNumber = decodedToken.phone_number.replace(/\+/g, '');
      if (cleanedUserMobileNumber === cleanedFirebaseMobileNumber) {
        const user = await authService.loginWaiterWithPhoneOTP(countryCode, mobileNumber, locale);
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
        const waiter = await waiterService.getWaiterLoginInfo(user.id);
        if (remember === false) {
          delete tokens.refresh;
        }
        res.send({ user, tokens, waiter });
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error, extra: '' });
  }
});

const kitchenOwnerLoginWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, remember, userAgent, locale } = req.body;
  const user = await authService.loginKitchenOwnerWithEmailAndPassword(email, password, locale);
  const ip = req.connection.remoteAddress;
  const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
  const owner = await kitchenOwnerService.getKitchenLoginInfo(user.id);
  if (remember === false) {
    delete tokens.refresh;
  }
  res.send({ user, tokens, owner });
});

const kitchenLoginWithEmailOtpVerification = catchAsync(async (req, res) => {
  const { email, locale } = req.body;
  const user = await authService.loginKitchenWithEmailOtpVerification(email, locale);
  const otpConfigs = await businessSettingsService.getOtpConfig();
  let generatedOTP;
  let otpType = 'num';
  let otpLengths = 6;
  let canResendOtps = false;
  if (
    otpConfigs &&
    otpConfigs !== null &&
    otpConfigs.otpType &&
    otpConfigs.otpType !== null &&
    otpConfigs.otpType !== ''
  ) {
    otpType = otpConfigs.otpType;
  }

  if (otpConfigs && otpConfigs !== null && otpConfigs.canResendOtp !== null) {
    canResendOtps = otpConfigs.canResendOtp;
  }

  if (
    otpConfigs &&
    otpConfigs !== null &&
    otpConfigs.otpLength &&
    otpConfigs.otpLength !== null &&
    otpConfigs.otpLength !== ''
  ) {
    otpLengths = otpConfigs.otpLength;
  }

  if (otpType === 'num') {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: true,
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  } else if (otpType === 'numstr') {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: true,
      upperCaseAlphabets: true,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  } else {
    generatedOTP = otpGenerator.generate(otpLengths, {
      digits: false,
      upperCaseAlphabets: true,
      lowerCaseAlphabets: false,
      specialChars: false,
    });
  }
  const sendEmail = await emailConfigService.sendVerificationEmail(
    user.email,
    generatedOTP,
    req.body.locale
  );
  if (sendEmail) {
    const otpData = await otpVerificationService.saveOTP({
      provider: req.body.email,
      otp: generatedOTP,
      mode: 'email_otp',
      locale: req.body.locale,
    });
    if (otpData) {
      res.status(201).send({
        sent: true,
        mode: 'email_otp',
        otpLength: otpLengths,
        canResendOtp: canResendOtps,
        id: otpData.id,
        provider: req.body.email,
      });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const kitchenLoginWithEmailOtp = catchAsync(async (req, res) => {
  const { email, remember, userAgent, locale, verificationId, verificationCode } = req.body;
  const verificationStatus = await otpVerificationService.verifyOtpForAuthentication(
    verificationId,
    verificationCode
  );
  if (
    verificationStatus !== null &&
    verificationStatus.id &&
    verificationStatus.id !== null &&
    verificationStatus.id !== '' &&
    verificationStatus.id === verificationId
  ) {
    const user = await authService.loginKitchenWithEmailOtpVerification(email, locale);
    const ip = req.connection.remoteAddress;
    const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
    const owner = await kitchenOwnerService.getKitchenLoginInfo(user.id);
    if (remember === false) {
      delete tokens.refresh;
    }
    res.send({ user, tokens, owner });
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const kitchenLoginWithPhoneAndPassword = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, password, remember, userAgent, locale } = req.body;
  const user = await authService.loginKitchenWithCountryCodeAndPassword(
    countryCode,
    mobileNumber,
    password,
    locale
  );
  const ip = req.connection.remoteAddress;
  const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
  const owner = await kitchenOwnerService.getKitchenLoginInfo(user.id);
  if (remember === false) {
    delete tokens.refresh;
  }
  res.send({ user, tokens, owner });
});

const kitchenLoginWithPhoneOtpVerification = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale } = req.body;
  const user = await authService.loginKitchenWithPhoneOTP(countryCode, mobileNumber, locale);
  const toNumber = `+${user.countryCode}${user.mobile}`;
  const smsProvider = await smsProviderConfigService.sendOTPSMS(
    user.countryCode,
    user.mobile,
    toNumber,
    locale
  );
  res.send(smsProvider);
});

const kitchenLoginWithPhoneOTP = catchAsync(async (req, res) => {
  const { id, locale, remember, userAgent } = req.body;
  const verification = await otpVerificationService.verifyWithPhoneOTP(id);
  if (verification && verification !== null && verification.id === id) {
    const mobileNumber = verification.provider.split(',');
    if (checkArrayNotEmpty(mobileNumber) && mobileNumber.length === 3) {
      const user = await authService.loginKitchenWithPhoneOTP(
        mobileNumber[0],
        mobileNumber[1],
        locale
      );
      const ip = req.connection.remoteAddress;
      const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
      const owner = await kitchenOwnerService.getKitchenLoginInfo(user.id);
      if (remember === false) {
        delete tokens.refresh;
      }
      res.send({ user, tokens, owner });
    } else {
      res.status(404).send({ code: 404, message: 'Not found', extra: '' });
    }
  } else {
    res.status(404).send({ code: 404, message: 'Not found', extra: '' });
  }
});

const dairyLoginWithPhoneOtpVerification = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale } = req.body;
  const user = await authService.loginDairyWithPhoneOTP(countryCode, mobileNumber, locale);
  const toNumber = `+${user.countryCode}${user.mobile}`;
  const smsProvider = await smsProviderConfigService.sendOTPSMS(
    user.countryCode,
    user.mobile,
    toNumber,
    locale
  );
  res.send(smsProvider);
});

const dairyLoginWithPhoneOTP = catchAsync(async (req, res) => {
  const { id, locale, remember, userAgent } = req.body;
  const verification = await otpVerificationService.verifyWithPhoneOTP(id);
  if (verification && verification !== null && verification.id === id) {
    const mobileNumber = verification.provider.split(',');
    if (checkArrayNotEmpty(mobileNumber) && mobileNumber.length === 3) {
      const user = await authService.loginDairyWithPhoneOTP(
        mobileNumber[0],
        mobileNumber[1],
        locale
      );
      const ip = req.connection.remoteAddress;
      const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
      const profile = await dairyProfileService.getDairyLoginInfo(user.id);
      if (remember === false) {
        delete tokens.refresh;
      }
      res.send({ user, tokens, profile });
    } else {
      res.status(404).send({ code: 404, message: 'Not found', extra: '' });
    }
  } else {
    res.status(404).send({ code: 404, message: 'Not found', extra: '' });
  }
});

const verifyKitchenLoginFirebaseOTP = catchAsync(async (req, res) => {
  try {
    const { countryCode, mobileNumber, token, locale, remember, userAgent } = req.body;
    const userMobileNumber = `${countryCode}${mobileNumber}`;
    const cleanedUserMobileNumber = userMobileNumber.replace(/\+/g, '');
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (
      decodedToken &&
      decodedToken !== null &&
      decodedToken.phone_number !== null &&
      decodedToken.phone_number !== ''
    ) {
      const cleanedFirebaseMobileNumber = decodedToken.phone_number.replace(/\+/g, '');
      if (cleanedUserMobileNumber === cleanedFirebaseMobileNumber) {
        const user = await authService.loginKitchenWithPhoneOTP(countryCode, mobileNumber, locale);
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
        const owner = await kitchenOwnerService.getKitchenLoginInfo(user.id);
        if (remember === false) {
          delete tokens.refresh;
        }
        res.send({ user, tokens, owner });
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error, extra: '' });
  }
});

const logout = catchAsync(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  res.send({ success: true });
});

const logoutWeb = catchAsync(async (req, res) => {
  const refreshToken = req.cookies?.[config.jwt.refreshCookieName];
  await authService.logoutWeb(refreshToken);
  clearWebAuthCookies(res);
  res.send({ success: true });
});

const refreshTokensWeb = catchAsync(async (req, res) => {
  const refreshToken = req.cookies?.[config.jwt.refreshCookieName];
  if (!refreshToken) {
    return res.status(401).json({ success: false, message: 'Refresh token missing' });
  }

  const tokenDoc = await tokenService.verifyRefreshToken(refreshToken);
  const user = await userService.getUserById(tokenDoc.user);

  if (!user) {
    return res.status(401).json({ success: false, message: 'User not found' });
  }

  const tokens = await tokenService.generateAuthTokens(
    user,
    getClientIp(req),
    getClientUserAgent(req)
  );
  setWebAuthCookies(req, res, tokens, true);

  return res.status(200).json({ success: true });
});

const refreshTokensApp = catchAsync(async (req, res) => {
  const tokens = await authService.refreshAuthApp(req.body.refreshToken);
  res.send({ ...tokens });
});

const forgotPasswordWithEmail = catchAsync(async (req, res) => {
  const resetPasswordToken = await tokenService.generateResetPasswordToken(req.body.email);
  if (resetPasswordToken && resetPasswordToken !== null && resetPasswordToken !== '') {
    const otpConfigs = await businessSettingsService.getOtpConfig();
    let generatedOTP;
    let otpType = 'num';
    let otpLengths = 6;
    let canResendOtps = false;
    if (
      otpConfigs &&
      otpConfigs !== null &&
      otpConfigs.otpType &&
      otpConfigs.otpType !== null &&
      otpConfigs.otpType !== ''
    ) {
      otpType = otpConfigs.otpType;
    }

    if (otpConfigs && otpConfigs !== null && otpConfigs.canResendOtp !== null) {
      canResendOtps = otpConfigs.canResendOtp;
    }

    if (
      otpConfigs &&
      otpConfigs !== null &&
      otpConfigs.otpLength &&
      otpConfigs.otpLength !== null &&
      otpConfigs.otpLength !== ''
    ) {
      otpLengths = otpConfigs.otpLength;
    }

    if (otpType === 'num') {
      generatedOTP = otpGenerator.generate(otpLengths, {
        digits: true,
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
    } else if (otpType === 'numstr') {
      generatedOTP = otpGenerator.generate(otpLengths, {
        digits: true,
        upperCaseAlphabets: true,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
    } else {
      generatedOTP = otpGenerator.generate(otpLengths, {
        digits: false,
        upperCaseAlphabets: true,
        lowerCaseAlphabets: false,
        specialChars: false,
      });
    }
    const sendEmail = await emailConfigService.sendVerificationEmail(
      req.body.email,
      generatedOTP,
      req.body.locale
    );
    if (sendEmail) {
      const otpData = await otpVerificationService.saveOTP({
        provider: req.body.email,
        otp: generatedOTP,
        mode: 'email_otp',
        locale: req.body.locale,
      });
      if (otpData) {
        res.status(201).send({
          sent: false,
          target: 'otp_screen',
          method: 'email_otp',
          otpLength: otpLengths,
          canResendOtp: canResendOtps,
          id: otpData.id,
          provider: req.body.email,
          token: resetPasswordToken,
        });
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const forgotPasswordWithPhone = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale } = req.body;
  const resetPasswordToken = await tokenService.generateResetPasswordTokenWithPhone(
    countryCode,
    mobileNumber
  );
  if (resetPasswordToken && resetPasswordToken !== null && resetPasswordToken !== '') {
    const toNumber = `${countryCode}${mobileNumber}`;
    const smsProvider = await smsProviderConfigService.sendOTPSMS(
      countryCode,
      mobileNumber,
      toNumber,
      locale
    );
    if (smsProvider && smsProvider !== null && smsProvider.id !== null && smsProvider.id !== '') {
      res.status(201).send({
        sent: false,
        target: smsProvider.target,
        method: smsProvider.method,
        otpLength: smsProvider.otpLength,
        canResendOtp: smsProvider.canResendOtp,
        id: smsProvider.id,
        provider: smsProvider.provider,
        token: resetPasswordToken,
      });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
  // res.send({ resetPasswordToken });
});

const forgotWebPasswordWithPhone = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale, redirectUrl } = req.body;
  const resetPasswordToken = await tokenService.generateResetPasswordTokenWithPhone(
    countryCode,
    mobileNumber
  );
  if (resetPasswordToken && resetPasswordToken !== null && resetPasswordToken !== '') {
    const toNumber = `${countryCode}${mobileNumber}`;
    const smsProvider = await smsProviderConfigService.sendOTPSMS(
      countryCode,
      mobileNumber,
      toNumber,
      locale,
      'web',
      redirectUrl,
      'reset'
    );
    if (smsProvider && smsProvider !== null && smsProvider.id !== null && smsProvider.id !== '') {
      res.status(201).send({
        sent: false,
        target: smsProvider.target,
        method: smsProvider.method,
        otpLength: smsProvider.otpLength,
        canResendOtp: smsProvider.canResendOtp,
        id: smsProvider.id,
        provider: smsProvider.provider,
        token: resetPasswordToken,
      });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const resetPassword = catchAsync(async (req, res) => {
  const { verificationId, password, token } = req.body;
  const verification = await otpVerificationService.verifyWithPhoneOTP(verificationId);
  if (verification && verification !== null && verification.id === verificationId) {
    await authService.resetPassword(token, password);
    res.send({ success: true });
  } else {
    res.status(404).send({ code: 404, message: 'Not found', extra: '' });
  }
});

const resetWebPassword = catchAsync(async (req, res) => {
  const { verificationId, password } = req.body;
  const response = await otpVerificationService.verifyWebVerification(verificationId);
  if (response && response !== null && response.id !== '' && response.token !== '') {
    const mode = response.mode;
    const token = response.token;
    if (mode === 'msg91') {
      const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('msg91');
      if (
        smsProvider &&
        smsProvider !== null &&
        smsProvider.slug === 'msg91' &&
        smsProvider.credentials &&
        smsProvider.credentials !== null &&
        smsProvider.credentials.widgetId !== null &&
        smsProvider.credentials.widgetId !== ''
      ) {
        const items = response.provider.split(',');
        if (checkArrayNotEmpty(items) && items.length === 3) {
          const creds = smsProvider.credentials;
          const savedToNumber = `${items[0]}${items[1]}`;
          const cleanedUserMobileNumber = savedToNumber.replace(/\+/g, '');
          const param = {
            authkey: creds.authkey,
            'access-token': token,
          };
          const smsResponse = await superagent
            .post('https://control.msg91.com/api/v5/widget/verifyAccessToken')
            .set('Content-Type', 'application/json')
            .send(param);
          if (smsResponse.status === 200 && smsResponse.text !== null) {
            if (
              smsResponse &&
              smsResponse.body &&
              smsResponse.body.type === 'success' &&
              smsResponse.body.message === cleanedUserMobileNumber
            ) {
              await authService.updateWebAuthPassword(items[0], items[1], password);
              await otpVerificationService.deleteWebOtp(verificationId);
              res.send({ success: true });
            } else {
              res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
            }
          } else {
            res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
          }
        } else {
          res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
        }
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else if (mode === 'firebase') {
      try {
        const items = response.provider.split(',');
        if (checkArrayNotEmpty(items) && items.length === 3) {
          const userMobileNumber = `${items[0]}${items[1]}`;
          const cleanedUserMobileNumber = userMobileNumber.replace(/\+/g, '');
          const decodedToken = await admin.auth().verifyIdToken(token);
          if (
            decodedToken &&
            decodedToken !== null &&
            decodedToken.phone_number !== null &&
            decodedToken.phone_number !== ''
          ) {
            const cleanedFirebaseMobileNumber = decodedToken.phone_number.replace(/\+/g, '');
            if (cleanedUserMobileNumber === cleanedFirebaseMobileNumber) {
              await authService.updateWebAuthPassword(items[0], items[1], password);
              await otpVerificationService.deleteWebOtp(verificationId);
              res.send({ success: true });
            } else {
              res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
            }
          } else {
            res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
          }
        } else {
          res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
        }
      } catch (error) {
        res.status(400).send({ code: 400, message: error, extra: '' });
      }
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const resetFirebaseWebPassword = catchAsync(async (req, res) => {
  try {
    const { token, password, countryCode, mobileNumber } = req.body;
    const userMobileNumber = `${countryCode}${mobileNumber}`;
    const cleanedUserMobileNumber = userMobileNumber.replace(/\+/g, '');
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (
      decodedToken &&
      decodedToken !== null &&
      decodedToken.phone_number !== null &&
      decodedToken.phone_number !== ''
    ) {
      const cleanedFirebaseMobileNumber = decodedToken.phone_number.replace(/\+/g, '');
      if (cleanedUserMobileNumber === cleanedFirebaseMobileNumber) {
        await authService.resetFirebaseWebPassword(countryCode, mobileNumber, password);
        res.send({ success: true });
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error, extra: '' });
  }
});

const resetPasswordFirebase = catchAsync(async (req, res) => {
  try {
    const { token, password, qtoken } = req.body;
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (
      decodedToken &&
      decodedToken !== null &&
      decodedToken.phone_number !== null &&
      decodedToken.phone_number !== ''
    ) {
      await authService.resetPassword(qtoken, password);
      res.send({ success: true });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error, extra: '' });
  }
});

const verifyEmail = catchAsync(async (req, res) => {
  await authService.verifyEmail(req.query.token);
  res.send({ success: true });
});

const isAdminSetupDone = catchAsync(async (req, res) => {
  const isDone = await userService.isAdminSetupDone();
  res.send({ isDone });
});

const verifyUserRegisterAccount = catchAsync(async (req, res) => {
  const user = await userService.canCreateAccount(req.body);
  if (user) {
    const verificationMethod = await userSettingService.getVerificationDetail();
    const otpConfig = await businessSettingsService.getOtpConfig();
    if (
      verificationMethod !== null &&
      verificationMethod.signUpVerifyWith !== null &&
      verificationMethod.signUpVerifyWith === 'email_otp'
    ) {
      let generatedOTP;
      if (otpConfig.otpType === 'num') {
        generatedOTP = otpGenerator.generate(otpConfig.otpLength, {
          digits: true,
          upperCaseAlphabets: false,
          lowerCaseAlphabets: false,
          specialChars: false,
        });
      } else if (otpConfig.otpType === 'numstr') {
        generatedOTP = otpGenerator.generate(otpConfig.otpLength, {
          digits: true,
          upperCaseAlphabets: true,
          lowerCaseAlphabets: false,
          specialChars: false,
        });
      } else {
        generatedOTP = otpGenerator.generate(otpConfig.otpLength, {
          digits: false,
          upperCaseAlphabets: true,
          lowerCaseAlphabets: false,
          specialChars: false,
        });
      }
      const sendEmail = await emailConfigService.sendVerificationEmail(
        req.body.email,
        generatedOTP,
        req.body.locale
      );
      if (sendEmail) {
        const otpData = await otpVerificationService.saveOTP({
          provider: req.body.email,
          otp: generatedOTP,
          mode: verificationMethod.signUpVerifyWith,
          locale: req.body.locale,
        });
        if (otpData) {
          res.status(201).send({
            sent: true,
            mode: verificationMethod.signUpVerifyWith,
            otpLength: otpConfig.otpLength,
            canResendOtp: otpConfig.canResendOtp,
            id: otpData.id,
            provider: req.body.email,
            target: 'otp_screen',
            method: 'email',
          });
        } else {
          res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
        }
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else if (
      verificationMethod !== null &&
      verificationMethod.signUpVerifyWith !== null &&
      verificationMethod.signUpVerifyWith === 'phone_otp'
    ) {
      const toNumber = `${req.body.countryCode}${req.body.mobile}`;
      const smsProvider = await smsProviderConfigService.sendOTPSMS(
        req.body.countryCode,
        req.body.mobile,
        toNumber,
        req.body.locale
      );
      if (
        smsProvider &&
        smsProvider !== null &&
        smsProvider.id &&
        smsProvider.id !== null &&
        smsProvider.id !== ''
      ) {
        res.status(201).send({
          sent: true,
          mode: verificationMethod.signUpVerifyWith,
          otpLength: otpConfig.otpLength,
          canResendOtp: otpConfig.canResendOtp,
          id: smsProvider.id,
          provider: smsProvider.provider,
          target: smsProvider.target,
          method: smsProvider.method,
        });
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const verifyOTP = catchAsync(async (req, res) => {
  const verify = await otpVerificationService.verifyOTP(
    req.body.id,
    req.body.provider,
    req.body.otp
  );
  res.status(201).send(verify);
});

const resendOTP = catchAsync(async (req, res) => {
  const verify = await otpVerificationService.resendOTPById(req.params.id);
  if (verify && verify.mode === 'email_otp') {
    const sendEmail = await emailConfigService.sendVerificationEmail(
      verify.provider,
      verify.otp,
      verify.locale
    );
    if (sendEmail) {
      res.status(201).send({
        sent: true,
      });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    const sendSMS = await smsProviderConfigService.resendOTPSMS(
      verify.provider,
      verify.otp,
      verify.locale,
      verify.mode
    );
    if (sendSMS) {
      res.status(201).send({
        sent: true,
      });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  }
});

const verifyWebSMSOTP = catchAsync(async (req, res) => {
  const { id, locale } = req.params;
  const currentURL = new URL(`${req.protocol}://${req.get('host')}`);
  const successCallBackURL = `${currentURL}v1/public/otp/verify/${id}`;
  const failedCallBackURL = `${currentURL}v1/public/otp/failed/${id}`;
  const checkInfo = await otpVerificationService.checkOtpInfoById(id);
  if (checkInfo && checkInfo !== null && checkInfo.id === id) {
    const items = checkInfo.provider.split(',');
    if (checkArrayNotEmpty(items) && items.length === 3) {
      const toNumber = items[2];
      if (checkInfo.mode === 'msg91') {
        const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('msg91');
        if (
          smsProvider &&
          smsProvider !== null &&
          smsProvider.slug === 'msg91' &&
          smsProvider.credentials &&
          smsProvider.credentials !== null &&
          smsProvider.credentials.widgetId !== null &&
          smsProvider.credentials.widgetId !== ''
        ) {
          const creds = smsProvider.credentials;
          res.render('other/msg91', {
            locals: {
              widgetId: creds.widgetId,
              tokenAuth: creds.tokenAuth,
              phoneNumber: toNumber,
              callBackURL: successCallBackURL,
              appLocale: locale,
            },
          });
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else {
      res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
    }
  } else {
    res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
  }
});

const verifyWebVersionSMSOTP = catchAsync(async (req, res) => {
  const { id } = req.params;
  const currentURL = new URL(`${req.protocol}://${req.get('host')}`);
  const successCallBackURL = `${currentURL}v1/public/otp/verify_web/${id}`;
  const totalFailed = `${currentURL}v1/public/otp/failed/${id}`;
  const checkInfo = await otpVerificationService.checkWebOtpInfoById(id);
  if (checkInfo && checkInfo !== null && checkInfo.id === id) {
    const locale = checkInfo.locale;
    const items = checkInfo.provider.split(',');
    if (checkArrayNotEmpty(items) && items.length === 3) {
      const toNumber = items[2];
      if (checkInfo.mode === 'msg91') {
        const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('msg91');
        if (
          smsProvider &&
          smsProvider !== null &&
          smsProvider.slug === 'msg91' &&
          smsProvider.credentials &&
          smsProvider.credentials !== null &&
          smsProvider.credentials.widgetId !== null &&
          smsProvider.credentials.widgetId !== ''
        ) {
          const creds = smsProvider.credentials;
          res.render('other/msg91', {
            locals: {
              widgetId: creds.widgetId,
              tokenAuth: creds.tokenAuth,
              phoneNumber: toNumber,
              callBackURL: successCallBackURL,
              appLocale: locale,
              failedCallBackURL: totalFailed,
              otpId: id,
            },
          });
        } else {
          res.redirect(httpStatus.SEE_OTHER, totalFailed);
        }
      } else if (checkInfo.mode === 'firebase') {
        const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('firebase');
        if (
          smsProvider &&
          smsProvider !== null &&
          smsProvider.slug === 'firebase' &&
          smsProvider.credentials &&
          smsProvider.credentials !== null &&
          smsProvider.credentials.apiKey !== null &&
          smsProvider.credentials.apiKey !== ''
        ) {
          const creds = smsProvider.credentials;
          res.render('other/firebase', {
            locals: {
              apiKey: creds.apiKey,
              authDomain: creds.authDomain,
              projectId: creds.projectId,
              storageBucket: creds.storageBucket,
              messagingSenderId: creds.messagingSenderId,
              appId: creds.appId,
              measurementId: creds.measurementId,
              mobileNumber: items[2],
              callBackURL: successCallBackURL,
              appLocale: locale,
            },
          });
        } else {
          res.redirect(httpStatus.SEE_OTHER, totalFailed);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, totalFailed);
      }
    } else {
      res.redirect(httpStatus.SEE_OTHER, totalFailed);
    }
  } else {
    res.redirect(httpStatus.SEE_OTHER, totalFailed);
  }
});

const verifyWebVersionResetPasswordSMSOTP = catchAsync(async (req, res) => {
  const { id, locale, role, redirect } = req.query;
  const currentURL = new URL(`${req.protocol}://${req.get('host')}`);
  const successCallBackURL = `${currentURL}v1/public/otp/verify_reset_password_web?id=${id}&role=${role}&redirect=${redirect}`;
  const failedCallBackURL = `${redirect}/authentication/web-sms-reset-password-verification/${id}/${role}/failed`;
  const checkInfo = await otpVerificationService.checkOtpInfoById(id);
  if (checkInfo && checkInfo !== null && checkInfo.id === id) {
    const items = checkInfo.provider.split(',');
    if (checkArrayNotEmpty(items) && items.length === 3) {
      const toNumber = items[2];
      const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('msg91');
      if (
        smsProvider &&
        smsProvider !== null &&
        smsProvider.slug === 'msg91' &&
        smsProvider.credentials &&
        smsProvider.credentials !== null &&
        smsProvider.credentials.widgetId !== null &&
        smsProvider.credentials.widgetId !== ''
      ) {
        const creds = smsProvider.credentials;
        res.render('other/msg91', {
          locals: {
            widgetId: creds.widgetId,
            tokenAuth: creds.tokenAuth,
            phoneNumber: toNumber,
            callBackURL: successCallBackURL,
            appLocale: locale,
          },
        });
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else {
      res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
    }
  } else {
    res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
  }
});

const verifyFirebaseWebVersionSMSOTP = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale, role, redirect } = req.query;
  const failedCallBackURL = `${redirect}/authentication/firebase-web-sms-verification/${countryCode}/${mobileNumber}/${role}/failed/null`;
  const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('firebase');
  if (
    smsProvider &&
    smsProvider !== null &&
    smsProvider.slug === 'firebase' &&
    smsProvider.credentials &&
    smsProvider.credentials !== null &&
    smsProvider.credentials.apiKey !== null &&
    smsProvider.credentials.apiKey !== ''
  ) {
    const creds = smsProvider.credentials;
    res.render('other/firebase', {
      locals: {
        apiKey: creds.apiKey,
        authDomain: creds.authDomain,
        projectId: creds.projectId,
        storageBucket: creds.storageBucket,
        messagingSenderId: creds.messagingSenderId,
        appId: creds.appId,
        measurementId: creds.measurementId,
        countryCode: `${countryCode}`,
        mobileNumber: `${mobileNumber}`,
        callBackURL: redirect,
        appLocale: locale,
        authRole: role,
        kind: 'login',
      },
    });
  } else {
    res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
  }
});

const verifyFirebaseWebVersionResetPasswordSMSOTP = catchAsync(async (req, res) => {
  const { countryCode, mobileNumber, locale, role, redirect } = req.query;
  const failedCallBackURL = `${redirect}/authentication/firebase-web-sms-reset-password-verification/${countryCode}/${mobileNumber}/${role}/failed/null`;
  const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('firebase');
  if (
    smsProvider &&
    smsProvider !== null &&
    smsProvider.slug === 'firebase' &&
    smsProvider.credentials &&
    smsProvider.credentials !== null &&
    smsProvider.credentials.apiKey !== null &&
    smsProvider.credentials.apiKey !== ''
  ) {
    const creds = smsProvider.credentials;
    res.render('other/firebase', {
      locals: {
        apiKey: creds.apiKey,
        authDomain: creds.authDomain,
        projectId: creds.projectId,
        storageBucket: creds.storageBucket,
        messagingSenderId: creds.messagingSenderId,
        appId: creds.appId,
        measurementId: creds.measurementId,
        countryCode: `${countryCode}`,
        mobileNumber: `${mobileNumber}`,
        callBackURL: redirect,
        appLocale: locale,
        authRole: role,
        kind: 'reset',
      },
    });
  } else {
    res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
  }
});

const smsWebVersionVerification = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;
  const currentURL = new URL(`${req.protocol}://${req.get('host')}`);
  const totalFailed = `${currentURL}v1/public/otp/failed/${id}`;
  try {
    if (token && token !== null && token !== '') {
      const otpContent = await otpVerificationService.verifyWebOtpSuccess(id, token);
      if (
        otpContent &&
        otpContent !== null &&
        otpContent.success === true &&
        otpContent.otpData.redirectUrl &&
        otpContent.otpData.redirectUrl !== null &&
        otpContent.otpData.redirectUrl !== ''
      ) {
        const redirectUrl = otpContent.otpData.redirectUrl;
        if (otpContent.otpData.kind === 'reset') {
          const successCallBackURL = `${redirectUrl}/authentication/web-sms-reset-password-verification/${id}/`;
          res.redirect(httpStatus.SEE_OTHER, `${successCallBackURL}`);
        } else {
          const successCallBackURL = `${redirectUrl}/authentication/web-sms-verification/${id}/`;
          res.redirect(httpStatus.SEE_OTHER, `${successCallBackURL}`);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, totalFailed);
      }
    } else {
      res.redirect(httpStatus.SEE_OTHER, totalFailed);
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.redirect(httpStatus.SEE_OTHER, totalFailed);
  }
});

const smsWebVersionResetPasswordVerification = catchAsync(async (req, res) => {
  const { id, redirect, role } = req.query;
  const url = redirect;
  const parsedUrl = new URL(url);
  const baseUrl = parsedUrl.origin;
  const token = parsedUrl.searchParams.get('token');
  const successCallBackURL = `${baseUrl}/authentication/web-sms-reset-password-verification/${id}/${role}/success`;
  const failedCallBackURL = `${baseUrl}/authentication/web-sms-reset-password-verification/${id}/${role}/failed`;
  try {
    if (token && token !== null && token !== '') {
      const otpContent = await otpVerificationService.verifyFirebaseOTP(id);
      if (
        otpContent &&
        otpContent !== null &&
        otpContent.success === true &&
        otpContent.data &&
        otpContent.data.mode === 'msg91' &&
        otpContent.data.otp &&
        otpContent.data.otp !== null &&
        otpContent.data.otp !== ''
      ) {
        const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('msg91');
        if (
          smsProvider &&
          smsProvider !== null &&
          smsProvider.slug === 'msg91' &&
          smsProvider.credentials &&
          smsProvider.credentials !== null &&
          smsProvider.credentials.widgetId !== null &&
          smsProvider.credentials.widgetId !== ''
        ) {
          const items = otpContent.data.provider.split(',');
          if (checkArrayNotEmpty(items) && items.length === 3) {
            const creds = smsProvider.credentials;
            const savedToNumber = `${items[0]}${items[1]}`;
            const cleanedUserMobileNumber = savedToNumber.replace(/\+/g, '');
            const param = {
              authkey: creds.authkey,
              'access-token': token,
            };
            const smsResponse = await superagent
              .post('https://control.msg91.com/api/v5/widget/verifyAccessToken')
              .set('Content-Type', 'application/json')
              .send(param);
            if (smsResponse.status === 200 && smsResponse.text !== null) {
              if (
                smsResponse &&
                smsResponse.body &&
                smsResponse.body.type === 'success' &&
                smsResponse.body.message === cleanedUserMobileNumber
              ) {
                res.redirect(httpStatus.SEE_OTHER, `${successCallBackURL}`);
              } else {
                res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
              }
            } else {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else {
      res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
  }
});

const smsVerification = catchAsync(async (req, res) => {
  const currentURL = new URL(`${req.protocol}://${req.get('host')}`);
  const successCallBackURL = `${currentURL}v1/public/otp/success/${req.params.id}`;
  const failedCallBackURL = `${currentURL}v1/public/otp/failed/${req.params.id}`;
  const { token } = req.query;
  try {
    if (token && token !== null && token !== '') {
      const otpContent = await otpVerificationService.verifyFirebaseOTP(req.params.id);
      if (
        otpContent &&
        otpContent !== null &&
        otpContent.success === true &&
        otpContent.data &&
        otpContent.data.mode === 'msg91' &&
        otpContent.data.otp &&
        otpContent.data.otp !== null &&
        otpContent.data.otp !== ''
      ) {
        const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('msg91');
        if (
          smsProvider &&
          smsProvider !== null &&
          smsProvider.slug === 'msg91' &&
          smsProvider.credentials &&
          smsProvider.credentials !== null &&
          smsProvider.credentials.widgetId !== null &&
          smsProvider.credentials.widgetId !== ''
        ) {
          const items = otpContent.data.provider.split(',');
          if (checkArrayNotEmpty(items) && items.length === 3) {
            const creds = smsProvider.credentials;
            const savedToNumber = `${items[0]}${items[1]}`;
            const cleanedUserMobileNumber = savedToNumber.replace(/\+/g, '');
            const param = {
              authkey: creds.authkey,
              'access-token': token,
            };
            const smsResponse = await superagent
              .post('https://control.msg91.com/api/v5/widget/verifyAccessToken')
              .set('Content-Type', 'application/json')
              .send(param);
            if (smsResponse.status === 200 && smsResponse.text !== null) {
              if (
                smsResponse &&
                smsResponse.body &&
                smsResponse.body.type === 'success' &&
                smsResponse.body.message === cleanedUserMobileNumber
              ) {
                res.redirect(
                  httpStatus.SEE_OTHER,
                  `${successCallBackURL}?auth=${otpContent.data.otp}`
                );
              } else {
                res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
              }
            } else {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else if (
        otpContent &&
        otpContent !== null &&
        otpContent.success === true &&
        otpContent.data &&
        otpContent.data.mode === 'firebase' &&
        otpContent.data.otp &&
        otpContent.data.otp !== null &&
        otpContent.data.otp !== ''
      ) {
        const items = otpContent.data.provider.split(',');
        if (checkArrayNotEmpty(items) && items.length === 3) {
          const toNumber = items[2];
          const decodedToken = await admin.auth().verifyIdToken(token);
          if (
            decodedToken &&
            decodedToken.phone_number &&
            decodedToken.phone_number !== null &&
            decodedToken.phone_number !== '' &&
            decodedToken.phone_number === toNumber
          ) {
            res.redirect(httpStatus.SEE_OTHER, `${successCallBackURL}?auth=${otpContent.data.otp}`);
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else {
      res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
  }
});

const smsVerificationSuccess = catchAsync(async (req, res) => {
  res.render('other/success');
});

const smsVerificationFailed = catchAsync(async (req, res) => {
  res.render('other/failed');
});

const getMyProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.getMyProfile(id);
  res.send(result);
});

const updateMyProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.updateMyProfile(id, req.body);
  res.send(result);
});

const checkUserRegisterStatus = catchAsync(async (req, res) => {
  const result = await userService.checkUserRegisterStatus(req.body);
  res.send(result);
});

const getRoleAccountList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit', 'page', 'kind', 'search']);
  const result = await userService.getRoleAccountList(options);
  res.send(result);
});

const addAdminAccount = catchAsync(async (req, res) => {
  const result = await userService.addAdminAccount(req.body);
  res.send(result);
});

const addAccountantAccount = catchAsync(async (req, res) => {
  const result = await userService.addAccountantAccount(req.body);
  res.send(result);
});

const addSupportTeamAccount = catchAsync(async (req, res) => {
  const result = await userService.addSupportTeamAccount(req.body);
  res.send(result);
});

const cityMasterList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit', 'page', 'search']);
  const result = await userService.cityMasterList(options);
  res.send(result);
});

const addCityMaterAccount = catchAsync(async (req, res) => {
  const result = await userService.addCityMaterAccount(req.body);
  res.send(result);
});

const updateRoleStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.updateRoleStatus(id, req.body);
  res.send(result);
});

const roleAccountDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.roleAccountDetail(id);
  res.send(result);
});

const cityMasterAccountDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.cityMasterAccountDetail(id);
  res.send(result);
});

const updateRoleDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.updateRoleDetail(id, req.body);
  res.send(result);
});

const updateCityMasterDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.updateCityMasterDetail(id, req.body);
  res.send(result);
});

const loginAccountantWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, locale, remember } = req.body;
  const user = await authService.loginAccountantWithEmailAndPassword(email, password, locale);
  const tokens = await tokenService.generateAuthTokens(
    user,
    getClientIp(req),
    getClientUserAgent(req)
  );
  setWebAuthCookies(req, res, tokens, remember);
  res.status(201).send({ user });
});

const loginBankWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, locale, remember } = req.body;
  const user = await authService.loginBankWithEmailAndPassword(email, password, locale);
  const tokens = await tokenService.generateAuthTokens(
    user,
    getClientIp(req),
    getClientUserAgent(req)
  );
  setWebAuthCookies(req, res, tokens, remember);
  res.status(201).send({ user });
});

const loginSupportTeamWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, locale, remember } = req.body;
  const user = await authService.loginSupportTeamWithEmailAndPassword(email, password, locale);
  const tokens = await tokenService.generateAuthTokens(
    user,
    getClientIp(req),
    getClientUserAgent(req)
  );
  setWebAuthCookies(req, res, tokens, remember);
  res.status(201).send({ user });
});

const loginCityzenWithEmailAndPassword = catchAsync(async (req, res) => {
  const { email, password, locale, remember } = req.body;
  const user = await authService.loginCityzenWithEmailAndPassword(email, password, locale);
  const tokens = await tokenService.generateAuthTokens(
    user,
    getClientIp(req),
    getClientUserAgent(req)
  );
  setWebAuthCookies(req, res, tokens, remember);
  res.status(201).send({ user });
});

const userLoginWithGoogleAccount = catchAsync(async (req, res) => {
  try {
    const socialDetail = await socialSigninService.getSocialSignin();
    if (!socialDetail) {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    } else if (socialDetail && socialDetail.googleSignin === true) {
      if (
        socialDetail &&
        socialDetail.configCredsRaw &&
        socialDetail.configCredsRaw.google_server_id &&
        socialDetail.configCredsRaw.google_server_id !== '' &&
        socialDetail.configCredsRaw.google_server_id !== null
      ) {
        const googleClientId = socialDetail.configCredsRaw.google_server_id;
        const { idToken, remember, locale, userAgent } = req.body;
        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
          idToken: `${idToken}`,
          audience: googleClientId,
        });
        const payload = ticket.getPayload();
        if (payload && payload.email && payload.email !== '' && payload.email !== null) {
          const userEmail = payload.email;
          const userFirstName =
            payload &&
            payload.given_name &&
            payload.given_name !== null &&
            payload.given_name !== ''
              ? payload.given_name
              : '';
          const userLastName =
            payload &&
            payload.family_name &&
            payload.family_name !== null &&
            payload.family_name !== ''
              ? payload.family_name
              : '';
          const userDetail = await authService.userLoginWithSocialAccount(userEmail, locale);
          if (userDetail.success) {
            const ip = req.connection.remoteAddress;
            const tokens = await tokenService.generateAuthTokens(userDetail.user, ip, userAgent);
            if (remember === false) {
              delete tokens.refresh;
            }
            res.send({ user: userDetail.user, tokens, success: true });
          } else {
            res.send({
              firstName: userFirstName,
              lastName: userLastName,
              success: false,
              provider: 'google',
            });
          }
        } else {
          res.status(401).send({ code: 401, message: 'Unauthorized' });
        }
      } else {
        res.status(401).send({ code: 401, message: 'Unauthorized' });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const vendorLoginWithGoogleAccount = catchAsync(async (req, res) => {
  try {
    const socialDetail = await socialSigninService.getSocialSignin();
    if (!socialDetail) {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    } else if (socialDetail && socialDetail.googleSignin === true) {
      if (
        socialDetail &&
        socialDetail.configCredsRaw &&
        socialDetail.configCredsRaw.google_server_id &&
        socialDetail.configCredsRaw.google_server_id !== '' &&
        socialDetail.configCredsRaw.google_server_id !== null
      ) {
        const googleClientId = socialDetail.configCredsRaw.google_server_id;
        const { idToken, remember, locale, userAgent } = req.body;
        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
          idToken: `${idToken}`,
          audience: googleClientId,
        });
        const payload = ticket.getPayload();
        if (payload && payload.email && payload.email !== '' && payload.email !== null) {
          const userEmail = payload.email;
          const userDetail = await authService.vendorLoginWithSocialAccount(userEmail, locale);
          if (userDetail.success) {
            const ip = req.connection.remoteAddress;
            const tokens = await tokenService.generateAuthTokens(userDetail.user, ip, userAgent);
            const vendor = await restaurantService.getByUserIdVendorLogin(userDetail.user.id);
            if (remember === false) {
              delete tokens.refresh;
            }
            if (userDetail.user && userDetail.user.role === 'vendorOutlet') {
              const manager = await restaurantService.getRestaurantByIdVendorLogin(
                vendor.outletManagerId
              );
              const restaurant = await restaurantService.getRestaurantLoginResponse(
                userDetail.user.id
              );
              res.send({ user: userDetail.user, tokens, vendor, manager, restaurant });
            } else {
              const restaurant = await restaurantService.getRestaurantLoginResponse(
                userDetail.user.id
              );
              res.send({ user: userDetail.user, tokens, vendor, restaurant });
            }
          } else {
            res.status(401).send({ code: 401, message: 'Account not found' });
          }
        } else {
          res.status(401).send({ code: 401, message: 'Unauthorized' });
        }
      } else {
        res.status(401).send({ code: 401, message: 'Unauthorized' });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const driverLoginWithGoogleAccount = catchAsync(async (req, res) => {
  try {
    const socialDetail = await socialSigninService.getSocialSignin();
    if (!socialDetail) {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    } else if (socialDetail && socialDetail.googleSignin === true) {
      if (
        socialDetail &&
        socialDetail.configCredsRaw &&
        socialDetail.configCredsRaw.google_server_id &&
        socialDetail.configCredsRaw.google_server_id !== '' &&
        socialDetail.configCredsRaw.google_server_id !== null
      ) {
        const googleClientId = socialDetail.configCredsRaw.google_server_id;
        const { idToken, remember, locale, userAgent } = req.body;
        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
          idToken: `${idToken}`,
          audience: googleClientId,
        });
        const payload = ticket.getPayload();
        if (payload && payload.email && payload.email !== '' && payload.email !== null) {
          const userEmail = payload.email;
          const userDetail = await authService.driverLoginWithSocialAccount(userEmail, locale);
          if (userDetail.success) {
            const ip = req.connection.remoteAddress;
            const tokens = await tokenService.generateAuthTokens(userDetail.user, ip, userAgent);
            if (remember === false) {
              delete tokens.refresh;
            }
            res.send({ user: userDetail.user, tokens });
          } else {
            res.status(401).send({ code: 401, message: 'Account not found' });
          }
        } else {
          res.status(401).send({ code: 401, message: 'Unauthorized' });
        }
      } else {
        res.status(401).send({ code: 401, message: 'Unauthorized' });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const kitchenLoginWithGoogleAccount = catchAsync(async (req, res) => {
  try {
    const socialDetail = await socialSigninService.getSocialSignin();
    if (!socialDetail) {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    } else if (socialDetail && socialDetail.googleSignin === true) {
      if (
        socialDetail &&
        socialDetail.configCredsRaw &&
        socialDetail.configCredsRaw.google_server_id &&
        socialDetail.configCredsRaw.google_server_id !== '' &&
        socialDetail.configCredsRaw.google_server_id !== null
      ) {
        const googleClientId = socialDetail.configCredsRaw.google_server_id;
        const { idToken, remember, locale, userAgent } = req.body;
        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
          idToken: `${idToken}`,
          audience: googleClientId,
        });
        const payload = ticket.getPayload();
        if (payload && payload.email && payload.email !== '' && payload.email !== null) {
          const userEmail = payload.email;
          const userDetail = await authService.loginKitchenWithSocialAccount(userEmail, locale);
          if (userDetail.success) {
            const ip = req.connection.remoteAddress;
            const tokens = await tokenService.generateAuthTokens(userDetail.user, ip, userAgent);
            const owner = await kitchenOwnerService.getKitchenLoginInfo(userDetail.user.id);
            if (remember === false) {
              delete tokens.refresh;
            }
            res.send({ user: userDetail.user, tokens, owner });
          } else {
            res.status(401).send({ code: 401, message: 'Account not found' });
          }
        } else {
          res.status(401).send({ code: 401, message: 'Unauthorized' });
        }
      } else {
        res.status(401).send({ code: 401, message: 'Unauthorized' });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const waiterLoginWithGoogleAccount = catchAsync(async (req, res) => {
  try {
    const socialDetail = await socialSigninService.getSocialSignin();
    if (!socialDetail) {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    } else if (socialDetail && socialDetail.googleSignin === true) {
      if (
        socialDetail &&
        socialDetail.configCredsRaw &&
        socialDetail.configCredsRaw.google_server_id &&
        socialDetail.configCredsRaw.google_server_id !== '' &&
        socialDetail.configCredsRaw.google_server_id !== null
      ) {
        const googleClientId = socialDetail.configCredsRaw.google_server_id;
        const { idToken, remember, locale, userAgent } = req.body;
        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
          idToken: `${idToken}`,
          audience: googleClientId,
        });
        const payload = ticket.getPayload();
        if (payload && payload.email && payload.email !== '' && payload.email !== null) {
          const userEmail = payload.email;
          const userDetail = await authService.loginWaiterWithSocialAccount(userEmail, locale);
          if (userDetail.success) {
            const ip = req.connection.remoteAddress;
            const tokens = await tokenService.generateAuthTokens(userDetail.user, ip, userAgent);
            const waiter = await waiterService.getWaiterLoginInfo(userDetail.user.id);
            if (remember === false) {
              delete tokens.refresh;
            }
            res.send({ user: userDetail.user, tokens, waiter });
          } else {
            res.status(401).send({ code: 401, message: 'Account not found' });
          }
        } else {
          res.status(401).send({ code: 401, message: 'Unauthorized' });
        }
      } else {
        res.status(401).send({ code: 401, message: 'Unauthorized' });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const checkMobileNumberExist = catchAsync(async (req, res) => {
  const { countryCode, mobile } = req.body;
  const result = await userService.checkMobileNumberExist(countryCode, mobile);
  res.send(result);
});

const createGoogleUserAccount = catchAsync(async (req, res) => {
  try {
    const socialDetail = await socialSigninService.getSocialSignin();
    if (!socialDetail) {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    } else if (socialDetail && socialDetail.googleSignin === true) {
      if (
        socialDetail &&
        socialDetail.configCredsRaw &&
        socialDetail.configCredsRaw.google_server_id &&
        socialDetail.configCredsRaw.google_server_id !== '' &&
        socialDetail.configCredsRaw.google_server_id !== null
      ) {
        const googleClientId = socialDetail.configCredsRaw.google_server_id;
        const { idToken, remember, locale, userAgent, firstName, lastName, countryCode, mobile } =
          req.body;
        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
          idToken: `${idToken}`,
          audience: googleClientId,
        });
        const payload = ticket.getPayload();
        if (payload && payload.email && payload.email !== '' && payload.email !== null) {
          const userBody = {
            email: payload.email,
            password: `password##${payload.email}##`,
            firstName: `${firstName}`,
            lastName: `${lastName}`,
            countryCode: `${countryCode}`,
            mobile: `${mobile}`,
            locale: `${locale}`,
          };
          const user = await userService.createSocialUserAccount(userBody);
          const ip = req.connection.remoteAddress;
          const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
          const walletData = new Wallet({
            holderId: user.id,
          });
          const referralCode = new ReferralCode({
            holderId: user.id,
          });
          await walletService.createWallet(walletData);
          await referralService.createReferralCode(referralCode);
          if (remember === false) {
            delete tokens.refresh;
          }
          res.send({ user, tokens, success: true });
        } else {
          res.status(401).send({ code: 401, message: 'Unauthorized' });
        }
      } else {
        res.status(401).send({ code: 401, message: 'Unauthorized' });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const userLoginWithFacebookAccount = catchAsync(async (req, res) => {
  const { accessToken, remember, locale, userAgent } = req.body;
  try {
    const socialDetail = await superagent
      .get('https://graph.facebook.com/me')
      .set('Content-Type', 'application/json')
      .query({ fields: 'id,name,email', access_token: accessToken });
    const payload = JSON.parse(socialDetail.text);
    if (payload && payload.email && payload.email !== '' && payload.email !== null) {
      const userEmail = payload.email;
      const name = payload.name.trim();
      const nameParts = name.split(' ');
      const [userFirstName = '', ...rest] = nameParts;
      const userLastName = rest.join(' ');
      const userDetail = await authService.userLoginWithSocialAccount(userEmail, locale);
      if (userDetail.success) {
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(userDetail.user, ip, userAgent);
        if (remember === false) {
          delete tokens.refresh;
        }
        res.send({ user: userDetail.user, tokens, success: true });
      } else {
        res.send({
          firstName: userFirstName,
          lastName: userLastName,
          success: false,
          provider: 'facebook',
        });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const vendorLoginWithFacebookAccount = catchAsync(async (req, res) => {
  const { accessToken, remember, locale, userAgent } = req.body;
  try {
    const socialDetail = await superagent
      .get('https://graph.facebook.com/me')
      .set('Content-Type', 'application/json')
      .query({ fields: 'id,name,email', access_token: accessToken });
    const payload = JSON.parse(socialDetail.text);
    if (payload && payload.email && payload.email !== '' && payload.email !== null) {
      const userEmail = payload.email;
      const userDetail = await authService.vendorLoginWithSocialAccount(userEmail, locale);
      if (userDetail.success) {
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(userDetail.user, ip, userAgent);
        const vendor = await restaurantService.getByUserIdVendorLogin(userDetail.user.id);
        if (remember === false) {
          delete tokens.refresh;
        }
        if (userDetail.user && userDetail.user.role === 'vendorOutlet') {
          const manager = await restaurantService.getRestaurantByIdVendorLogin(
            vendor.outletManagerId
          );
          const restaurant = await restaurantService.getRestaurantLoginResponse(userDetail.user.id);
          res.send({ user: userDetail.user, tokens, vendor, manager, restaurant });
        } else {
          const restaurant = await restaurantService.getRestaurantLoginResponse(userDetail.user.id);
          res.send({ user: userDetail.user, tokens, vendor, restaurant });
        }
      } else {
        res.status(401).send({ code: 401, message: 'Account not found' });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const createFacebookUserAccount = catchAsync(async (req, res) => {
  try {
    // res.send(req.body);
    const { accessToken, remember, locale, userAgent, firstName, lastName, countryCode, mobile } =
      req.body;
    const socialDetail = await superagent
      .get('https://graph.facebook.com/me')
      .set('Content-Type', 'application/json')
      .query({ fields: 'id,name,email', access_token: accessToken });
    const payload = JSON.parse(socialDetail.text);
    if (payload && payload.email && payload.email !== '' && payload.email !== null) {
      const userBody = {
        email: payload.email,
        password: `password##${payload.email}##`,
        firstName: `${firstName}`,
        lastName: `${lastName}`,
        countryCode: `${countryCode}`,
        mobile: `${mobile}`,
        locale: `${locale}`,
      };
      const user = await userService.createSocialUserAccount(userBody);
      const ip = req.connection.remoteAddress;
      const tokens = await tokenService.generateAuthTokens(user, ip, userAgent);
      const walletData = new Wallet({
        holderId: user.id,
      });
      const referralCode = new ReferralCode({
        holderId: user.id,
      });
      await walletService.createWallet(walletData);
      await referralService.createReferralCode(referralCode);
      if (remember === false) {
        delete tokens.refresh;
      }
      res.send({ user, tokens, success: true });
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const driverLoginWithFacebookAccount = catchAsync(async (req, res) => {
  const { accessToken, remember, locale, userAgent } = req.body;
  try {
    const socialDetail = await superagent
      .get('https://graph.facebook.com/me')
      .set('Content-Type', 'application/json')
      .query({ fields: 'id,name,email', access_token: accessToken });
    const payload = JSON.parse(socialDetail.text);
    if (payload && payload.email && payload.email !== '' && payload.email !== null) {
      const userEmail = payload.email;
      const userDetail = await authService.driverLoginWithSocialAccount(userEmail, locale);
      if (userDetail.success) {
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(userDetail.user, ip, userAgent);
        if (remember === false) {
          delete tokens.refresh;
        }
        res.send({ user: userDetail.user, tokens });
      } else {
        res.status(401).send({ code: 401, message: 'Account not found' });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const kitchenLoginWithFacebookAccount = catchAsync(async (req, res) => {
  const { accessToken, remember, locale, userAgent } = req.body;
  try {
    const socialDetail = await superagent
      .get('https://graph.facebook.com/me')
      .set('Content-Type', 'application/json')
      .query({ fields: 'id,name,email', access_token: accessToken });
    const payload = JSON.parse(socialDetail.text);
    if (payload && payload.email && payload.email !== '' && payload.email !== null) {
      const userEmail = payload.email;
      const userDetail = await authService.loginKitchenWithSocialAccount(userEmail, locale);
      if (userDetail.success) {
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(userDetail.user, ip, userAgent);
        const owner = await kitchenOwnerService.getKitchenLoginInfo(userDetail.user.id);
        if (remember === false) {
          delete tokens.refresh;
        }
        res.send({ user: userDetail.user, tokens, owner });
      } else {
        res.status(401).send({ code: 401, message: 'Account not found' });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const waiterLoginWithFacebookAccount = catchAsync(async (req, res) => {
  const { accessToken, remember, locale, userAgent } = req.body;
  try {
    const socialDetail = await superagent
      .get('https://graph.facebook.com/me')
      .set('Content-Type', 'application/json')
      .query({ fields: 'id,name,email', access_token: accessToken });
    const payload = JSON.parse(socialDetail.text);
    if (payload && payload.email && payload.email !== '' && payload.email !== null) {
      const userEmail = payload.email;
      const userDetail = await authService.loginWaiterWithSocialAccount(userEmail, locale);
      if (userDetail.success) {
        const ip = req.connection.remoteAddress;
        const tokens = await tokenService.generateAuthTokens(userDetail.user, ip, userAgent);
        const waiter = await waiterService.getWaiterLoginInfo(userDetail.user.id);
        if (remember === false) {
          delete tokens.refresh;
        }
        res.send({ user: userDetail.user, tokens, waiter });
      } else {
        res.status(401).send({ code: 401, message: 'Account not found' });
      }
    } else {
      res.status(401).send({ code: 401, message: 'Unauthorized' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(401).send({ code: 401, message: 'Unauthorized' });
  }
});

const adminDemoFirebaseSMS = catchAsync(async (req, res) => {
  const { mobile, locale, redirect } = req.query;
  const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('firebase');
  if (
    smsProvider &&
    smsProvider !== null &&
    smsProvider.slug === 'firebase' &&
    smsProvider.credentials &&
    smsProvider.credentials !== null &&
    smsProvider.credentials.apiKey !== null &&
    smsProvider.credentials.apiKey !== ''
  ) {
    const creds = smsProvider.credentials;
    res.render('other/firebase_test', {
      locals: {
        apiKey: creds.apiKey,
        authDomain: creds.authDomain,
        projectId: creds.projectId,
        storageBucket: creds.storageBucket,
        messagingSenderId: creds.messagingSenderId,
        appId: creds.appId,
        measurementId: creds.measurementId,
        phoneNumber: mobile,
        callBackURL: redirect,
        appLocale: locale,
      },
    });
  }
});

const adminDemoMSG91SMS = catchAsync(async (req, res) => {
  const { mobile, locale, redirect } = req.query;
  const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('msg91');
  if (
    smsProvider &&
    smsProvider !== null &&
    smsProvider.slug === 'msg91' &&
    smsProvider.credentials &&
    smsProvider.credentials !== null &&
    smsProvider.credentials.widgetId !== null &&
    smsProvider.credentials.widgetId !== ''
  ) {
    const creds = smsProvider.credentials;
    res.render('other/msg91', {
      locals: {
        widgetId: creds.widgetId,
        tokenAuth: creds.tokenAuth,
        phoneNumber: mobile,
        callBackURL: redirect,
        appLocale: locale,
      },
    });
  } else {
    res.redirect(httpStatus.SEE_OTHER, redirect);
  }
});

const exportCollectionAdminRole = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await userService.exportCollectionAuthRole('admin', search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('AdminAccounts');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Image', key: 'image' },
        { header: 'Status', key: 'status' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        'First Name': detail.firstName,
        'Last Name': detail.lastName,
        Email: detail.email,
        'Country Code': detail.countryCode,
        Mobile: detail.mobile,
        Image: detail.image,
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportRawCollectionAuthRole('admin', search);
    const downloadPath = path.join(__dirname, `../templates/downloads/admin.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'admin.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportCollectionAccountantRole = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await userService.exportCollectionAuthRole('accountant', search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('AccountantAccounts');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Image', key: 'image' },
        { header: 'Status', key: 'status' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        'First Name': detail.firstName,
        'Last Name': detail.lastName,
        Email: detail.email,
        'Country Code': detail.countryCode,
        Mobile: detail.mobile,
        Image: detail.image,
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportRawCollectionAuthRole('accountant', search);
    const downloadPath = path.join(__dirname, `../templates/downloads/accountant.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'accountant.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportCollectionSupportRole = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await userService.exportCollectionAuthRole('supportTeam', search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('SupportTeamAccounts');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Image', key: 'image' },
        { header: 'Status', key: 'status' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        'First Name': detail.firstName,
        'Last Name': detail.lastName,
        Email: detail.email,
        'Country Code': detail.countryCode,
        Mobile: detail.mobile,
        Image: detail.image,
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportRawCollectionAuthRole('supportTeam', search);
    const downloadPath = path.join(__dirname, `../templates/downloads/supportTeam.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'supportTeam.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportCollectionCityzenRole = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await userService.exportCollectionCityzenRole(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : 'Unknow',
        status: detail.status ? 'Active' : 'Deactivated',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('CityMasterAccounts');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'City', key: 'cityName' },
        { header: 'Image', key: 'image' },
        { header: 'Status', key: 'status' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        'First Name': detail.firstName,
        'Last Name': detail.lastName,
        Email: detail.email,
        'Country Code': detail.countryCode,
        Mobile: detail.mobile,
        City:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : 'Unknow',
        Image: detail.image,
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportRawCollectionAuthRole('cityMaster', search);
    const downloadPath = path.join(__dirname, `../templates/downloads/cityMaster.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'cityMaster.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const webOtpVerification = catchAsync(async (req, res) => {
  const { id } = req.params;
  const response = await otpVerificationService.verifyWebVerification(id);
  if (response && response !== null && response.id !== '' && response.token !== '') {
    const kind = response.kind;
    const mode = response.mode;
    const locale = response.locale;
    const token = response.token;
    if (kind === 'login') {
      if (mode === 'msg91') {
        const smsProvider = await smsProviderConfigService.getSmsProviderBySlug('msg91');
        if (
          smsProvider &&
          smsProvider !== null &&
          smsProvider.slug === 'msg91' &&
          smsProvider.credentials &&
          smsProvider.credentials !== null &&
          smsProvider.credentials.widgetId !== null &&
          smsProvider.credentials.widgetId !== ''
        ) {
          const items = response.provider.split(',');
          if (checkArrayNotEmpty(items) && items.length === 3) {
            const creds = smsProvider.credentials;
            const savedToNumber = `${items[0]}${items[1]}`;
            const cleanedUserMobileNumber = savedToNumber.replace(/\+/g, '');
            const param = {
              authkey: creds.authkey,
              'access-token': token,
            };
            const smsResponse = await superagent
              .post('https://control.msg91.com/api/v5/widget/verifyAccessToken')
              .set('Content-Type', 'application/json')
              .send(param);
            if (smsResponse.status === 200 && smsResponse.text !== null) {
              if (
                smsResponse &&
                smsResponse.body &&
                smsResponse.body.type === 'success' &&
                smsResponse.body.message === cleanedUserMobileNumber
              ) {
                const userType = await authService.webAuthUserVerification(items[0], items[1]);
                if (userType.role == 'vendor' || userType.role === 'vendorOutlet') {
                  const user = await authService.vendorLoginWithPhoneOTP(
                    items[0],
                    items[1],
                    locale
                  );
                  const tokens = await tokenService.generateAuthTokens(
                    user,
                    getClientIp(req),
                    getClientUserAgent(req)
                  );
                  setWebAuthCookies(req, res, tokens, true);
                  await otpVerificationService.deleteWebOtp(id);
                  const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
                  if (user && user.role === 'vendorOutlet') {
                    const manager = await restaurantService.getRestaurantByIdVendorLogin(
                      vendor.outletManagerId
                    );
                    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
                    res.send({ user, vendor, manager, restaurant, kind: 'vendor' });
                  } else {
                    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
                    res.send({ user, vendor, restaurant, kind: 'vendor' });
                  }
                } else {
                  res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
                }
              } else {
                res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
              }
            } else {
              res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
            }
          } else {
            res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
          }
        } else {
          res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
        }
      } else if (mode === 'firebase') {
        try {
          const items = response.provider.split(',');
          if (checkArrayNotEmpty(items) && items.length === 3) {
            const userMobileNumber = `${items[0]}${items[1]}`;
            const cleanedUserMobileNumber = userMobileNumber.replace(/\+/g, '');
            const decodedToken = await admin.auth().verifyIdToken(token);
            if (
              decodedToken &&
              decodedToken !== null &&
              decodedToken.phone_number !== null &&
              decodedToken.phone_number !== ''
            ) {
              const cleanedFirebaseMobileNumber = decodedToken.phone_number.replace(/\+/g, '');
              if (cleanedUserMobileNumber === cleanedFirebaseMobileNumber) {
                const userType = await authService.webAuthUserVerification(items[0], items[1]);
                if (userType.role == 'vendor' || userType.role === 'vendorOutlet') {
                  const user = await authService.vendorLoginWithPhoneOTP(
                    items[0],
                    items[1],
                    locale
                  );
                  const tokens = await tokenService.generateAuthTokens(
                    user,
                    getClientIp(req),
                    getClientUserAgent(req)
                  );
                  setWebAuthCookies(req, res, tokens, true);
                  await otpVerificationService.deleteWebOtp(id);
                  const vendor = await restaurantService.getByUserIdVendorLogin(user.id);
                  if (user && user.role === 'vendorOutlet') {
                    const manager = await restaurantService.getRestaurantByIdVendorLogin(
                      vendor.outletManagerId
                    );
                    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
                    res.send({ user, vendor, manager, restaurant, kind: 'vendor' });
                  } else {
                    const restaurant = await restaurantService.getRestaurantLoginResponse(user.id);
                    res.send({ user, vendor, restaurant, kind: 'vendor' });
                  }
                } else {
                  res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
                }
              } else {
                res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
              }
            } else {
              res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
            }
          } else {
            res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
          }
        } catch (error) {
          res.status(400).send({ code: 400, message: error, extra: '' });
        }
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

module.exports = {
  register,
  registerFirebaseAccount,
  userLoginWithEmailAndPassword,
  userLoginWithCountryCodeAndMobilePassword,
  userLoginWithEmailOtpVerification,
  userLoginWithEmailOtp,
  userLoginWithPhoneOtpVerification,
  verifyWebSMSOTP,
  verifyWebVersionSMSOTP,
  verifyWebVersionResetPasswordSMSOTP,
  verifyFirebaseWebVersionSMSOTP,
  verifyFirebaseWebVersionResetPasswordSMSOTP,
  smsVerification,
  smsWebVersionVerification,
  smsWebVersionResetPasswordVerification,
  smsVerificationSuccess,
  smsVerificationFailed,
  userLoginWithPhoneOTP,
  verifyUserLoginFirebaseOTP,
  logout,
  logoutWeb,
  refreshTokensWeb,
  refreshTokensApp,
  forgotPasswordWithEmail,
  forgotPasswordWithPhone,
  forgotWebPasswordWithPhone,
  resetPassword,
  resetWebPassword,
  resetPasswordFirebase,
  verifyEmail,
  registerAdminAccount,
  isAdminSetupDone,
  adminLoginWithEmailAndPassword,
  vendorLoginWithEmailAndPassword,
  vendorWebLoginWithEmailAndPassword,
  vendorLoginWithCountryCodeAndMobilePassword,
  vendorWebLoginWithCountryCodeAndMobilePassword,
  vendorLoginWithEmailOtpVerification,
  vendorLoginWithEmailOtp,
  vendorWebLoginWithEmailOtp,
  vendorLoginWithPhoneOtpVerification,
  vendorWebLoginWithPhoneOtpVerification,
  vendorLoginWithPhoneOTP,
  vendorWebLoginWithPhoneOTP,
  verifyVendorLoginFirebaseOTP,
  verifyWebVendorLoginFirebaseOTP,
  verifyUserRegisterAccount,
  verifyOTP,
  resendOTP,
  createGuestAccount,
  driverLognWithEmailAndPassword,
  driverLoginWithCountryCodeAndMobilePassword,
  driverLoginWithEmailOtpVerification,
  driverLoginWithEmailOtp,
  driverLoginWithPhoneOtpVerification,
  driverLoginWithPhoneOTP,
  verifyDriverLoginFirebaseOTP,
  getMyProfile,
  updateMyProfile,
  checkUserRegisterStatus,
  waiterLognWithEmailAndPassword,
  waiterLoginWithPhoneAndPassword,
  waiterLoginWithEmailOtpVerification,
  waiterLoginWithEmailOtp,
  waiterLoginWithPhoneOtpVerification,
  waiterLoginWithPhoneOTP,
  verifyWaiterLoginFirebaseOTP,
  getRoleAccountList,
  addAdminAccount,
  addAccountantAccount,
  addSupportTeamAccount,
  cityMasterList,
  addCityMaterAccount,
  updateRoleStatus,
  roleAccountDetail,
  cityMasterAccountDetail,
  updateRoleDetail,
  updateCityMasterDetail,
  loginAccountantWithEmailAndPassword,
  loginBankWithEmailAndPassword,
  loginSupportTeamWithEmailAndPassword,
  loginCityzenWithEmailAndPassword,
  userLoginWithGoogleAccount,
  checkMobileNumberExist,
  createGoogleUserAccount,
  userLoginWithFacebookAccount,
  vendorLoginWithGoogleAccount,
  vendorLoginWithFacebookAccount,
  driverLoginWithGoogleAccount,
  driverLoginWithFacebookAccount,
  createFacebookUserAccount,
  kitchenOwnerLoginWithEmailAndPassword,
  kitchenLoginWithEmailOtpVerification,
  kitchenLoginWithEmailOtp,
  kitchenLoginWithPhoneAndPassword,
kitchenLoginWithPhoneOtpVerification,
  kitchenLoginWithPhoneOTP,
  dairyLoginWithPhoneOtpVerification,
  dairyLoginWithPhoneOTP,
  verifyKitchenLoginFirebaseOTP,
  kitchenLoginWithGoogleAccount,
  kitchenLoginWithFacebookAccount,
  waiterLoginWithGoogleAccount,
  waiterLoginWithFacebookAccount,
  adminDemoFirebaseSMS,
  adminDemoMSG91SMS,
  exportCollectionAdminRole,
  exportCollectionAccountantRole,
  exportCollectionSupportRole,
  exportCollectionCityzenRole,
  resetFirebaseWebPassword,
  webOtpVerification,
};

