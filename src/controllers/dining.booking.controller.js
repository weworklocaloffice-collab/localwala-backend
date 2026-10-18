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

const { status: httpStatus } = require('http-status');
const multer = require('multer');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const { chromium } = require('playwright');
const Handlebars = require('handlebars');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const {
  diningBookingService,
  paymentInitiationService,
  fcmNotificationService,
} = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { diningBookingSchemaKeys } = require('../utils/importCollectionSchema');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const apiLocaleTranslations = require('../utils/translate');

const createBooking = catchAsync(async (req, res) => {
  const result = await diningBookingService.createBooking(req.body);
  if (result && result.id !== null && result.total > 0) {
    const paymentMeta = {
      user: req.body.user,
      payment: req.body.payment,
      booking: result.id,
      amount: result.total,
      ref: `booking for #${result.id}`,
      from: 'booking',
    };
    const paymentLink = await paymentInitiationService.initiatePayment(paymentMeta);
    if (paymentLink !== null && paymentLink.id !== '') {
      res
        .status(201)
        .send({ id: result.id, success: true, status: 'online', payLink: paymentLink.id });
    } else {
      res.status(400).send({
        code: 400,
        message: 'Something went wrong, please contact administrator',
        extra: '',
      });
    }
  } else {
    await fcmNotificationService.restaurantNewBooking(
      result.id,
      req.body.restaurant,
      req.body.user,
      req.body.userName
    );
    res.status(201).send({ id: result.id, success: true, status: 'offline', payLink: '' });
  }
});

const getDiningBookingWithUserId = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await diningBookingService.getDiningBookingWithUserId(req.body.uid, options);
  res.send(result);
});

const searchDiningBooking = catchAsync(async (req, res) => {
  const { uid, query } = req.params;
  const result = await diningBookingService.searchDiningBooking(uid, query);
  res.send(result);
});

const getUserDiningBookingInformation = catchAsync(async (req, res) => {
  const { uid, booking } = req.body;
  const result = await diningBookingService.getUserDiningBookingInformation(uid, booking);
  res.send(result);
});

const repayPendingBooking = catchAsync(async (req, res) => {
  const result = await paymentInitiationService.deleteBookingPaymentIntentForRePayment(
    req.body.bookingId,
    req.body.userId,
    req.body.payMethod
  );
  if (result !== null && result.user !== null) {
    const paymentMeta = {
      user: req.body.userId,
      payment: req.body.newPayMethod,
      booking: req.body.bookingId,
      amount: result.amount,
      ref: `booking for #${req.body.bookingId}`,
      from: 'booking',
    };
    const paymentLink = await paymentInitiationService.initiatePayment(paymentMeta);
    if (paymentLink !== null && paymentLink.id !== '') {
      await diningBookingService.updateBookingPayment(req.body.bookingId, {
        payment: req.body.newPayMethod,
      });
      res
        .status(201)
        .send({ id: req.body.bookingId, success: true, status: 'online', payLink: paymentLink.id });
    } else {
      res.status(400).send({
        code: 400,
        message: 'Something went wrong, please contact administrator',
        extra: '',
      });
    }
  } else {
    res.status(400).send({
      code: 400,
      message: 'Something went wrong, please contact administrator',
      extra: '',
    });
  }
});

const cancelMyDiningBooking = catchAsync(async (req, res) => {
  const result = await diningBookingService.cancelDiningBookingByUser(
    req.body.bookingId,
    req.body.reasonId
  );
  if (
    result !== null &&
    result.user !== null &&
    result.restaurant !== null &&
    result.status === 'cancelled'
  ) {
    await fcmNotificationService.userCancelDiningBooking(
      result.id,
      result.restaurant,
      result.user,
      result.userName
    );
  }
  res.send({ success: true });
});

const adminDiningBookingCount = catchAsync(async (req, res) => {
  const result = await diningBookingService.adminDiningBookingCount();
  res.send(result);
});

const cityzenDiningBookingCount = catchAsync(async (req, res) => {
  const { master } = req.params;
  const result = await diningBookingService.cityzenDiningBookingCount(master);
  res.send(result);
});

const adminDiningBookingList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'status', 'search']);
  const result = await diningBookingService.adminDiningBookingList(options);
  res.send(result);
});

const cityzenDiningBookingList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await diningBookingService.cityzenDiningBookingList(
    master,
    req.query.status,
    options
  );
  res.send(result);
});

const getVendorDiningBookingList = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await diningBookingService.getVendorDiningBookingList(
    req.body.vendor,
    req.body.status,
    options
  );
  res.send(result);
});

const acceptDiningBooking = catchAsync(async (req, res) => {
  const { bookingId, vendorId } = req.body;
  const result = await diningBookingService.acceptDiningBooking(bookingId, vendorId);
  if (result !== null && result.status !== null && result.status !== '') {
    await fcmNotificationService.acceptDiningBookingRequest(bookingId, result.user, vendorId);
  }
  res.send({ success: true });
});

const rejectDiningBooking = catchAsync(async (req, res) => {
  const { bookingId, vendorId, reasonId } = req.body;
  const result = await diningBookingService.rejectDiningBooking(bookingId, vendorId, reasonId);
  if (result !== null && result.status !== null && result.status !== '') {
    await fcmNotificationService.rejectDiningBookingRequest(bookingId, vendorId, result.user);
  }
  res.send({ success: true });
});

