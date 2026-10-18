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

const admin = require('firebase-admin');
const { status: httpStatus } = require('http-status');
const multer = require('multer');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const otpGenerator = require('otp-generator');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const {
  userService,
  walletService,
  referralService,
  businessSettingsService,
  emailConfigService,
  otpVerificationService,
  smsProviderConfigService,
} = require('../services');
const { Wallet, ReferralCode } = require('../models');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const {
  customerSchemaKeys,
  authRoleSchemaKeys,
  customerWalletFundSchemaKeys,
  deliverymanWalletFundSchemaKeys,
} = require('../utils/importCollectionSchema');

const createUser = catchAsync(async (req, res) => {
  const user = await userService.createUser(req.body);
  res.status(201).send(user);
});

const getUser = catchAsync(async (req, res) => {
  const user = await userService.getUserById(req.params.userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  res.send(user);
});

const updateUser = catchAsync(async (req, res) => {
  const user = await userService.updateUserById(req.params.userId, req.body);
  res.send(user);
});

const deleteUser = catchAsync(async (req, res) => {
  await userService.deleteUserById(req.params.userId);
  res.send({ success: true });
});

const findUserWithName = catchAsync(async (req, res) => {
  const results = await userService.findUserWithName(req.params.name);
  res.send(results);
});

const getMyDriverProfile = catchAsync(async (req, res) => {
  const { uid } = req.params;
  const results = await userService.getMyDriverProfile(uid);
  res.send(results);
});

const kitchenOwnerProfile = catchAsync(async (req, res) => {
  const { uid } = req.params;
  const results = await userService.kitchenOwnerProfile(uid);
  res.send(results);
});

const updateDeliverymanProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const results = await userService.updateDeliverymanProfile(id, req.body);
  res.send(results);
});

const updateKitchenOwnerProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const results = await userService.updateKitchenOwnerProfile(id, req.body);
  res.send(results);
});

const getMyReferralCode = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const results = await userService.getMyReferralCode(userId);
  res.send(results);
});

const callCustomer = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const results = await userService.callCustomer(userId);
  res.send(results);
});

const customerList = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'filter',
    'search',
    'sortBy',
    'role',
    'status',
    'joiningDate',
    'limit',
    'page',
  ]);
  const result = await userService.customerList(options);
  res.send(result);
});

const updateStatus = catchAsync(async (req, res) => {
  const result = await userService.updateStatus(req.params.id, req.body);
  res.send(result);
});

const customerWalletFundList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit', 'page', 'search']);
  const result = await userService.customerWalletFundList(options);
  res.send(result);
});

const customerReport = catchAsync(async (req, res) => {
  const options = pick(req.query, ['kind', 'limit', 'page', 'search']);
  const result = await userService.customerReport(options);
  res.send(result);
});

const customerDetail = catchAsync(async (req, res) => {
  const { user } = req.params;
  const result = await userService.customerDetail(user);
  res.send(result);
});

const adminCreateCustomer = catchAsync(async (req, res) => {
  const user = await userService.adminCreateCustomer(req.body);
  const walletData = new Wallet({
    holderId: user.id,
  });
  const referralCode = new ReferralCode({
    holderId: user.id,
  });
  await walletService.createWallet(walletData);
  await referralService.createReferralCode(referralCode);
  res.status(201).send({ user });
});

const cityzenCreateCustomer = catchAsync(async (req, res) => {
  const user = await userService.adminCreateCustomer(req.body);
  const walletData = new Wallet({
    holderId: user.id,
  });
  const referralCode = new ReferralCode({
    holderId: user.id,
  });
  await walletService.createWallet(walletData);
  await referralService.createReferralCode(referralCode);
  res.status(201).send({ user });
});

const adminPosCustomerDetail = catchAsync(async (req, res) => {
  const { user } = req.params;
  const result = await userService.adminPosCustomerDetail(user);
  res.send(result);
});

const adminProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.adminProfile(id);
  res.send(result);
});

const accountantProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.accountantProfile(id);
  res.send(result);
});

const supportTeamProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.supportTeamProfile(id);
  res.send(result);
});

const cityMasterTeamProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.cityMasterTeamProfile(id);
  res.send(result);
});

const supportTeamCustomerDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.supportTeamCustomerDetail(id);
  res.send(result);
});

const getAdminProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.getAdminProfile(id);
  res.send(result);
});

const getAccountantProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.getAccountantProfile(id);
  res.send(result);
});

const getVendorProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.getVendorProfile(id);
  res.send(result);
});

const getSupportTeamProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.getSupportTeamProfile(id);
  res.send(result);
});

const getCityzenProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.getCityzenProfile(id);
  res.send(result);
});

const updateAdminProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.updateAdminProfile(id, req.body);
  res.send(result);
});

const updateAccountantProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.updateAccountantProfile(id, req.body);
  res.send(result);
});

const updateVendorProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.updateVendorProfile(id, req.body);
  res.send(result);
});

const updateSupportTeamProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.updateSupportTeamProfile(id, req.body);
  res.send(result);
});

const updateCityzenProfile = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userService.updateCityzenProfile(id, req.body);
  res.send(result);
});

const updateAdminPassword = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const result = await userService.updateAdminPassword(id, password);
  res.send(result);
});

const updateAccountantPassword = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const result = await userService.updateAccountantPassword(id, password);
  res.send(result);
});

const updateVendorPassword = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const result = await userService.updateVendorPassword(id, password);
  res.send(result);
});

const updateSupportTeamPassword = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const result = await userService.updateSupportTeamPassword(id, password);
  res.send(result);
});

const updateCityzenPassword = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const result = await userService.updateCityzenPassword(id, password);
  res.send(result);
});

const updatePassword = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const result = await userService.updatePassword(id, password);
  res.send(result);
});

