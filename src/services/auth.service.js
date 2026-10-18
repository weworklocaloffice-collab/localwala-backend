const { status: httpStatus } = require('http-status');
const tokenService = require('./token.service');
const userService = require('./user.service');
const Token = require('../models/token.model');
const ApiError = require('../utils/ApiError');
const { tokenTypes } = require('../config/tokens');

const loginUserWithEmailAndPassword = async (email, password, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  if (!(user.role === 'user')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginUserWithCountryCodeAndPassword = async (
  countryCode,
  mobileNumber,
  password,
  appLocale
) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect Phone or password');
  }
  if (!(user.role === 'user')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginUserWithPhoneOTP = async (countryCode, mobileNumber, appLocale) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'user')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginWithEmailOtpVerification = async (email, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  if (!(user.role === 'user')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const userLoginWithSocialAccount = async (email, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    return { success: false };
  }
  if (!(user.role === 'user')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return { user, success: true };
};

const vendorLoginWithSocialAccount = async (email, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    return { success: false };
  }
  if (!(user.role === 'vendor' || user.role === 'vendorOutlet')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  const userDetail = {
    id: user.id,
    role: user.role,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
    countryCode: user.countryCode,
    mobile: user.mobile,
  };
  return { user: userDetail, success: true };
};

const guestUserLogin = async (uid) => {
  const user = await userService.getUserById(uid);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'guest')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  return user;
};

const loginAdminWithEmailAndPassword = async (email, password) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  if (!(user.role === 'admin')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  return user;
};

const loginVendorWithEmailAndPassword = async (email, password, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  if (!(user.role === 'vendor' || user.role === 'vendorOutlet')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
    countryCode: user.countryCode,
    mobile: user.mobile,
  };
};

const loginVendorWithPhoneAndPassword = async (countryCode, mobileNumber, password, appLocale) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect Phone or password');
  }
  if (!(user.role === 'vendor' || user.role === 'vendorOutlet')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
    countryCode: user.countryCode,
    mobile: user.mobile,
  };
};

const vendorLoginWithEmailOtpVerification = async (email, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'vendor' || user.role === 'vendorOutlet')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
    countryCode: user.countryCode,
    mobile: user.mobile,
  };
};

const webAuthUserVerification = async (countryCode, mobileNumber) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return {
    id: user.id,
    role: user.role,
  };
};

const vendorLoginWithPhoneOTP = async (countryCode, mobileNumber, appLocale) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'vendor' || user.role === 'vendorOutlet')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
    countryCode: user.countryCode,
    mobile: user.mobile,
  };
};

const loginDriverWithEmailAndPassword = async (email, password, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  if (!(user.role === 'driver' || user.role === 'vendorDriver')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginDriverWithCountryCodeAndPassword = async (
  countryCode,
  mobileNumber,
  password,
  appLocale
) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect Phone or password');
  }
  if (!(user.role === 'driver' || user.role === 'vendorDriver')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginDriverWithEmailOtpVerification = async (email, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'driver' || user.role === 'vendorDriver')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const driverLoginWithPhoneOTP = async (countryCode, mobileNumber, appLocale) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'driver' || user.role === 'vendorDriver')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const driverLoginWithSocialAccount = async (email, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'driver' || user.role === 'vendorDriver')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return { user, success: true };
};

const loginWaiterWithEmailAndPassword = async (email, password, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  if (!(user.role === 'waiter')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginWaiterWithCountryCodeAndPassword = async (
  countryCode,
  mobileNumber,
  password,
  appLocale
) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect Phone or password');
  }
  if (!(user.role === 'waiter')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginWaiterWithEmailOtpVerification = async (email, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'waiter')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginWaiterWithPhoneOTP = async (countryCode, mobileNumber, appLocale) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'waiter')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginWaiterWithSocialAccount = async (email, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'waiter')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return { user, success: true };
};

const loginKitchenOwnerWithEmailAndPassword = async (email, password, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  if (!(user.role === 'kitchen')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginKitchenWithEmailOtpVerification = async (email, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'kitchen')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginKitchenWithCountryCodeAndPassword = async (
  countryCode,
  mobileNumber,
  password,
  appLocale
) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect Phone or password');
  }
  if (!(user.role === 'kitchen')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginKitchenWithPhoneOTP = async (countryCode, mobileNumber, appLocale) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'kitchen')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

/**
 * Dairy vertical phone-OTP login.
 *
 * Accepts either `dairyPartner` or `dairyDriver`. The granular availability of
 * both roles for one user (the owner-operator case) is derived at login by
 * `modules/dairy/services/dairy.profile.service.js` rather than stored, because
 * `User.role` is a single-value enum.
 */
const loginDairyWithPhoneOTP = async (countryCode, mobileNumber, appLocale) => {
  const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'dairyPartner' || user.role === 'dairyDriver')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return user;
};

const loginKitchenWithSocialAccount = async (email, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.role === 'kitchen')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return { user, success: true };
};