const completeDiningBooking = catchAsync(async (req, res) => {
  const { bookingId, vendorId, itemTotal, itemDiscount, couponDiscount, billTotal } = req.body;
  const result = await diningBookingService.completeDiningBooking(
    bookingId,
    vendorId,
    itemTotal,
    itemDiscount,
    couponDiscount,
    billTotal
  );
  if (result !== null && result.status !== null && result.status !== '') {
    await fcmNotificationService.completeDiningBookingRequest(bookingId, vendorId, result.user);
  }
  res.send({ success: true });
});

const getDiningBookingInformation = catchAsync(async (req, res) => {
  const { bookingId, vendorId } = req.params;
  const results = await diningBookingService.getDiningBookingInformation(bookingId, vendorId);
  res.send(results);
});

const callBookingCustomer = catchAsync(async (req, res) => {
  const { bookingId, vendorId } = req.params;
  const results = await diningBookingService.callBookingCustomer(bookingId, vendorId);
  res.send(results);
});

const getVendorWebDiningBookingList = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await diningBookingService.getVendorWebDiningBookingList(
    req.body.vendor,
    req.body.status,
    options
  );
  res.send(result);
});

const getDiningBookingInfoAdmin = catchAsync(async (req, res) => {
  const { bookingId } = req.params;
  const result = await diningBookingService.getDiningBookingInfoAdmin(bookingId);
  res.send(result);
});

const diningBookingReport = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'restaurant',
    'filter',
    'filterDates',
    'search',
    'limit',
    'page',
  ]);
  const result = await diningBookingService.diningBookingReport(options);
  res.send(result);
});

const customerDiningBooking = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await diningBookingService.customerDiningBooking(options);
  res.send(result);
});

const vendorBookingList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await diningBookingService.vendorBookingList(options);
  res.send(result);
});

const couponBooking = catchAsync(async (req, res) => {
  const { id } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await diningBookingService.couponBooking(id, options);
  res.send(result);
});