const updateEmail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { email, locale } = req.body;
  const result = await userService.updateEmail(id, email);
  if (result.success) {
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
    const sendEmail = await emailConfigService.sendVerificationEmail(email, generatedOTP, locale);
    if (sendEmail) {
      const otpData = await otpVerificationService.saveOTP({
        provider: email,
        otp: generatedOTP,
        mode: 'email_otp',
        locale: `${locale}`,
      });
      if (otpData) {
        res.status(201).send({
          sent: false,
          target: 'otp_screen',
          method: 'email_otp',
          otpLength: otpLengths,
          canResendOtp: canResendOtps,
          id: otpData.id,
          provider: email,
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

const updateEmailAfterVerification = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { email, verificationId } = req.body;
  const verification = await otpVerificationService.verifyWithPhoneOTP(verificationId);
  if (verification && verification !== null && verification.id === verificationId) {
    const result = await userService.updateEmailAfterVerification(id, email);
    res.send(result);
  } else {
    res.status(404).send({ code: 404, message: 'Not found', extra: '' });
  }
});

const updateMobileNumber = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { countryCode, mobileNumber, locale } = req.body;
  const result = await userService.updateMobileNumber(id, countryCode, mobileNumber);
  if (result.success) {
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
      });
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const updateMobileAfterVerification = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { countryCode, mobileNumber, verificationId } = req.body;
  const verification = await otpVerificationService.verifyWithPhoneOTP(verificationId);
  if (verification && verification !== null && verification.id === verificationId) {
    const result = await userService.updateMobileNumberAfterVerification(
      id,
      countryCode,
      mobileNumber
    );
    res.send(result);
  } else {
    res.status(404).send({ code: 404, message: 'Not found', extra: '' });
  }
});

const updateMobileAfterFirebaseVerification = catchAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const { token, countryCode, mobileNumber } = req.body;
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
        const result = await userService.updateMobileNumberAfterVerification(
          id,
          countryCode,
          mobileNumber
        );
        res.send(result);
      } else {
        res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
    res.send({ id });
  } catch (error) {
    res.status(400).send({ code: 400, message: error, extra: '' });
  }
});

const deleteUserAccount = catchAsync(async (req, res) => {
  const { reason, user } = req.body;
  const result = await userService.userDeleteAccount(user, reason);
  res.send(result);
});

const customerDeletedAccount = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit', 'page', 'search']);
  const result = await userService.customerDeletedAccount(options);
  res.send(result);
});

const restaurantDeleteAccount = catchAsync(async (req, res) => {
  const { reason, user, restaurant } = req.body;
  const result = await userService.restaurantDeleteAccount(user, restaurant, reason);
  res.send(result);
});

const restaurantDeletedAccount = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit', 'page', 'search']);
  const result = await userService.restaurantDeletedAccount(options);
  res.send(result);
});

const deliverymanDeleteAccount = catchAsync(async (req, res) => {
  const { reason, user } = req.body;
  const result = await userService.deliverymanDeleteAccount(user, reason);
  res.send(result);
});

const deliverymanDeletedAccount = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit', 'page', 'search']);
  const result = await userService.deliverymanDeletedAccount(options);
  res.send(result);
});

const waiterDeleteAccount = catchAsync(async (req, res) => {
  const { reason, user } = req.body;
  const result = await userService.waiterDeleteAccount(user, reason);
  res.send(result);
});

const waiterDeletedAccount = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit', 'page', 'search']);
  const result = await userService.waiterDeletedAccount(options);
  res.send(result);
});

const kitchenDeleteAccount = catchAsync(async (req, res) => {
  const { reason, user } = req.body;
  const result = await userService.kitchenDeleteAccount(user, reason);
  res.send(result);
});

const kitchenDeletedAccount = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit', 'page', 'search']);
  const result = await userService.kitchenDeletedAccount(options);
  res.send(result);
});

const adminUserContactDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const user = await userService.adminUserContactDetail(id);
  res.send(user);
});

