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

const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const { DateTime } = require('luxon');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { restaurantExpenseService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await restaurantExpenseService.saveExpense(req.body);
  res.send(result);
});

const getInitialResponse = catchAsync(async (req, res) => {
  const options = pick(req.query, ['type', 'restaurant', 'limit', 'page']);
  const result = await restaurantExpenseService.getInitialResponse(options);
  res.send(result);
});

const getExpenseList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['type', 'restaurant', 'limit', 'page']);
  const result = await restaurantExpenseService.getExpenseList(options);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { exportType } = req.query;
  const options = pick(req.query, ['type', 'restaurant']);
  const result = await restaurantExpenseService.exportCollection(options);
  if (exportType === 'excel') {
    const mappedResult = result.map((detail, index) => ({
      ...detail,
      serial: index + 1,
      createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
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
      orderId:
        detail &&
        detail.orderInfo &&
        detail.orderInfo.id &&
        detail.orderInfo.id !== null &&
        detail.orderInfo.id !== ''
          ? detail.orderInfo.id
          : '-',
      orderNo:
        detail &&
        detail.orderInfo &&
        detail.orderInfo.orderNo &&
        detail.orderInfo.orderNo !== null &&
        detail.orderInfo.orderNo !== ''
          ? detail.orderInfo.orderNo
          : '-',
      posOrderId:
        detail &&
        detail.posOrderInfo &&
        detail.posOrderInfo.id &&
        detail.posOrderInfo.id !== null &&
        detail.posOrderInfo.id !== ''
          ? detail.posOrderInfo.id
          : '-',
      posOrderNo:
        detail &&
        detail.posOrderInfo &&
        detail.posOrderInfo.orderNo &&
        detail.posOrderInfo.orderNo !== null &&
        detail.posOrderInfo.orderNo !== ''
          ? detail.posOrderInfo.orderNo
          : '-',
      tableOrderId:
        detail &&
        detail.tableOrderInfo &&
        detail.tableOrderInfo.id &&
        detail.tableOrderInfo.id !== null &&
        detail.tableOrderInfo.id !== ''
          ? detail.tableOrderInfo.id
          : '-',
      tableOrderNo:
        detail &&
        detail.tableOrderInfo &&
        detail.tableOrderInfo.orderNo &&
        detail.tableOrderInfo.orderNo !== null &&
        detail.tableOrderInfo.orderNo !== ''
          ? detail.tableOrderInfo.orderNo
          : '-',
      bookingId:
        detail &&
        detail.bookingInfo &&
        detail.bookingInfo.id &&
        detail.bookingInfo.id !== null &&
        detail.bookingInfo.id !== ''
          ? detail.bookingInfo.id
          : '-',
      couponId:
        detail &&
        detail.couponInfo &&
        detail.couponInfo.id &&
        detail.couponInfo.id !== null &&
        detail.couponInfo.id !== ''
          ? detail.couponInfo.id
          : '-',
      couponCode:
        detail &&
        detail.couponInfo &&
        detail.couponInfo.code &&
        detail.couponInfo.code !== null &&
        detail.couponInfo.code !== ''
          ? detail.couponInfo.code
          : '-',
      diningCouponId:
        detail &&
        detail.diningCouponInfo &&
        detail.diningCouponInfo.id &&
        detail.diningCouponInfo.id !== null &&
        detail.diningCouponInfo.id !== ''
          ? detail.diningCouponInfo.id
          : '-',
      diningCouponCode:
        detail &&
        detail.diningCouponInfo &&
        detail.diningCouponInfo.code &&
        detail.diningCouponInfo.code !== null &&
        detail.diningCouponInfo.code !== ''
          ? detail.diningCouponInfo.code
          : '-',
    }));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('RestaurantExpenseReport');
    worksheet.columns = [
      { header: 'S. No.', key: 'serial' },
      { header: 'Id', key: 'id' },
      { header: 'User Id', key: 'userId' },
      { header: 'User FirstName', key: 'userFirstName' },
      { header: 'User LastName', key: 'userLastName' },
      { header: 'Expense Type', key: 'expenseType' },
      { header: 'Amount', key: 'amount' },
      { header: 'Order Id', key: 'orderId' },
      { header: 'Order No', key: 'orderNo' },
      { header: 'POS Order Id', key: 'posOrderId' },
      { header: 'POS Order No', key: 'posOrderNo' },
      { header: 'Table Order Id', key: 'tableOrderId' },
      { header: 'Table Order No', key: 'tableOrderNo' },
      { header: 'Dining Booking Id', key: 'bookingId' },
      { header: 'Coupon Id', key: 'couponId' },
      { header: 'Coupon Code', key: 'couponCode' },
      { header: 'Dining Coupon Id', key: 'diningCouponId' },
      { header: 'Dining Coupon Code', key: 'diningCouponCode' },
      { header: 'Created At', key: 'createdAt' },
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
      'Expense Type': detail.expenseType,
      Amount: detail.amount,
      'Order Id':
        detail &&
        detail.orderInfo &&
        detail.orderInfo.id &&
        detail.orderInfo.id !== null &&
        detail.orderInfo.id !== ''
          ? detail.orderInfo.id
          : '-',
      'Order No':
        detail &&
        detail.orderInfo &&
        detail.orderInfo.orderNo &&
        detail.orderInfo.orderNo !== null &&
        detail.orderInfo.orderNo !== ''
          ? detail.orderInfo.orderNo
          : '-',
      'POS Order Id':
        detail &&
        detail.posOrderInfo &&
        detail.posOrderInfo.id &&
        detail.posOrderInfo.id !== null &&
        detail.posOrderInfo.id !== ''
          ? detail.posOrderInfo.id
          : '-',
      'POS Order No':
        detail &&
        detail.posOrderInfo &&
        detail.posOrderInfo.orderNo &&
        detail.posOrderInfo.orderNo !== null &&
        detail.posOrderInfo.orderNo !== ''
          ? detail.posOrderInfo.orderNo
          : '-',
      'Table Order Id':
        detail &&
        detail.tableOrderInfo &&
        detail.tableOrderInfo.id &&
        detail.tableOrderInfo.id !== null &&
        detail.tableOrderInfo.id !== ''
          ? detail.tableOrderInfo.id
          : '-',
      'Table Order No':
        detail &&
        detail.tableOrderInfo &&
        detail.tableOrderInfo.orderNo &&
        detail.tableOrderInfo.orderNo !== null &&
        detail.tableOrderInfo.orderNo !== ''
          ? detail.tableOrderInfo.orderNo
          : '-',
      'Dining Booking Id':
        detail &&
        detail.bookingInfo &&
        detail.bookingInfo.id &&
        detail.bookingInfo.id !== null &&
        detail.bookingInfo.id !== ''
          ? detail.bookingInfo.id
          : '-',
      'Coupon Id':
        detail &&
        detail.couponInfo &&
        detail.couponInfo.id &&
        detail.couponInfo.id !== null &&
        detail.couponInfo.id !== ''
          ? detail.couponInfo.id
          : '-',
      'Coupon Code':
        detail &&
        detail.couponInfo &&
        detail.couponInfo.code &&
        detail.couponInfo.code !== null &&
        detail.couponInfo.code !== ''
          ? detail.couponInfo.code
          : '-',
      'Dining Coupon Id':
        detail &&
        detail.diningCouponInfo &&
        detail.diningCouponInfo.id &&
        detail.diningCouponInfo.id !== null &&
        detail.diningCouponInfo.id !== ''
          ? detail.diningCouponInfo.id
          : '-',
      'Dining Coupon Code':
        detail &&
        detail.diningCouponInfo &&
        detail.diningCouponInfo.code &&
        detail.diningCouponInfo.code !== null &&
        detail.diningCouponInfo.code !== ''
          ? detail.diningCouponInfo.code
          : '-',
      'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const csv = Papa.unparse(fieldItems);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
    res.send(csv);
  }
});

module.exports = {
  create,
  getInitialResponse,
  getExpenseList,
  exportCollection,
};