const supportTeamBookingDetail = catchAsync(async (req, res) => {
  const { bookingId } = req.params;
  const result = await diningBookingService.supportTeamBookingDetail(bookingId);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, status, search } = req.query;
  if (type !== 'raw') {
    const result = await diningBookingService.exportCollection(status, search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        bookingDate: DateTime.fromISO(detail.bookingDate).toFormat('dd LLL yyyy'),
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
        coupon:
          detail && detail.coupon && detail.coupon !== null && detail.coupon !== '' ? 'Yes' : 'No',
        campaign:
          detail && detail.campaign && detail.campaign !== null && detail.campaign !== ''
            ? 'Yes'
            : 'No',
        userId:
          detail &&
          detail.userInfo &&
          detail.userInfo.id &&
          detail.userInfo.id !== null &&
          detail.userInfo.id !== ''
            ? detail.userInfo.id
            : '-',
        userFirstLast:
          detail &&
          detail.userInfo &&
          detail.userInfo.firstName &&
          detail.userInfo.firstName !== null &&
          detail.userInfo.firstName !== ''
            ? detail.userInfo.firstName
            : '-',
        userLastName:
          detail &&
          detail.userInfo &&
          detail.userInfo.lastName &&
          detail.userInfo.lastName !== null &&
          detail.userInfo.lastName !== ''
            ? detail.userInfo.lastName
            : '-',
        paymentId:
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.id &&
          detail.paymentInfo.id !== null &&
          detail.paymentInfo.id !== ''
            ? detail.paymentInfo.id
            : '-',
        paymentName:
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.name &&
          detail.paymentInfo.name !== null &&
          detail.paymentInfo.name !== ''
            ? detail.paymentInfo.name
            : '-',
        paymentWay:
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.paymentWay &&
          detail.paymentInfo.paymentWay !== null &&
          detail.paymentInfo.paymentWay !== ''
            ? detail.paymentInfo.paymentWay
            : '-',
        cancelReasonId:
          detail &&
          detail.cancelReason &&
          detail.cancelReason.id &&
          detail.cancelReason.id !== null &&
          detail.cancelReason.id !== ''
            ? detail.cancelReason.id
            : '-',
        cancelReasonName:
          detail &&
          detail.cancelReason &&
          detail.cancelReason.name &&
          detail.cancelReason.name !== null &&
          detail.cancelReason.name !== ''
            ? detail.cancelReason.name
            : '-',
        diningItemDiscountAmount:
          detail && detail.diningItemDiscountAmount && detail.diningItemDiscountAmount !== null
            ? detail.diningItemDiscountAmount
            : 0,
        specialRequest:
          detail &&
          detail.specialRequest &&
          detail.specialRequest !== null &&
          detail.specialRequest !== ''
            ? detail.specialRequest
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('DiningBooking');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'User Id', key: 'userId' },
        { header: 'User First Name', key: 'userFirstLast' },
        { header: 'User Last Name', key: 'userLastName' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Booking Date', key: 'bookingDate' },
        { header: 'Booking Slot', key: 'bookingSlot' },
        { header: 'Guest', key: 'guest' },
        { header: 'Customer Name', key: 'userName' },
        { header: 'Customer Country Code', key: 'userCountryCode' },
        { header: 'Customer Mobile', key: 'userContact' },
        { header: 'Customer Email', key: 'userEmail' },
        { header: 'Special Request', key: 'specialRequest' },
        { header: 'Coupon Used', key: 'coupon' },
        { header: 'Campaign', key: 'campaign' },
        { header: 'Payment Id', key: 'paymentId' },
        { header: 'Payment Name', key: 'paymentName' },
        { header: 'Payment Way', key: 'paymentWay' },
        { header: 'Payment Mode', key: 'paymentMode' },
        { header: 'Cancel Reason Id', key: 'cancelReasonId' },
        { header: 'Cancel Reason Name', key: 'cancelReasonName' },
        { header: 'Grand Total', key: 'grandTotal' },
        { header: 'Pre Booking Charge', key: 'preBookingCharge' },
        { header: 'Coupon Cover Charge', key: 'couponCoverCharge' },
        { header: 'Booking Commission', key: 'bookingCommission' },
        { header: 'Dining Item Total Amount', key: 'diningItemTotalAmount' },
        { header: 'Dining Item Discount Amount', key: 'diningItemDiscountAmount' },
        { header: 'Dining Coupon Discount Amount', key: 'diningCouponDiscountAmount' },
        { header: 'Dining Grand Total Bill Amount', key: 'diningGrandTotalBillAmount' },
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
        'User Id':
          detail &&
          detail.userInfo &&
          detail.userInfo.id &&
          detail.userInfo.id !== null &&
          detail.userInfo.id !== ''
            ? detail.userInfo.id
            : '-',
        'User First Name':
          detail &&
          detail.userInfo &&
          detail.userInfo.firstName &&
          detail.userInfo.firstName !== null &&
          detail.userInfo.firstName !== ''
            ? detail.userInfo.firstName
            : '-',
        'User Last Name':
          detail &&
          detail.userInfo &&
          detail.userInfo.lastName &&
          detail.userInfo.lastName !== null &&
          detail.userInfo.lastName !== ''
            ? detail.userInfo.lastName
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
        'Booking Date': DateTime.fromISO(detail.bookingDate).toFormat('dd LLL yyyy'),
        'Booking Slot': detail.bookingSlot,
        Guest: detail.guest,
        'Customer Name': detail.userName,
        'Customer Country Code': detail.userCountryCode,
        'Customer Mobile': detail.userContact,
        'Customer Email': detail.userEmail,
        'Special Request':
          detail &&
          detail.specialRequest &&
          detail.specialRequest !== null &&
          detail.specialRequest !== ''
            ? detail.specialRequest
            : '-',
        'Coupon Used':
          detail && detail.coupon && detail.coupon !== null && detail.coupon !== '' ? 'Yes' : 'No',
        Campaign:
          detail && detail.campaign && detail.campaign !== null && detail.campaign !== ''
            ? 'Yes'
            : 'No',
        'Payment Id':
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.id &&
          detail.paymentInfo.id !== null &&
          detail.paymentInfo.id !== ''
            ? detail.paymentInfo.id
            : '-',
        'Payment Name':
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.name &&
          detail.paymentInfo.name !== null &&
          detail.paymentInfo.name !== ''
            ? detail.paymentInfo.name
            : '-',
        'Payment Way':
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.paymentWay &&
          detail.paymentInfo.paymentWay !== null &&
          detail.paymentInfo.paymentWay !== ''
            ? detail.paymentInfo.paymentWay
            : '-',
        'Payment Mode': detail.paymentMode,
        'Cancel Reason Id':
          detail &&
          detail.cancelReason &&
          detail.cancelReason.id &&
          detail.cancelReason.id !== null &&
          detail.cancelReason.id !== ''
            ? detail.cancelReason.id
            : '-',
        'Cancel Reason Name':
          detail &&
          detail.cancelReason &&
          detail.cancelReason.name &&
          detail.cancelReason.name !== null &&
          detail.cancelReason.name !== ''
            ? detail.cancelReason.name
            : '-',
        'Grand Total': detail.grandTotal,
        'Pre Booking Charge': detail.preBookingCharge,
        'Coupon Cover Charge': detail.couponCoverCharge,
        'Booking Commission': detail.bookingCommission,
        'Dining Item Total Amount': detail.diningItemTotalAmount,
        'Dining Item Discount Amount':
          detail && detail.diningItemDiscountAmount && detail.diningItemDiscountAmount !== null
            ? detail.diningItemDiscountAmount
            : 0,
        'Dining Coupon Discount Amount': detail.diningCouponDiscountAmount,
        'Dining Grand Total Bill Amount': detail.diningGrandTotalBillAmount,
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await diningBookingService.exportRawCollection(status, search);
    const downloadPath = path.join(__dirname, `../templates/downloads/diningbookings.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'diningbookings.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportReportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'filter', 'filterDates', 'search']);
  const { type } = req.query;
  const result = await diningBookingService.exportReportCollection(options);
  if (type === 'excel') {
    const mappedResult = result.map((detail, index) => ({
      ...detail,
      serial: index + 1,
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
      paymentId:
        detail &&
        detail.paymentInfo &&
        detail.paymentInfo.id &&
        detail.paymentInfo.id !== null &&
        detail.paymentInfo.id !== ''
          ? detail.paymentInfo.id
          : '-',
      paymentName:
        detail &&
        detail.paymentInfo &&
        detail.paymentInfo.name &&
        detail.paymentInfo.name !== null &&
        detail.paymentInfo.name !== ''
          ? detail.paymentInfo.name
          : '-',
      paymentWay:
        detail &&
        detail.paymentInfo &&
        detail.paymentInfo.paymentWay &&
        detail.paymentInfo.paymentWay !== null &&
        detail.paymentInfo.paymentWay !== ''
          ? detail.paymentInfo.paymentWay
          : '-',
      userId:
        detail &&
        detail.userInfo &&
        detail.userInfo.id &&
        detail.userInfo.id !== null &&
        detail.userInfo.id !== ''
          ? detail.userInfo.id
          : '-',
      userFirstName:
        detail &&
        detail.userInfo &&
        detail.userInfo.firstName &&
        detail.userInfo.firstName !== null &&
        detail.userInfo.firstName !== ''
          ? detail.userInfo.firstName
          : '-',
      userLastName:
        detail &&
        detail.userInfo &&
        detail.userInfo.lastName &&
        detail.userInfo.lastName !== null &&
        detail.userInfo.lastName !== ''
          ? detail.userInfo.lastName
          : '-',
      userRole:
        detail &&
        detail.userInfo &&
        detail.userInfo.role &&
        detail.userInfo.role !== null &&
        detail.userInfo.role !== ''
          ? detail.userInfo.role
          : '-',
      coupon:
        detail && detail.coupon && detail.coupon !== null && detail.coupon !== ''
          ? detail.coupon
          : '-',
      campaign:
        detail && detail.campaign && detail.campaign !== null && detail.campaign !== ''
          ? detail.campaign
          : '-',
      createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      bookingDate: DateTime.fromISO(detail.bookingDate).toFormat('dd LLL yyyy'),
    }));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('DiningBookingReport');
    worksheet.columns = [
      { header: 'S. No.', key: 'serial' },
      { header: 'Id', key: 'id' },
      { header: 'User Id', key: 'userId' },
      { header: 'User FirstName', key: 'userFirstName' },
      { header: 'User LastName', key: 'userLastName' },
      { header: 'User Role', key: 'userRole' },
      { header: 'Restaurant Id', key: 'restaurantId' },
      { header: 'Restaurant Name', key: 'restaurantName' },
      { header: 'Payment Id', key: 'paymentId' },
      { header: 'Payment Name', key: 'paymentName' },
      { header: 'Payment Way', key: 'paymentWay' },
      { header: 'Payment Mode', key: 'paymentMode' },
      { header: 'Coupon', key: 'coupon' },
      { header: 'Campaign', key: 'campaign' },
      { header: 'Booking Date', key: 'bookingDate' },
      { header: 'Booking Slot', key: 'bookingSlot' },
      { header: 'Dining Item Total Amount', key: 'diningItemTotalAmount' },
      { header: 'Dining Item Discount Amount', key: 'diningItemDiscountAmount' },
      { header: 'Dining Coupon Discount Amount', key: 'diningCouponDiscountAmount' },
      { header: 'Dining Grand Total Bill Amount', key: 'diningGrandTotalBillAmount' },
      { header: 'Pre Booking Charge', key: 'preBookingCharge' },
      { header: 'Coupon Cover Charge', key: 'couponCoverCharge' },
      { header: 'Grand Total', key: 'grandTotal' },
      { header: 'Booking Commission', key: 'bookingCommission' },
      { header: 'Created At', key: 'createdAt' },
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
      'User Id':
        detail &&
        detail.userInfo &&
        detail.userInfo.id &&
        detail.userInfo.id !== null &&
        detail.userInfo.id !== ''
          ? detail.userInfo.id
          : '-',
      'User FirstName':
        detail &&
        detail.userInfo &&
        detail.userInfo.firstName &&
        detail.userInfo.firstName !== null &&
        detail.userInfo.firstName !== ''
          ? detail.userInfo.firstName
          : '-',
      'User LastName':
        detail &&
        detail.userInfo &&
        detail.userInfo.lastName &&
        detail.userInfo.lastName !== null &&
        detail.userInfo.lastName !== ''
          ? detail.userInfo.lastName
          : '-',
      'User Role':
        detail &&
        detail.userInfo &&
        detail.userInfo.role &&
        detail.userInfo.role !== null &&
        detail.userInfo.role !== ''
          ? detail.userInfo.role
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
      'Payment Id':
        detail &&
        detail.paymentInfo &&
        detail.paymentInfo.id &&
        detail.paymentInfo.id !== null &&
        detail.paymentInfo.id !== ''
          ? detail.paymentInfo.id
          : '-',
      'Payment Name':
        detail &&
        detail.paymentInfo &&
        detail.paymentInfo.name &&
        detail.paymentInfo.name !== null &&
        detail.paymentInfo.name !== ''
          ? detail.paymentInfo.name
          : '-',
      'Payment Way':
        detail &&
        detail.paymentInfo &&
        detail.paymentInfo.paymentWay &&
        detail.paymentInfo.paymentWay !== null &&
        detail.paymentInfo.paymentWay !== ''
          ? detail.paymentInfo.paymentWay
          : '-',
      'Payment Mode': detail.paymentMode,
      Coupon:
        detail && detail.coupon && detail.coupon !== null && detail.coupon !== ''
          ? detail.coupon
          : '-',
      Campaign:
        detail && detail.campaign && detail.campaign !== null && detail.campaign !== ''
          ? detail.campaign
          : '-',
      'Booking Date': DateTime.fromISO(detail.bookingDate).toFormat('dd LLL yyyy'),
      'Booking Slot': detail.bookingSlot,
      'Dining Item Total Amount': detail.diningItemTotalAmount,
      'Dining Item Discount Amount': detail.diningItemDiscountAmount,
      'Dining Coupon Discount Amount': detail.diningCouponDiscountAmount,
      'Dining Grand Total Bill Amount': detail.diningGrandTotalBillAmount,
      'Pre Booking Charge': detail.preBookingCharge,
      'Coupon Cover Charge': detail.couponCoverCharge,
      'Grand Total': detail.grandTotal,
      'Booking Commission': detail.bookingCommission,
      'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      Status: detail.status,
    }));
    const csv = Papa.unparse(fieldItems);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
    res.send(csv);
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
              importKeys.length === diningBookingSchemaKeys.length &&
              importKeys.every((item) => diningBookingSchemaKeys.includes(item));
            if (validSchema) {
              const result = await diningBookingService.importCollection(records);
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
                    importKeys.length === diningBookingSchemaKeys.length &&
                    importKeys.every((item) => diningBookingSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await diningBookingService.importCollection(records);
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

const downloadBookingSummary = catchAsync(async (req, res) => {
  try {
    const { id, user, locale } = req.params;
    const result = await diningBookingService.downloadBookingSummary(id, user);
    if (result.success) {
      const guest =
        result && result.details && result.details.guest && result.details.guest !== null
          ? result.details.guest
          : '1';
      const bookingId =
        result && result.details && result.details.id && result.details.id !== null
          ? result.details.id
          : 'Unknown';
      const customerName =
        result && result.details && result.details.userName && result.details.userName !== null
          ? result.details.userName
          : 'Unknown';
      const userContact =
        result &&
        result.details &&
        result.details.userContact &&
        result.details.userContact !== null
          ? `+${result.details.userCountryCode} ${result.details.userContact}`
          : 'Unknown';
      const userEmail =
        result && result.details && result.details.userEmail && result.details.userEmail !== null
          ? result.details.userEmail
          : 'Unknown';
      const dateOfBooking =
        result &&
        result.details &&
        result.details.bookingDate &&
        result.details.bookingDate !== null
          ? DateTime.fromISO(result.details.bookingDate).toFormat('dd LLL yyyy')
          : '15 July 2025';
      const bookingSlot =
        result &&
        result.details &&
        result.details.bookingSlot &&
        result.details.bookingSlot !== null
          ? result.details.bookingSlot
          : '10:00 AM';
      const bookingDateTime = `${dateOfBooking} ${bookingSlot}`;
      let restaurantName = '';
      let restaurantAddress = '';
      let licenseId = '';
      let restaurantLicenseName = '';
      if (result && result.restaurantDetail && result.restaurantDetail !== null) {
        restaurantName = result.restaurantDetail.name;
        restaurantAddress = result.restaurantDetail.address;
        licenseId = result.restaurantDetail.licenseId;
        if (
          result.restaurantDetail.translations &&
          checkArrayNotEmpty(result.restaurantDetail.translations)
        ) {
          const translationIndex = result.restaurantDetail.translations.filter(
            (x) => x.code === locale
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            if (translationIndex[0].title !== '') {
              restaurantName = translationIndex[0].title;
            }
            if (translationIndex[0].address !== '') {
              restaurantAddress = translationIndex[0].address;
            }
          }
        }
        if (
          result &&
          result.restaurantDetail &&
          result.restaurantDetail !== null &&
          result.restaurantDetail.license &&
          result.restaurantDetail.license.name !== ''
        ) {
          restaurantLicenseName = result.restaurantDetail.license.name;
          if (
            result.restaurantDetail.license.translations &&
            checkArrayNotEmpty(result.restaurantDetail.license.translations)
          ) {
            const translationIndex = result.restaurantDetail.license.translations.filter(
              (x) => x.code === locale
            );
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
              if (translationIndex[0].value !== '') {
                restaurantLicenseName = translationIndex[0].value;
              }
            }
          }
        }
      }
      let bookingSummaryKey = 'Dining Booking Summary';
      let bookingIdKey = 'Booking Id';
      let bookingDateTimeKey = 'Scheduled';
      let guestCountKey = 'Number of guests';
      let customerNameKey = 'Customer Name';
      let customerEmailKey = 'Email';
      let customerPhoneKey = 'Phone';
      let restaurantNameKey = 'Restaurant Name';
      let restaurantAddressKey = 'Restaurant Address';
      let licenseKey = 'Lic. No.';
      let direction = 'ltr';
      const wordTranslations = apiLocaleTranslations[locale];
      if (wordTranslations && wordTranslations !== null) {
        direction = wordTranslations.direction;
        const wordLocale = wordTranslations.bookingSummary;
        if (wordLocale && wordLocale !== null) {
          bookingSummaryKey = wordLocale.bookingSummaryKey;
          bookingIdKey = wordLocale.bookingIdKey;
          bookingDateTimeKey = wordLocale.bookingDateTimeKey;
          guestCountKey = wordLocale.guestCountKey;
          customerNameKey = wordLocale.customerNameKey;
          customerEmailKey = wordLocale.customerEmailKey;
          customerPhoneKey = wordLocale.customerPhoneKey;
          restaurantNameKey = wordLocale.restaurantNameKey;
          restaurantAddressKey = wordLocale.restaurantAddressKey;
          licenseKey = wordLocale.licenseKey;
        }
      }
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const context = await browser.newContext();
      const page = await context.newPage();
      const htmlPath = path.join(__dirname, '../templates/other/dining_summary.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const template = Handlebars.compile(htmlContent);
      const templateData = {
        company: result.businessSettings.companyName,
        restaurantName: `${restaurantName}`,
        restaurantAddress: `${restaurantAddress}`,
        restaurantLicenseName: `${restaurantLicenseName}`,
        restaurantLicenseId: `${licenseId}`,
        businessLicenseName: result.businessSettings.foodLicenseName,
        businessLicenseNumber: result.businessSettings.foodLicense,
        licenseKey: `${licenseKey}`,
        direction: `${direction}`,
        restaurantNameKey: `${restaurantNameKey}`,
        restaurantAddressKey: `${restaurantAddressKey}`,
        bookingSummaryKey: `${bookingSummaryKey}`,
        bookingIdKey: `${bookingIdKey}`,
        bookingDateTimeKey: `${bookingDateTimeKey}`,
        guestCountKey: `${guestCountKey}`,
        bookingId: `${bookingId}`,
        guest: `${guest}`,
        customerNameKey: `${customerNameKey}`,
        customerEmailKey: `${customerEmailKey}`,
        customerPhoneKey: `${customerPhoneKey}`,
        customerName: `${customerName}`,
        userContact: `${userContact}`,
        userEmail: `${userEmail}`,
        bookingDateTime: `${bookingDateTime}`,
      };
      const finalHtml = template(templateData);
      await page.setContent(finalHtml, {
        waitUntil: 'networkidle',
      });
      const downloadPath = path.join(
        __dirname,
        `../templates/downloads/Dining_Booking_ID_${bookingId}.pdf`
      );
      await page.pdf({
        path: downloadPath,
        format: 'A4',
        printBackground: true,
      });
      await browser.close();
      if (fs.existsSync(downloadPath)) {
        res.download(downloadPath, (err) => {
          if (!err) {
            fs.unlink(downloadPath, () => {});
          }
        });
      } else {
        res.status(404).json({ success: false, message: 'File not found', extra: '' });
      }
    } else {
      res.status(404).json({ success: false, message: 'Something went wrong' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

const downloadBookingInvoice = catchAsync(async (req, res) => {
  try {
    const { id, user, locale } = req.params;
    const result = await diningBookingService.downloadBookingInvoice(id, user);
    if (result.success) {
      let currencySymbol = '$';
      let currencySide = 'left';
      if (
        result &&
        result.businessSettings !== null &&
        result.businessSettings.currencySide !== ''
      ) {
        currencySide = result.businessSettings.currencySide;
      }
      if (
        result &&
        result.businessSettings !== null &&
        result.businessSettings.currency !== null &&
        result.businessSettings.currency.symbol !== ''
      ) {
        currencySymbol = result.businessSettings.currency.symbol;
      }
      let preBookingCharge = '';
      let couponCoverCharge = '';
      let grandTotal = '';
      let diningItemTotalAmount = '';
      let diningItemDiscountAmount = '';
      let diningCouponDiscountAmount = '';
      let diningGrandTotalBillAmount = '';

      if (result && result.details.preBookingCharge) {
        preBookingCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.preBookingCharge}`
            : `${result.details.preBookingCharge}${currencySymbol}`;
      }

      if (result && result.details.couponCoverCharge) {
        couponCoverCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.couponCoverCharge}`
            : `${result.details.couponCoverCharge}${currencySymbol}`;
      }

      if (result && result.details.grandTotal) {
        grandTotal =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.grandTotal}`
            : `${result.details.grandTotal}${currencySymbol}`;
      }

      if (result && result.details.diningItemTotalAmount) {
        diningItemTotalAmount =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.diningItemTotalAmount}`
            : `${result.details.diningItemTotalAmount}${currencySymbol}`;
      }

      if (result && result.details.diningItemDiscountAmount) {
        diningItemDiscountAmount =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.diningItemDiscountAmount}`
            : `${result.details.diningItemDiscountAmount}${currencySymbol}`;
      }

      if (result && result.details.diningCouponDiscountAmount) {
        diningCouponDiscountAmount =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.diningCouponDiscountAmount}`
            : `${result.details.diningCouponDiscountAmount}${currencySymbol}`;
      }

      if (result && result.details.diningGrandTotalBillAmount) {
        diningGrandTotalBillAmount =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.diningGrandTotalBillAmount}`
            : `${result.details.diningGrandTotalBillAmount}${currencySymbol}`;
      }

      let legalName = '';
      if (
        result &&
        result.restaurantDetail &&
        result.restaurantDetail !== null &&
        result.restaurantDetail.ownerInfo &&
        result.restaurantDetail.ownerInfo.firstName !== ''
      ) {
        const { firstName, lastName } = result.restaurantDetail.ownerInfo;
        legalName = `${firstName} ${lastName}`;
      }
      let restaurantName = '';
      let restaurantAddress = '';
      let licenseId = '';
      let restaurantLicenseName = '';
      if (result && result.restaurantDetail && result.restaurantDetail !== null) {
        restaurantName = result.restaurantDetail.name;
        restaurantAddress = result.restaurantDetail.address;
        licenseId = result.restaurantDetail.licenseId;
        if (
          result.restaurantDetail.translations &&
          checkArrayNotEmpty(result.restaurantDetail.translations)
        ) {
          const translationIndex = result.restaurantDetail.translations.filter(
            (x) => x.code === locale
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            if (translationIndex[0].title !== '') {
              restaurantName = translationIndex[0].title;
            }
            if (translationIndex[0].address !== '') {
              restaurantAddress = translationIndex[0].address;
            }
          }
        }
        if (
          result &&
          result.restaurantDetail &&
          result.restaurantDetail !== null &&
          result.restaurantDetail.license &&
          result.restaurantDetail.license.name !== ''
        ) {
          restaurantLicenseName = result.restaurantDetail.license.name;
          if (
            result.restaurantDetail.license.translations &&
            checkArrayNotEmpty(result.restaurantDetail.license.translations)
          ) {
            const translationIndex = result.restaurantDetail.license.translations.filter(
              (x) => x.code === locale
            );
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
              if (translationIndex[0].value !== '') {
                restaurantLicenseName = translationIndex[0].value;
              }
            }
          }
        }
      }
      let paymentMode = 'online';
      if (
        result &&
        result.details &&
        result.details !== null &&
        result.details.paymentInfo &&
        result.details.paymentInfo !== null &&
        result.details.paymentInfo.paymentWay !== ''
      ) {
        paymentMode = result.details.paymentInfo.paymentWay;
      }
      const complianceForm = [];
      if (
        result &&
        result.businessSettings &&
        result.businessSettings !== null &&
        result.businessSettings.complianceForm &&
        checkArrayNotEmpty(result.businessSettings.complianceForm)
      ) {
        result.businessSettings.complianceForm.forEach((formElement) => {
          const formParam = {
            name: `${formElement.fieldName}`,
            value: `${formElement.fieldValue}`,
          };
          complianceForm.push(formParam);
        });
      }
      const guest =
        result && result.details && result.details.guest && result.details.guest !== null
          ? result.details.guest
          : '1';
      const customerName =
        result && result.details && result.details.userName && result.details.userName !== null
          ? result.details.userName
          : 'Unknown';
      const userContact =
        result &&
        result.details &&
        result.details.userContact &&
        result.details.userContact !== null
          ? `+${result.details.userCountryCode} ${result.details.userContact}`
          : 'Unknown';
      const userEmail =
        result && result.details && result.details.userEmail && result.details.userEmail !== null
          ? result.details.userEmail
          : 'Unknown';
      const dateOfBooking =
        result &&
        result.details &&
        result.details.bookingDate &&
        result.details.bookingDate !== null
          ? DateTime.fromISO(result.details.bookingDate).toFormat('dd LLL yyyy')
          : '15 July 2025';
      const bookingSlot =
        result &&
        result.details &&
        result.details.bookingSlot &&
        result.details.bookingSlot !== null
          ? result.details.bookingSlot
          : '10:00 AM';
      const bookingDateTime = `${dateOfBooking} ${bookingSlot}`;
      const bookingId =
        result && result.details && result.details.id && result.details.id !== null
          ? result.details.id
          : 'Unknown';
      let bookingInvoiceKey = 'Dining Booking Invoice';
      let taxInvoiceKey = 'Tax Invoice';
      let digitalCopyKey = 'Digital Copy For Recipient';
      let taxBehalfKey = 'Tax Invoice on behalf of -';
      let legalNameKey = 'Legal Entity Name';
      let restaurantNameKey = 'Restaurant Name';
      let restaurantAddressKey = 'Restaurant Address';
      let restaurantLicenseKey = 'Restaurant License';
      let invoiceNumberKey = 'Invoice No.';
      let invoiceDateKey = 'Invoice Date';
      let customerNameKey = 'Customer Name';
      let serviceDescriptionKey = 'Service Description';
      let serviceDescriptionValue = 'Restaurant Service';
      let onlinePayDescriptionKey =
        'settled through digital payment received upon delivery against Order ID';
      let offlinePayDescriptionKey =
        'settled through cash payment received upon delivery against Order ID';
      let licenseKey = 'Lic.';
      let direction = 'ltr';
      let customerEmailKey = 'Customer Email';
      let customerPhoneKey = 'Customer Contact No';
      let preBookingChargeKey = 'Pre Booking Charge';
      let couponCoverChargeKey = 'Coupon Cover Charge';
      let grandTotalKey = 'Pre Booking Paid';
      let diningItemTotalAmountKey = 'Item Total';
      let diningItemDiscountAmountKey = 'Item Discount';
      let diningCouponDiscountAmountKey = 'Coupon Discount';
      let diningGrandTotalBillAmountKey = 'Billing Total';

      const wordTranslations = apiLocaleTranslations[locale];
      if (wordTranslations && wordTranslations !== null) {
        direction = wordTranslations.direction;
        const wordLocale = wordTranslations.bookingInvoice;
        if (wordLocale && wordLocale !== null) {
          bookingInvoiceKey = wordLocale.bookingInvoiceKey;
          taxInvoiceKey = wordLocale.taxInvoiceKey;
          digitalCopyKey = wordLocale.digitalCopyKey;
          taxBehalfKey = wordLocale.taxBehalfKey;
          legalNameKey = wordLocale.legalNameKey;
          restaurantNameKey = wordLocale.restaurantNameKey;
          restaurantAddressKey = wordLocale.restaurantAddressKey;
          restaurantLicenseKey = wordLocale.restaurantLicenseKey;
          invoiceNumberKey = wordLocale.invoiceNumberKey;
          invoiceDateKey = wordLocale.invoiceDateKey;
          customerNameKey = wordLocale.customerNameKey;
          serviceDescriptionKey = wordLocale.serviceDescriptionKey;
          serviceDescriptionValue = wordLocale.serviceDescriptionValue;
          onlinePayDescriptionKey = wordLocale.onlinePayDescriptionKey;
          offlinePayDescriptionKey = wordLocale.offlinePayDescriptionKey;
          licenseKey = wordLocale.licenseKey;
          customerEmailKey = wordLocale.customerEmailKey;
          customerPhoneKey = wordLocale.customerPhoneKey;
          preBookingChargeKey = wordLocale.preBookingChargeKey;
          couponCoverChargeKey = wordLocale.couponCoverChargeKey;
          grandTotalKey = wordLocale.grandTotalKey;
          diningItemTotalAmountKey = wordLocale.diningItemTotalAmountKey;
          diningItemDiscountAmountKey = wordLocale.diningItemDiscountAmountKey;
          diningCouponDiscountAmountKey = wordLocale.diningCouponDiscountAmountKey;
          diningGrandTotalBillAmountKey = wordLocale.diningGrandTotalBillAmountKey;
        }
      }
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const context = await browser.newContext();
      const page = await context.newPage();
      const htmlPath = path.join(__dirname, '../templates/other/dining_invoice.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const template = Handlebars.compile(htmlContent);
      const templateData = {
        bookingInvoiceKey: `${bookingInvoiceKey}`,
        id: result.details.id,
        legalName: `${legalName}`,
        company: result.businessSettings.companyName,
        restaurantName: `${restaurantName}`,
        restaurantAddress: `${restaurantAddress}`,
        receiverName: result.details.receiverName,
        restaurantLicenseName: `${restaurantLicenseName}`,
        restaurantLicenseId: `${licenseId}`,
        isOnlinePayment: paymentMode === 'online',
        isOfflinePayment: paymentMode === 'offline',
        businessLicenseName: result.businessSettings.foodLicenseName,
        businessLicenseNumber: result.businessSettings.foodLicense,
        complianceFormElement: complianceForm,
        taxInvoiceKey: `${taxInvoiceKey}`,
        digitalCopyKey: `${digitalCopyKey}`,
        taxBehalfKey: `${taxBehalfKey}`,
        legalNameKey: `${legalNameKey}`,
        restaurantNameKey: `${restaurantNameKey}`,
        restaurantAddressKey: `${restaurantAddressKey}`,
        restaurantLicenseKey: `${restaurantLicenseKey}`,
        invoiceNumberKey: `${invoiceNumberKey}`,
        invoiceDateKey: `${invoiceDateKey}`,
        customerNameKey: `${customerNameKey}`,
        serviceDescriptionKey: `${serviceDescriptionKey}`,
        serviceDescriptionValue: `${serviceDescriptionValue}`,
        onlinePayDescriptionKey: `${onlinePayDescriptionKey}`,
        offlinePayDescriptionKey: `${offlinePayDescriptionKey}`,
        licenseKey: `${licenseKey}`,
        direction: `${direction}`,
        guest: `${guest}`,
        customerEmailKey: `${customerEmailKey}`,
        customerPhoneKey: `${customerPhoneKey}`,
        customerName: `${customerName}`,
        userContact: `${userContact}`,
        userEmail: `${userEmail}`,
        bookingDateTime: `${bookingDateTime}`,
        preBookingChargeKey: `${preBookingChargeKey}`,
        couponCoverChargeKey: `${couponCoverChargeKey}`,
        grandTotalKey: `${grandTotalKey}`,
        diningItemTotalAmountKey: `${diningItemTotalAmountKey}`,
        diningItemDiscountAmountKey: `${diningItemDiscountAmountKey}`,
        diningCouponDiscountAmountKey: `${diningCouponDiscountAmountKey}`,
        diningGrandTotalBillAmountKey: `${diningGrandTotalBillAmountKey}`,
        preBookingCharge: `${preBookingCharge}`,
        couponCoverCharge: `${couponCoverCharge}`,
        grandTotal: `${grandTotal}`,
        diningItemTotalAmount: `${diningItemTotalAmount}`,
        diningItemDiscountAmount: `${diningItemDiscountAmount}`,
        diningCouponDiscountAmount: `${diningCouponDiscountAmount}`,
        diningGrandTotalBillAmount: `${diningGrandTotalBillAmount}`,
      };
      const finalHtml = template(templateData);
      await page.setContent(finalHtml, {
        waitUntil: 'networkidle',
      });
      const downloadPath = path.join(
        __dirname,
        `../templates/downloads/Dining_Booking_Invoice_${bookingId}.pdf`
      );
      await page.pdf({
        path: downloadPath,
        format: 'A4',
        printBackground: true,
      });
      await browser.close();
      if (fs.existsSync(downloadPath)) {
        res.download(downloadPath, (err) => {
          if (!err) {
            fs.unlink(downloadPath, () => {});
          }
        });
      } else {
        res.status(404).json({ success: false, message: 'File not found', extra: '' });
      }
    } else {
      res.status(404).json({ success: false, message: 'Something went wrong' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

module.exports = {
  createBooking,
  getDiningBookingWithUserId,
  searchDiningBooking,
  getUserDiningBookingInformation,
  repayPendingBooking,
  cancelMyDiningBooking,
  adminDiningBookingCount,
  adminDiningBookingList,
  getVendorDiningBookingList,
  acceptDiningBooking,
  rejectDiningBooking,
  completeDiningBooking,
  getDiningBookingInformation,
  callBookingCustomer,
  getVendorWebDiningBookingList,
  getDiningBookingInfoAdmin,
  diningBookingReport,
  customerDiningBooking,
  vendorBookingList,
  couponBooking,
  supportTeamBookingDetail,
  cityzenDiningBookingCount,
  cityzenDiningBookingList,
  exportCollection,
  exportReportCollection,
  importCollection,
  downloadBookingSummary,
  downloadBookingInvoice,
};