const logout = async (refreshToken) => {
  const refreshTokenDoc = await Token.findOne({
    token: refreshToken,
    type: tokenTypes.REFRESH,
    blacklisted: false,
  });
  if (!refreshTokenDoc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await refreshTokenDoc.deleteOne();
};

const logoutWeb = async (refreshToken) => {
  const refreshTokenDoc = await Token.findOne({
    token: refreshToken,
    type: tokenTypes.REFRESH,
    blacklisted: false,
  });
  if (refreshTokenDoc) {
    await refreshTokenDoc.deleteOne();
  }
};

const refreshAuth = async (refreshToken) => {
  try {
    const refreshTokenDoc = await tokenService.verifyToken(refreshToken, tokenTypes.REFRESH);
    const user = await userService.getUserById(refreshTokenDoc.user);
    if (!user) {
      throw new Error();
    }
    await refreshTokenDoc.deleteOne();
    return tokenService.generateAuthTokens(user);
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate');
  }
};

const refreshAuthApp = async (refreshToken) => {
  try {
    const refreshTokenDoc = await tokenService.verifyToken(refreshToken, tokenTypes.REFRESH);
    const user = await userService.getUserById(refreshTokenDoc.user);
    if (!user) {
      throw new Error();
    }
    await refreshTokenDoc.deleteOne();
    return tokenService.generateAuthTokens(user);
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    return new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate');
  }
};

const resetPassword = async (resetPasswordToken, newPassword) => {
  try {
    const resetPasswordTokenDoc = await tokenService.verifyToken(
      resetPasswordToken,
      tokenTypes.RESET_PASSWORD
    );
    const user = await userService.getUserById(resetPasswordTokenDoc.user);
    if (!user) {
      throw new Error();
    }
    await userService.updateUserById(user.id, { password: newPassword });
    await Token.deleteMany({ user: user.id, type: tokenTypes.RESET_PASSWORD });
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Password reset failed');
  }
};

const verifyEmail = async (verifyEmailToken) => {
  try {
    const verifyEmailTokenDoc = await tokenService.verifyToken(
      verifyEmailToken,
      tokenTypes.VERIFY_EMAIL
    );
    const user = await userService.getUserById(verifyEmailTokenDoc.user);
    if (!user) {
      throw new Error();
    }
    await Token.deleteMany({ user: user.id, type: tokenTypes.VERIFY_EMAIL });
    await userService.updateUserById(user.id, { isEmailVerified: true });
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Email verification failed');
  }
};

const loginAccountantWithEmailAndPassword = async (email, password, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  if (!(user.role === 'accountant')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
  };
};

const loginBankWithEmailAndPassword = async (email, password, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  if (!(user.role === 'bank')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  const RealEstateBankMember = require('../modules/realestate/models/realestate.bank.member.model');
  const member = await RealEstateBankMember.findOne({ user: user.id, status: 'ACTIVE' });
  if (!member) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'No active bank membership');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
  };
};

const loginSupportTeamWithEmailAndPassword = async (email, password, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  if (!(user.role === 'supportTeam' || user.role === 'supportSupervisor')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  // A shift starts available. `availability` is a manual, sticky state, and
  // nothing else ever cleared it — so an agent who set Busy/Offline before
  // logging out came back the next day still flagged that way on the
  // supervisor roster. `online` deliberately stays false until the first
  // heartbeat from the new session.
  const { AgentPresence } = require('../models');
  await AgentPresence.updateOne(
    { agentId: user.id },
    { $set: { availability: 'available', online: false, currentRooms: [], cleanLogout: false, lastSeen: new Date() } }
  );
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
    role: user.role,
  };
};

const loginCityzenWithEmailAndPassword = async (email, password, appLocale) => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  if (!(user.role === 'cityMaster')) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Unauthorized');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }
  Object.assign(user, { locale: appLocale });
  await user.save();
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    image: user.image,
    city: user.city,
  };
};

const resetFirebaseWebPassword = async (countryCode, mobileNumber, newPassword) => {
  try {
    const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
    }
    await userService.updateUserById(user.id, { password: newPassword });
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Password reset failed');
  }
};

const updateWebAuthPassword = async (countryCode, mobileNumber, newPassword) => {
  try {
    const user = await userService.getUserByCountryCodeAndMobileNumber(countryCode, mobileNumber);
    if (!user) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
    }
    await userService.updateUserById(user.id, { password: newPassword });
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Password reset failed');
  }
};

module.exports = {
  loginUserWithEmailAndPassword,
  loginUserWithCountryCodeAndPassword,
  loginWithEmailOtpVerification,
  loginUserWithPhoneOTP,
  loginAdminWithEmailAndPassword,
  loginVendorWithEmailAndPassword,
  loginVendorWithPhoneAndPassword,
  vendorLoginWithEmailOtpVerification,
  vendorLoginWithPhoneOTP,
  logout,
  logoutWeb,
  refreshAuth,
  refreshAuthApp,
  resetPassword,
  verifyEmail,
  guestUserLogin,
  loginDriverWithEmailAndPassword,
  loginDriverWithCountryCodeAndPassword,
  loginDriverWithEmailOtpVerification,
  driverLoginWithPhoneOTP,
  loginWaiterWithEmailAndPassword,
  loginWaiterWithCountryCodeAndPassword,
  loginWaiterWithEmailOtpVerification,
  loginWaiterWithPhoneOTP,
  loginAccountantWithEmailAndPassword,
  loginBankWithEmailAndPassword,
  loginSupportTeamWithEmailAndPassword,
  loginCityzenWithEmailAndPassword,
  userLoginWithSocialAccount,
  vendorLoginWithSocialAccount,
  loginKitchenOwnerWithEmailAndPassword,
  loginKitchenWithEmailOtpVerification,
  loginKitchenWithCountryCodeAndPassword,
  loginKitchenWithPhoneOTP,
  driverLoginWithSocialAccount,
  loginKitchenWithSocialAccount,
  loginDairyWithPhoneOTP,
  loginWaiterWithSocialAccount,
  resetFirebaseWebPassword,
  webAuthUserVerification,
  updateWebAuthPassword,
};