const exportCollectionCustomerDeletedAccounts = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await userService.exportCollectionCustomerDeletedAccounts(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        reasonId:
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        reasonName:
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
        deletedOn: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('CustomerDeletedAccounts');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Reason Id', key: 'reasonId' },
        { header: 'Reason Name', key: 'reasonName' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Gender', key: 'gender' },
        { header: 'Wallet Balance', key: 'walletBalance' },
        { header: 'Loyalty Points', key: 'loyaltyPoints' },
        { header: 'Favourite Food', key: 'favFood' },
        { header: 'Favourite Orders', key: 'favOrders' },
        { header: 'Favourite Restaurants', key: 'favRest' },
        { header: 'Hidden Restaurants', key: 'hiddenRest' },
        { header: 'Medias', key: 'medias' },
        { header: 'User Complaints', key: 'userComplaints' },
        { header: 'Restaurant Complaints', key: 'restaurantComplaints' },
        { header: 'Direct Chat', key: 'directChat' },
        { header: 'Support Chat', key: 'supportChat' },
        { header: 'Order Count', key: 'orderCount' },
        { header: 'Order Grand Total', key: 'orderGrandTotal' },
        { header: 'Order Refund', key: 'orderRefund' },
        { header: 'Dining Bookings', key: 'diningBookings' },
        { header: 'Dining Grand Total', key: 'diningGrandTotal' },
        { header: 'Dining Refund', key: 'diningRefund' },
        { header: 'Tiffin Packages', key: 'tiffinPackages' },
        { header: 'Tiffin Package Grand Total', key: 'tiffinPackageGrandTotal' },
        { header: 'Tiffin Refund', key: 'tiffinRefund' },
        { header: 'Deleted On', key: 'deletedOn' },
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
        'Reason Id':
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        'Reason Name':
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
        'First Name': detail.firstName,
        'Last Name': detail.lastName,
        Email: detail.email,
        'Country Code': detail.countryCode,
        Mobile: detail.mobile,
        Gender: detail.gender,
        'Wallet Balance': detail.walletBalance,
        'Loyalty Points': detail.loyaltyPoints,
        'Favourite Food': detail.favFood,
        'Favourite Orders': detail.favOrders,
        'Favourite Restaurants': detail.favRest,
        'Hidden Restaurants': detail.hiddenRest,
        Medias: detail.medias,
        'User Complaints': detail.userComplaints,
        'Restaurant Complaints': detail.restaurantComplaints,
        'Direct Chat': detail.directChat,
        'Support Chat': detail.supportChat,
        'Order Count': detail.orderCount,
        'Order Grand Total': detail.orderGrandTotal,
        'Order Refund': detail.orderRefund,
        'Dining Bookings': detail.diningBookings,
        'Dining Grand Total': detail.diningGrandTotal,
        'Dining Refund': detail.diningRefund,
        'Tiffin Packages': detail.tiffinPackages,
        'Tiffin Package Grand Total': detail.tiffinPackageGrandTotal,
        'Tiffin Refund': detail.tiffinRefund,
        'Deleted On': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportCollectionRawCustomerDeletedAccounts(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/deleteduseraccounts.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deleteduseraccounts.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportCollectionRestaurantDeletedAccounts = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await userService.exportCollectionRestaurantDeletedAccounts(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        reasonId:
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        reasonName:
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
        cityId:
          detail &&
          detail.city &&
          detail.city.id &&
          detail.city.id !== null &&
          detail.city.id !== ''
            ? detail.city.id
            : '-',
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        localityId:
          detail &&
          detail.locality &&
          detail.locality.id &&
          detail.locality.id !== null &&
          detail.locality.id !== ''
            ? detail.locality.id
            : '-',
        localityName:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        packageId:
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.id &&
          detail.subscriptionInfo.id !== null &&
          detail.subscriptionInfo.id !== ''
            ? detail.subscriptionInfo.id
            : '-',
        packageName:
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
        pos: detail.pos ? 'Yes' : 'No',
        ownDriver: detail.ownDriver ? 'Yes' : 'No',
        promote: detail.promote ? 'Yes' : 'No',
        customCategory: detail.customCategory ? 'Yes' : 'No',
        multiOutlet: detail.multiOutlet ? 'Yes' : 'No',
        preBooking: detail.preBooking ? 'Yes' : 'No',
        tableOrder: detail.tableOrder ? 'Yes' : 'No',
        tiffinSubscription: detail.tiffinSubscription ? 'Yes' : 'No',
        ownWaiter: detail.ownWaiter ? 'Yes' : 'No',
        ownKitchen: detail.ownKitchen ? 'Yes' : 'No',
        takeAway: detail.takeAway ? 'Yes' : 'No',
        acceptScheduleDelivery: detail.acceptScheduleDelivery ? 'Yes' : 'No',
        acceptHomeDelivery: detail.acceptHomeDelivery ? 'Yes' : 'No',
        deletedOn: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RestaurantDeletedAccounts');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Address', key: 'address' },
        { header: 'Slug', key: 'slug' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Gender', key: 'gender' },
        { header: 'Reason Id', key: 'reasonId' },
        { header: 'Reason Name', key: 'reasonName' },
        { header: 'City Id', key: 'cityId' },
        { header: 'City Name', key: 'cityName' },
        { header: 'Locality Id', key: 'localityId' },
        { header: 'Locality Name', key: 'localityName' },
        { header: 'Rating', key: 'rating' },
        { header: 'Total Rating', key: 'totalRating' },
        { header: 'Type', key: 'type' },
        { header: 'Commission', key: 'commission' },
        { header: 'POS Order Commission', key: 'posOrderCommission' },
        { header: 'Table Order Commission', key: 'tableOrderCommission' },
        { header: 'Deliverymans', key: 'deliverymans' },
        { header: 'Tiffin Packages', key: 'tiffinPackages' },
        { header: 'Sold Tiffin Packages', key: 'soldTiffinPackages' },
        { header: 'Order Refund', key: 'orderRefund' },
        { header: 'Dining Refund', key: 'diningRefund' },
        { header: 'Tiffin Refund', key: 'tiffinRefund' },
        { header: 'User Complaints', key: 'userComplaints' },
        { header: 'Restaurant Complaints', key: 'restaurantComplaints' },
        { header: 'Orders', key: 'orders' },
        { header: 'Foods', key: 'foods' },
        { header: 'Dining Bookings', key: 'diningBookings' },
        { header: 'POS Orders', key: 'posOrders' },
        { header: 'Table Orders', key: 'tableOrders' },
        { header: 'Medias', key: 'medias' },
        { header: 'Direct Chat', key: 'directChat' },
        { header: 'Support Chat', key: 'supportChat' },
        { header: 'POS', key: 'pos' },
        { header: 'Own Driver', key: 'ownDriver' },
        { header: 'Promote', key: 'promote' },
        { header: 'Custom Category', key: 'customCategory' },
        { header: 'Multi Outlet', key: 'multiOutlet' },
        { header: 'Pre Booking', key: 'preBooking' },
        { header: 'Table Order', key: 'tableOrder' },
        { header: 'Tiffin Subscription', key: 'tiffinSubscription' },
        { header: 'Own Waiter', key: 'ownWaiter' },
        { header: 'Own Kitchen', key: 'ownKitchen' },
        { header: 'TakeAway', key: 'takeAway' },
        { header: 'Accept Schedule Delivery', key: 'acceptScheduleDelivery' },
        { header: 'Accept Home Delivery', key: 'acceptHomeDelivery' },
        { header: 'Wallet Balance', key: 'walletBalance' },
        { header: 'Order Earning Amount', key: 'orderEarningAmount' },
        { header: 'Order Discount Given Amount', key: 'orderDiscountGivenAmount' },
        { header: 'Order Restaurant Commission', key: 'orderRestaurantCommission' },
        { header: 'Order Food Tax Amount', key: 'orderFoodTaxAmount' },
        { header: 'Order Service Charge Amount', key: 'orderServiceChargeAmount' },
        { header: 'POS Earning Amount', key: 'posEarningAmount' },
        { header: 'POS Discount Given Amount', key: 'posDiscountGivenAmount' },
        { header: 'POS Restaurant Commission', key: 'posRestaurantCommission' },
        { header: 'POS Food Tax Amount', key: 'posFoodTaxAmount' },
        { header: 'POS Service Charge Amount', key: 'posServiceChargeAmount' },
        { header: 'Table Order Earning Amount', key: 'tableOrderEarningAmount' },
        { header: 'Table Order Discount Given Amount', key: 'tableOrderDiscountGivenAmount' },
        { header: 'Table Order Restaurant Commission', key: 'tableOrderRestaurantCommission' },
        { header: 'Table Order Food Tax Amount', key: 'tableOrderFoodTaxAmount' },
        { header: 'Table Order Service Charge Amount', key: 'tableOrderServiceChargeAmount' },
        { header: 'Dining Earning Amount', key: 'diningEarningAmount' },
        { header: 'Dining Commission Amount', key: 'diningCommissionAmount' },
        { header: 'Package Id', key: 'packageId' },
        { header: 'Package Name', key: 'packageName' },
        { header: 'Deleted On', key: 'deletedOn' },
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
        Name: detail.name,
        Address: detail.address,
        Slug: detail.slug,
        'First Name': detail.firstName,
        'Last Name': detail.lastName,
        Email: detail.email,
        'Country Code': detail.countryCode,
        Mobile: detail.mobile,
        Gender: detail.gender,
        'Reason Id':
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        'Reason Name':
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
        'City Id':
          detail &&
          detail.city &&
          detail.city.id &&
          detail.city.id !== null &&
          detail.city.id !== ''
            ? detail.city.id
            : '-',
        'City Name':
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        'Locality Id':
          detail &&
          detail.locality &&
          detail.locality.id &&
          detail.locality.id !== null &&
          detail.locality.id !== ''
            ? detail.locality.id
            : '-',
        'Locality Name':
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        Rating: detail.rating,
        'Total Rating': detail.totalRating,
        Type: detail.type,
        Commission: detail.commission,
        'POS Order Commission': detail.posOrderCommission,
        'Table Order Commission': detail.tableOrderCommission,
        Deliverymans: detail.deliverymans,
        'Tiffin Packages': detail.tiffinPackages,
        'Sold Tiffin Packages': detail.soldTiffinPackages,
        'Order Refund': detail.orderRefund,
        'Dining Refund': detail.diningRefund,
        'Tiffin Refund': detail.tiffinRefund,
        'User Complaints': detail.userComplaints,
        'Restaurant Complaints': detail.restaurantComplaints,
        Orders: detail.orders,
        Foods: detail.foods,
        'Dining Bookings': detail.diningBookings,
        'POS Orders': detail.posOrders,
        'Table Orders': detail.tableOrders,
        Medias: detail.medias,
        'Direct Chat': detail.directChat,
        'Support Chat': detail.supportChat,
        POS: detail.pos ? 'Yes' : 'No',
        'Own Driver': detail.ownDriver ? 'Yes' : 'No',
        Promote: detail.promote ? 'Yes' : 'No',
        'Custom Category': detail.customCategory ? 'Yes' : 'No',
        'Multi Outlet': detail.multiOutlet ? 'Yes' : 'No',
        'Pre Booking': detail.preBooking ? 'Yes' : 'No',
        'Table Order': detail.tableOrder ? 'Yes' : 'No',
        'Tiffin Subscription': detail.tiffinSubscription ? 'Yes' : 'No',
        'Own Waiter': detail.ownWaiter ? 'Yes' : 'No',
        'Own Kitchen': detail.ownKitchen ? 'Yes' : 'No',
        TakeAway: detail.takeAway ? 'Yes' : 'No',
        'Accept Schedule Delivery': detail.acceptScheduleDelivery ? 'Yes' : 'No',
        'Accept Home Delivery': detail.acceptHomeDelivery ? 'Yes' : 'No',
        'Wallet Balance': detail.walletBalance,
        'Order Earning Amount': detail.orderEarningAmount,
        'Order Discount Given Amount': detail.orderDiscountGivenAmount,
        'Order Restaurant Commission': detail.orderRestaurantCommission,
        'Order Food Tax Amount': detail.orderFoodTaxAmount,
        'Order Service Charge Amount': detail.orderServiceChargeAmount,
        'POS Earning Amount': detail.posEarningAmount,
        'POS Discount Given Amount': detail.posDiscountGivenAmount,
        'POS Restaurant Commission': detail.posRestaurantCommission,
        'POS Food Tax Amount': detail.posFoodTaxAmount,
        'POS Service Charge Amount': detail.posServiceChargeAmount,
        'Table Order Earning Amount': detail.tableOrderEarningAmount,
        'Table Order Discount Given Amount': detail.tableOrderDiscountGivenAmount,
        'Table Order Restaurant Commission': detail.tableOrderRestaurantCommission,
        'Table Order Food Tax Amount': detail.tableOrderFoodTaxAmount,
        'Table Order Service Charge Amount': detail.tableOrderServiceChargeAmount,
        'Dining Earning Amount': detail.diningEarningAmount,
        'Dining Commission Amount': detail.diningCommissionAmount,
        'Package Id':
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.id &&
          detail.subscriptionInfo.id !== null &&
          detail.subscriptionInfo.id !== ''
            ? detail.subscriptionInfo.id
            : '-',
        'Package Name':
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
        'Deleted On': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportCollectionRawRestaurantDeletedAccounts(search);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/deletedrestaurantaccounts.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deletedrestaurantaccounts.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportCollectionDeliverymanDeletedAccounts = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await userService.exportCollectionDeliverymanDeletedAccounts(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        reasonId:
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        reasonName:
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
        cityId:
          detail &&
          detail.city &&
          detail.city.id &&
          detail.city.id !== null &&
          detail.city.id !== ''
            ? detail.city.id
            : '-',
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        localityId:
          detail &&
          detail.locality &&
          detail.locality.id &&
          detail.locality.id !== null &&
          detail.locality.id !== ''
            ? detail.locality.id
            : '-',
        localityName:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        restaurantId:
          detail &&
          detail.restaurant &&
          detail.restaurant.id &&
          detail.restaurant.id !== null &&
          detail.restaurant.id !== ''
            ? detail.restaurant.id
            : '-',
        restaurantName:
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : '-',
        deletedOn: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('DeliverymanDeletedAccounts');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Gender', key: 'gender' },
        { header: 'Role', key: 'role' },
        { header: 'Type', key: 'type' },
        { header: 'Reason Id', key: 'reasonId' },
        { header: 'Reason Name', key: 'reasonName' },
        { header: 'City Id', key: 'cityId' },
        { header: 'City Name', key: 'cityName' },
        { header: 'Locality Id', key: 'localityId' },
        { header: 'Locality Name', key: 'localityName' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Cancelled Order', key: 'cancelledOrder' },
        { header: 'Delayed Order', key: 'delayedOrder' },
        { header: 'Delivered Orders', key: 'deliveredOrders' },
        { header: 'Rating', key: 'rating' },
        { header: 'Total Rating', key: 'totalRating' },
        { header: 'Rejected Order', key: 'rejectedOrder' },
        { header: 'Medias', key: 'medias' },
        { header: 'Direct Chat', key: 'directChat' },
        { header: 'Support Chat', key: 'supportChat' },
        { header: 'Extra Earning On Shift Amount', key: 'extraEarningOnShiftAmount' },
        { header: 'Incentive Amount', key: 'incentiveAmount' },
        { header: 'Tip Amount', key: 'tipAmount' },
        { header: 'Total Earning', key: 'totalEarning' },
        { header: 'Wallet Balance', key: 'walletBalance' },
        { header: 'Deleted On', key: 'deletedOn' },
      ];
      const itemArray = [];
      worksheet.columns.forEach((element) => {
        itemArray.push({ key: element.header, value: element.key });
      });

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
        Gender: detail.gender,
        Role: detail.role,
        Type: detail.type,
        'Reason Id':
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        'Reason Name':
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
        'City Id':
          detail &&
          detail.city &&
          detail.city.id &&
          detail.city.id !== null &&
          detail.city.id !== ''
            ? detail.city.id
            : '-',
        'City Name':
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        'Locality Id':
          detail &&
          detail.locality &&
          detail.locality.id &&
          detail.locality.id !== null &&
          detail.locality.id !== ''
            ? detail.locality.id
            : '-',
        'Locality Name':
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        'Restaurant Id':
          detail &&
          detail.restaurant &&
          detail.restaurant.id &&
          detail.restaurant.id !== null &&
          detail.restaurant.id !== ''
            ? detail.restaurant.id
            : '-',
        'Restaurant Name':
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : '-',
        'Cancelled Order': detail.cancelledOrder,
        'Delayed Order': detail.delayedOrder,
        'Delivered Orders': detail.deliveredOrders,
        Rating: detail.rating,
        'Total Rating': detail.totalRating,
        'Rejected Order': detail.rejectedOrder,
        Medias: detail.medias,
        'Direct Chat': detail.directChat,
        'Support Chat': detail.supportChat,
        'Extra Earning On Shift Amount': detail.extraEarningOnShiftAmount,
        'Incentive Amount': detail.incentiveAmount,
        'Tip Amount': detail.tipAmount,
        'Total Earning': detail.totalEarning,
        'Wallet Balance': detail.walletBalance,
        'Deleted On': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportCollectionRawDeliverymanDeletedAccounts(search);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/deleteddeliverymanaccounts.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deleteddeliverymanaccounts.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportCollectionWaiterDeletedAccounts = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await userService.exportCollectionWaiterDeletedAccounts(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        reasonId:
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        reasonName:
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
        restaurantId:
          detail &&
          detail.restaurant &&
          detail.restaurant.id &&
          detail.restaurant.id !== null &&
          detail.restaurant.id !== ''
            ? detail.restaurant.id
            : '-',
        restaurantName:
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : '-',
        deletedOn: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('WaiterDeletedAccounts');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Gender', key: 'gender' },
        { header: 'Order Count', key: 'orderCount' },
        { header: 'Reason Id', key: 'reasonId' },
        { header: 'Reason Name', key: 'reasonName' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Deleted On', key: 'deletedOn' },
      ];
      const itemArray = [];
      worksheet.columns.forEach((element) => {
        itemArray.push({ key: element.header, value: element.key });
      });

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
        Gender: detail.gender,
        'Order Count': detail.orderCount,
        'Reason Id':
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        'Reason Name':
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
        'Restaurant Id':
          detail &&
          detail.restaurant &&
          detail.restaurant.id &&
          detail.restaurant.id !== null &&
          detail.restaurant.id !== ''
            ? detail.restaurant.id
            : '-',
        'Restaurant Name':
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : '-',
        'Deleted On': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportCollectionRawWaiterDeletedAccounts(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/deletedwaiteraccounts.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deletedwaiteraccounts.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportCollectionKitchenOwnerDeletedAccounts = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await userService.exportCollectionKitchenOwnerDeletedAccounts(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        reasonId:
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        reasonName:
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
        restaurantId:
          detail &&
          detail.restaurant &&
          detail.restaurant.id &&
          detail.restaurant.id !== null &&
          detail.restaurant.id !== ''
            ? detail.restaurant.id
            : '-',
        restaurantName:
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : '-',
        deletedOn: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('KitchenOwnerDeletedAccounts');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Gender', key: 'gender' },
        { header: 'Reason Id', key: 'reasonId' },
        { header: 'Reason Name', key: 'reasonName' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Deleted On', key: 'deletedOn' },
      ];
      const itemArray = [];
      worksheet.columns.forEach((element) => {
        itemArray.push({ key: element.header, value: element.key });
      });

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
        Gender: detail.gender,
        'Reason Id':
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        'Reason Name':
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
        'Restaurant Id':
          detail &&
          detail.restaurant &&
          detail.restaurant.id &&
          detail.restaurant.id !== null &&
          detail.restaurant.id !== ''
            ? detail.restaurant.id
            : '-',
        'Restaurant Name':
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : '-',
        'Deleted On': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportCollectionRawKitchenOwnerDeletedAccounts(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/deletedkitchenaccounts.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deletedkitchenaccounts.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportCustomerCollection = catchAsync(async (req, res) => {
  const { type } = req.query;
  if (type !== 'raw') {
    const result = await userService.exportCustomerCollection(req.query);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Customers');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Role', key: 'role' },
        { header: 'Image', key: 'image' },
        { header: 'Order Count', key: 'orderCount' },
        { header: 'Total Grand Total', key: 'totalGrandTotal' },
        { header: 'Joining Date', key: 'createdAt' },
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
        Role: detail.role,
        Image: detail.image,
        'Order Count': detail.orderCount,
        'Total Grand Total': detail.totalGrandTotal,
        'Joining Date': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportRawCustomerCollection(req.query);
    const downloadPath = path.join(__dirname, `../templates/downloads/customers.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'customers.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportCustomerFundCollection = catchAsync(async (req, res) => {
  const { type, query } = req.params;
  if (type !== 'raw') {
    const result = await userService.exportCustomerFundCollection(query);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        walletUUID:
          detail &&
          detail.wallets &&
          detail.wallets.uuid &&
          detail.wallets.uuid !== null &&
          detail.wallets.uuid !== ''
            ? detail.wallets.uuid
            : '-',
        walletBalance:
          detail &&
          detail.wallets &&
          detail.wallets.balance &&
          detail.wallets.balance !== null &&
          detail.wallets.balance !== ''
            ? detail.wallets.balance
            : 0,
        walletId:
          detail &&
          detail.wallets &&
          detail.wallets.id &&
          detail.wallets.id !== null &&
          detail.wallets.id !== ''
            ? detail.wallets.id
            : '-',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('CustomerWalletFunds');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Image', key: 'image' },
        { header: 'Wallet UUID', key: 'walletUUID' },
        { header: 'Wallet Id', key: 'walletId' },
        { header: 'Wallet Balance', key: 'walletBalance' },
        { header: 'Order Count', key: 'orderCount' },
        { header: 'Total Grand Total', key: 'totalGrandTotal' },
        { header: 'Loyalty Points', key: 'loyaltyPoints' },
        { header: 'Joining Date', key: 'createdAt' },
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
        'Wallet UUID':
          detail &&
          detail.wallets &&
          detail.wallets.uuid &&
          detail.wallets.uuid !== null &&
          detail.wallets.uuid !== ''
            ? detail.wallets.uuid
            : '-',
        'Wallet Id':
          detail &&
          detail.wallets &&
          detail.wallets.id &&
          detail.wallets.id !== null &&
          detail.wallets.id !== ''
            ? detail.wallets.id
            : '-',
        'Wallet Balance':
          detail &&
          detail.wallets &&
          detail.wallets.balance &&
          detail.wallets.balance !== null &&
          detail.wallets.balance !== ''
            ? detail.wallets.balance
            : 0,
        'Order Count': detail.orderCount,
        'Total Grand Total': detail.totalGrandTotal,
        'Loyalty Points': detail.loyaltyPoints,
        'Joining Date': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userService.exportRawCustomerFundCollection(query);
    const downloadPath = path.join(__dirname, `../templates/downloads/customerwalletfunds.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'customerwalletfunds.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportRawCustomerReportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['kind', 'search']);
  const { type } = req.query;
  const result = await userService.exportCustomerReportCollection(options);
  if (type === 'excel') {
    const mappedResult = result.map((detail, index) => ({
      ...detail,
      serial: index + 1,
      walletUUID:
        detail &&
        detail.wallets &&
        detail.wallets.uuid &&
        detail.wallets.uuid !== null &&
        detail.wallets.uuid !== ''
          ? detail.wallets.uuid
          : '-',
      walletId:
        detail &&
        detail.wallets &&
        detail.wallets.id &&
        detail.wallets.id !== null &&
        detail.wallets.id !== ''
          ? detail.wallets.id
          : '-',
      walletBalance:
        detail &&
        detail.wallets &&
        detail.wallets.balance &&
        detail.wallets.balance !== null &&
        detail.wallets.balance !== ''
          ? detail.wallets.balance
          : 0,
      createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('UserReport');
    worksheet.columns = [
      { header: 'S. No.', key: 'serial' },
      { header: 'Id', key: 'id' },
      { header: 'First Name', key: 'firstName' },
      { header: 'Last Name', key: 'lastName' },
      { header: 'Email', key: 'email' },
      { header: 'Country Code', key: 'countryCode' },
      { header: 'Mobile', key: 'mobile' },
      { header: 'Role', key: 'role' },
      { header: 'Wallet UUID', key: 'walletUUID' },
      { header: 'Wallet Id', key: 'walletId' },
      { header: 'Wallet Balance', key: 'walletBalance' },
      { header: 'Order Count', key: 'orderCount' },
      { header: 'Order Refund', key: 'orderRefund' },
      { header: 'Order Grand Total', key: 'orderGrandTotal' },
      { header: 'Favourite Orders', key: 'favOrders' },
      { header: 'Dining Bookings', key: 'diningBookings' },
      { header: 'Tiffin Packages', key: 'tiffinPackages' },
      { header: 'Favourite Restaurants', key: 'favRest' },
      { header: 'Favourite Foods', key: 'favFood' },
      { header: 'Media', key: 'medias' },
      { header: 'Dining Refund', key: 'diningRefund' },
      { header: 'Tiffin Refund', key: 'tiffinRefund' },
      { header: 'Hidden Restaurant', key: 'hiddenRest' },
      { header: 'Dining Grand Total', key: 'diningGrandTotal' },
      { header: 'Tiffin Package Grand Total', key: 'tiffinPackageGrandTotal' },
      { header: 'Loyalty Points', key: 'loyaltyPoints' },
      { header: 'Joining Date', key: 'createdAt' },
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
      Role: detail.role,
      'Wallet UUID':
        detail &&
        detail.wallets &&
        detail.wallets.uuid &&
        detail.wallets.uuid !== null &&
        detail.wallets.uuid !== ''
          ? detail.wallets.uuid
          : '-',
      'Wallet Id':
        detail &&
        detail.wallets &&
        detail.wallets.id &&
        detail.wallets.id !== null &&
        detail.wallets.id !== ''
          ? detail.wallets.id
          : '-',
      'Wallet Balance':
        detail &&
        detail.wallets &&
        detail.wallets.balance &&
        detail.wallets.balance !== null &&
        detail.wallets.balance !== ''
          ? detail.wallets.balance
          : 0,
      'Order Count': detail.orderCount,
      'Order Refund': detail.orderRefund,
      'Order Grand Total': detail.orderGrandTotal,
      'Favourite Orders': detail.favOrders,
      'Dining Bookings': detail.diningBookings,
      'Tiffin Packages': detail.tiffinPackages,
      'Favourite Restaurants': detail.favRest,
      'Favourite Foods': detail.favFood,
      Media: detail.medias,
      'Dining Refund': detail.diningRefund,
      'Tiffin Refund': detail.tiffinRefund,
      'Hidden Restaurant': detail.hiddenRest,
      'Dining Grand Total': detail.diningGrandTotal,
      'Tiffin Package Grand Total': detail.tiffinPackageGrandTotal,
      'Loyalty Points': detail.loyaltyPoints,
      'Joining Date': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const csv = Papa.unparse(fieldItems);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
    res.send(csv);
  }
});

/**
 * The one directory import templates may be served from.
 *
 * Resolved once at module load so every request is checked against the same
 * absolute path, rather than re-deriving a relative one per request.
 */
const IMPORT_TEMPLATE_ROOT = path.resolve(__dirname, '..', 'templates', 'import_collection');

const downloadImportFile = catchAsync(async (req, res) => {
  try {
    const { link } = req.query;

    if (typeof link !== 'string' || !link.trim()) {
      return res.status(400).json({ success: false, message: 'A template link is required', extra: '' });
    }

    // Confine the download to the template directory.
    //
    // `link` arrives from the query string and was previously joined straight onto
    // the template path, so `?link=../../../../package.json` — or `../../.env` —
    // served any file the process could read, including the database URL and the
    // JWT secrets. Resolving first and then checking containment closes that.
    const downloadPath = path.resolve(IMPORT_TEMPLATE_ROOT, link);
    const insideRoot = downloadPath.startsWith(IMPORT_TEMPLATE_ROOT + path.sep);

    if (!insideRoot || !fs.existsSync(downloadPath) || !fs.statSync(downloadPath).isFile()) {
      return res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }

    return res.download(downloadPath);
  } catch (error) {
    return res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

const importCollection = catchAsync(async (req, res) => {
  try {
    const upload = uploadMiddleware('local');
    upload.single('file')(req, res, async (err) => {
      if (!err) {
        if (req.file) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const { file } = req;
          if (req.body.type === 'excel' && ext === '.xlsx') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file.path);
            const worksheet = workbook.worksheets[0];
            const records = [];
            const headerRow = worksheet.getRow(1).values.slice(1);
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;

              const rowValues = row.values.slice(1);
              const obj = {};
              headerRow.forEach((header, index) => {
                obj[header] = rowValues[index];
              });

              records.push(obj);
            });
            fs.unlinkSync(file.path);
            const importKeys = [...new Set(records.flatMap(Object.keys))];
            const validSchema =
              importKeys.length === customerSchemaKeys.length &&
              importKeys.every((item) => customerSchemaKeys.includes(item));
            if (validSchema) {
              const result = await userService.importCollection(records);
              res.send(result);
            } else {
              res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
            }
          } else if (req.body.type === 'csv' && ext === '.csv') {
            const fileStream = fs.createReadStream(file.path);
            Papa.parse(fileStream, {
              header: true,
              skipEmptyLines: true,
              complete: async (results) => {
                try {
                  const records = results.data;
                  fs.unlinkSync(file.path);
                  const importKeys = [...new Set(records.flatMap(Object.keys))];
                  const validSchema =
                    importKeys.length === customerSchemaKeys.length &&
                    importKeys.every((item) => customerSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await userService.importCollection(records);
                    res.send(result);
                  } else {
                    res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
                  }
                } catch (papaError) {
                  fs.unlinkSync(file.path);
                  res
                    .status(
                      papaError.statusCode ? papaError.statusCode : httpStatus.INTERNAL_SERVER_ERROR
                    )
                    .send({ code: 400, message: papaError.message, extra: '' });
                }
              },
              error: () => {
                fs.unlinkSync(file.path);
                res.status(500).json({ code: 500, message: 'Failed to parse CSV', extra: '' });
              },
            });
          } else {
            fs.unlinkSync(file.path);
            res.status(400).send({ code: 400, message: 'Invalid file type', extra: '' });
          }
        } else {
          res
            .status(400)
            .send({ code: 400, message: 'Please select a file to upload!', extra: '' });
        }
      } else if (err instanceof multer.MulterError) {
        let { error } = err;
        if (err.code === 'LIMIT_FILE_SIZE') {
          error = `Maximum file size is ##dynamic## MB`;
        }
        const sizeCount = config.file.maxUploadSize / (1024 * 1024);
        res.status(400).send({ code: 400, message: error, extra: sizeCount });
      } else {
        res
          .status(err.statusCode ? err.statusCode : httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: err.message, extra: '' });
      }
    });
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

const importAuthRoleCollection = catchAsync(async (req, res) => {
  try {
    const upload = uploadMiddleware('local');
    upload.single('file')(req, res, async (err) => {
      if (!err) {
        if (req.file) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const { file } = req;
          if (req.body.type === 'excel' && ext === '.xlsx') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file.path);
            const worksheet = workbook.worksheets[0];
            const records = [];
            const headerRow = worksheet.getRow(1).values.slice(1);
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;

              const rowValues = row.values.slice(1);
              const obj = {};
              headerRow.forEach((header, index) => {
                obj[header] = rowValues[index];
              });

              records.push(obj);
            });
            fs.unlinkSync(file.path);
            const importKeys = [...new Set(records.flatMap(Object.keys))];
            const validSchema =
              importKeys.length === authRoleSchemaKeys.length &&
              importKeys.every((item) => authRoleSchemaKeys.includes(item));
            if (validSchema) {
              const { role } = req.query;
              const result = await userService.importAuthRolesCollection(records, role);
              res.send(result);
            } else {
              res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
            }
          } else if (req.body.type === 'csv' && ext === '.csv') {
            const fileStream = fs.createReadStream(file.path);
            Papa.parse(fileStream, {
              header: true,
              skipEmptyLines: true,
              complete: async (results) => {
                try {
                  const records = results.data;
                  fs.unlinkSync(file.path);
                  const importKeys = [...new Set(records.flatMap(Object.keys))];
                  const validSchema =
                    importKeys.length === authRoleSchemaKeys.length &&
                    importKeys.every((item) => authRoleSchemaKeys.includes(item));
                  if (validSchema) {
                    const { role } = req.query;
                    const result = await userService.importAuthRolesCollection(records, role);
                    res.send(result);
                  } else {
                    res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
                  }
                } catch (papaError) {
                  fs.unlinkSync(file.path);
                  res
                    .status(
                      papaError.statusCode ? papaError.statusCode : httpStatus.INTERNAL_SERVER_ERROR
                    )
                    .send({ code: 400, message: papaError.message, extra: '' });
                }
              },
              error: () => {
                fs.unlinkSync(file.path);
                res.status(500).json({ code: 500, message: 'Failed to parse CSV', extra: '' });
              },
            });
          } else {
            fs.unlinkSync(file.path);
            res.status(400).send({ code: 400, message: 'Invalid file type', extra: '' });
          }
        } else {
          res
            .status(400)
            .send({ code: 400, message: 'Please select a file to upload!', extra: '' });
        }
      } else if (err instanceof multer.MulterError) {
        let { error } = err;
        if (err.code === 'LIMIT_FILE_SIZE') {
          error = `Maximum file size is ##dynamic## MB`;
        }
        const sizeCount = config.file.maxUploadSize / (1024 * 1024);
        res.status(400).send({ code: 400, message: error, extra: sizeCount });
      } else {
        res
          .status(err.statusCode ? err.statusCode : httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: err.message, extra: '' });
      }
    });
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

const importCustomerWalletFundCollection = catchAsync(async (req, res) => {
  try {
    const upload = uploadMiddleware('local');
    upload.single('file')(req, res, async (err) => {
      if (!err) {
        if (req.file) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const { file } = req;
          if (req.body.type === 'excel' && ext === '.xlsx') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file.path);
            const worksheet = workbook.worksheets[0];
            const records = [];
            const headerRow = worksheet.getRow(1).values.slice(1);
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;

              const rowValues = row.values.slice(1);
              const obj = {};
              headerRow.forEach((header, index) => {
                obj[header] = rowValues[index];
              });

              records.push(obj);
            });
            fs.unlinkSync(file.path);
            const importKeys = [...new Set(records.flatMap(Object.keys))];
            const validSchema =
              importKeys.length === customerWalletFundSchemaKeys.length &&
              importKeys.every((item) => customerWalletFundSchemaKeys.includes(item));
            if (validSchema) {
              const result = await walletService.importCollection(records);
              res.send(result);
            } else {
              res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
            }
          } else if (req.body.type === 'csv' && ext === '.csv') {
            const fileStream = fs.createReadStream(file.path);
            Papa.parse(fileStream, {
              header: true,
              skipEmptyLines: true,
              complete: async (results) => {
                try {
                  const records = results.data;
                  fs.unlinkSync(file.path);
                  const importKeys = [...new Set(records.flatMap(Object.keys))];
                  const validSchema =
                    importKeys.length === customerWalletFundSchemaKeys.length &&
                    importKeys.every((item) => customerWalletFundSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await walletService.importCollection(records);
                    res.send(result);
                  } else {
                    res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
                  }
                } catch (papaError) {
                  fs.unlinkSync(file.path);
                  res
                    .status(
                      papaError.statusCode ? papaError.statusCode : httpStatus.INTERNAL_SERVER_ERROR
                    )
                    .send({ code: 400, message: papaError.message, extra: '' });
                }
              },
              error: () => {
                fs.unlinkSync(file.path);
                res.status(500).json({ code: 500, message: 'Failed to parse CSV', extra: '' });
              },
            });
          } else {
            fs.unlinkSync(file.path);
            res.status(400).send({ code: 400, message: 'Invalid file type', extra: '' });
          }
        } else {
          res
            .status(400)
            .send({ code: 400, message: 'Please select a file to upload!', extra: '' });
        }
      } else if (err instanceof multer.MulterError) {
        let { error } = err;
        if (err.code === 'LIMIT_FILE_SIZE') {
          error = `Maximum file size is ##dynamic## MB`;
        }
        const sizeCount = config.file.maxUploadSize / (1024 * 1024);
        res.status(400).send({ code: 400, message: error, extra: sizeCount });
      } else {
        res
          .status(err.statusCode ? err.statusCode : httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: err.message, extra: '' });
      }
    });
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

const importDeliverymanWalletFundCollection = catchAsync(async (req, res) => {
  try {
    const upload = uploadMiddleware('local');
    upload.single('file')(req, res, async (err) => {
      if (!err) {
        if (req.file) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const { file } = req;
          if (req.body.type === 'excel' && ext === '.xlsx') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file.path);
            const worksheet = workbook.worksheets[0];
            const records = [];
            const headerRow = worksheet.getRow(1).values.slice(1);
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;

              const rowValues = row.values.slice(1);
              const obj = {};
              headerRow.forEach((header, index) => {
                obj[header] = rowValues[index];
              });

              records.push(obj);
            });
            fs.unlinkSync(file.path);
            const importKeys = [...new Set(records.flatMap(Object.keys))];
            const validSchema =
              importKeys.length === deliverymanWalletFundSchemaKeys.length &&
              importKeys.every((item) => deliverymanWalletFundSchemaKeys.includes(item));
            if (validSchema) {
              const result = await walletService.importDeliverymanWalletFundCollection(records);
              res.send(result);
            } else {
              res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
            }
          } else if (req.body.type === 'csv' && ext === '.csv') {
            const fileStream = fs.createReadStream(file.path);
            Papa.parse(fileStream, {
              header: true,
              skipEmptyLines: true,
              complete: async (results) => {
                try {
                  const records = results.data;
                  fs.unlinkSync(file.path);
                  const importKeys = [...new Set(records.flatMap(Object.keys))];
                  const validSchema =
                    importKeys.length === deliverymanWalletFundSchemaKeys.length &&
                    importKeys.every((item) => deliverymanWalletFundSchemaKeys.includes(item));
                  if (validSchema) {
                    const result =
                      await walletService.importDeliverymanWalletFundCollection(records);
                    res.send(result);
                  } else {
                    res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
                  }
                } catch (papaError) {
                  fs.unlinkSync(file.path);
                  res
                    .status(
                      papaError.statusCode ? papaError.statusCode : httpStatus.INTERNAL_SERVER_ERROR
                    )
                    .send({ code: 400, message: papaError.message, extra: '' });
                }
              },
              error: () => {
                fs.unlinkSync(file.path);
                res.status(500).json({ code: 500, message: 'Failed to parse CSV', extra: '' });
              },
            });
          } else {
            fs.unlinkSync(file.path);
            res.status(400).send({ code: 400, message: 'Invalid file type', extra: '' });
          }
        } else {
          res
            .status(400)
            .send({ code: 400, message: 'Please select a file to upload!', extra: '' });
        }
      } else if (err instanceof multer.MulterError) {
        let { error } = err;
        if (err.code === 'LIMIT_FILE_SIZE') {
          error = `Maximum file size is ##dynamic## MB`;
        }
        const sizeCount = config.file.maxUploadSize / (1024 * 1024);
        res.status(400).send({ code: 400, message: error, extra: sizeCount });
      } else {
        res
          .status(err.statusCode ? err.statusCode : httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: err.message, extra: '' });
      }
    });
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

const updateUserLocale = catchAsync(async (req, res) => {
  const { id, locale } = req.body;
  const result = await userService.updateUserLocale(id, locale);
  res.send(result);
});

module.exports = {
  createUser,
  getUser,
  updateUser,
  deleteUser,
  findUserWithName,
  getMyDriverProfile,
  updateDeliverymanProfile,
  getMyReferralCode,
  callCustomer,
  customerList,
  updateStatus,
  customerWalletFundList,
  customerReport,
  customerDetail,
  adminCreateCustomer,
  adminPosCustomerDetail,
  adminProfile,
  accountantProfile,
  supportTeamProfile,
  cityMasterTeamProfile,
  supportTeamCustomerDetail,
  cityzenCreateCustomer,
  getAdminProfile,
  getAccountantProfile,
  getVendorProfile,
  getSupportTeamProfile,
  getCityzenProfile,
  updateAdminProfile,
  updateAccountantProfile,
  updateVendorProfile,
  updateSupportTeamProfile,
  updateCityzenProfile,
  updateAdminPassword,
  updateAccountantPassword,
  updateVendorPassword,
  updateSupportTeamPassword,
  updateCityzenPassword,
  updatePassword,
  updateEmail,
  updateEmailAfterVerification,
  updateMobileNumber,
  updateMobileAfterVerification,
  updateMobileAfterFirebaseVerification,
  deleteUserAccount,
  customerDeletedAccount,
  restaurantDeleteAccount,
  restaurantDeletedAccount,
  deliverymanDeleteAccount,
  deliverymanDeletedAccount,
  waiterDeleteAccount,
  waiterDeletedAccount,
  kitchenOwnerProfile,
  updateKitchenOwnerProfile,
  kitchenDeleteAccount,
  kitchenDeletedAccount,
  adminUserContactDetail,
  exportCollectionCustomerDeletedAccounts,
  exportCollectionRestaurantDeletedAccounts,
  exportCollectionDeliverymanDeletedAccounts,
  exportCollectionWaiterDeletedAccounts,
  exportCollectionKitchenOwnerDeletedAccounts,
  exportCustomerCollection,
  exportCustomerFundCollection,
  exportRawCustomerReportCollection,
  downloadImportFile,
  importCollection,
  importAuthRoleCollection,
  importCustomerWalletFundCollection,
  importDeliverymanWalletFundCollection,
  updateUserLocale,
};

