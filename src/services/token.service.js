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

const jwt = require('jsonwebtoken');
const { status: httpStatus } = require('http-status');
const config = require('../config/config');
const User = require('../models/user.model');
const Token = require('../models/token.model');
const ApiError = require('../utils/ApiError');
const userService = require('./user.service');
const { tokenTypes } = require('../config/tokens');

const generateToken = (userId, expires, type, secret = config.jwt.secret) => {
  const expiresDate = expires instanceof Date ? expires : new Date(expires);
  const payload = {
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresDate.getTime() / 1000),
    type,
  };
  return jwt.sign(payload, secret);
};

const saveToken = async (
  token,
  userId,
  expires,
  type,
  blacklisted = false,
  userIp = '0.0.0.0',
  userAgent = 'unknown'
) => {
  return Token.create({
    token,
    user: userId,
    expires: expires instanceof Date ? expires : new Date(expires),
    type,
    blacklisted,
    ipAddress: userIp,
    userAgent,
  });
};

const verifyToken = async (token, type) => {
  const payload = jwt.verify(token, config.jwt.secret);
  const tokenDoc = await Token.findOne({
    token,
    type,
    user: payload.sub,
    blacklisted: false,
  });

  if (!tokenDoc) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Token not found');
  }

  return tokenDoc;
};

const generateAuthTokens = async (user, userIp = '0.0.0.0', userAgent = 'unknown') => {
  const accessTokenExpires = new Date(Date.now() + config.jwt.accessExpirationMinutes * 60 * 1000);
  const accessToken = generateToken(user.id, accessTokenExpires, tokenTypes.ACCESS);

  const refreshTokenExpires = new Date(
    Date.now() + config.jwt.refreshExpirationDays * 24 * 60 * 60 * 1000
  );
  const refreshToken = generateToken(user.id, refreshTokenExpires, tokenTypes.REFRESH);
  await saveToken(
    refreshToken,
    user.id,
    refreshTokenExpires,
    tokenTypes.REFRESH,
    false,
    userIp,
    userAgent
  );

  return {
    access: {
      token: accessToken,
      expires: accessTokenExpires,
    },
    refresh: {
      token: refreshToken,
      expires: refreshTokenExpires,
    },
  };
};

const verifyRefreshToken = async (refreshToken) => {
  const refreshTokenDoc = await verifyToken(refreshToken, tokenTypes.REFRESH);
  await refreshTokenDoc.deleteOne();
  return refreshTokenDoc;
};

const generateResetPasswordToken = async (email) => {
  const user = await User.findOne({ email });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No users found with this email');
  }
  const expires = new Date(Date.now() + config.jwt.resetPasswordExpirationMinutes * 60 * 1000);
  const resetPasswordToken = generateToken(user.id, expires, tokenTypes.RESET_PASSWORD);
  await saveToken(resetPasswordToken, user.id, expires, tokenTypes.RESET_PASSWORD);
  return resetPasswordToken;
};

const generateVerifyEmailToken = async (user) => {
  const expires = new Date(Date.now() + config.jwt.verifyEmailExpirationMinutes * 60 * 1000);
  const verifyEmailToken = generateToken(user.id, expires, tokenTypes.VERIFY_EMAIL);
  await saveToken(verifyEmailToken, user.id, expires, tokenTypes.VERIFY_EMAIL);
  return verifyEmailToken;
};

const generateResetPasswordTokenWithPhone = async (countryCode, mobileNumber) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No users found with this mobile number');
  }
  const expires = new Date(Date.now() + config.jwt.resetPasswordExpirationMinutes * 60 * 1000);
  const resetPasswordToken = generateToken(user.id, expires, tokenTypes.RESET_PASSWORD);
  await saveToken(resetPasswordToken, user.id, expires, tokenTypes.RESET_PASSWORD);
  return resetPasswordToken;
};

module.exports = {
  generateToken,
  saveToken,
  verifyToken,
  generateAuthTokens,
  verifyRefreshToken,
  generateResetPasswordToken,
  generateVerifyEmailToken,
  generateResetPasswordTokenWithPhone,
};

