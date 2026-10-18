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
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { withdrawalRequestService } = require('../services');

const createRestaurantWithdrawalRequest = catchAsync(async (req, res) => {
  const result = await withdrawalRequestService.createRestaurantWithdrawalRequest(req.body);
  res.send(result);
});

const createDeliverymanWithdrawalRequest = catchAsync(async (req, res) => {
  const result = await withdrawalRequestService.createDeliverymanWithdrawalRequest(req.body);
  res.send(result);
});

const getRestaurantWithdrawalRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['status', 'limit', 'page', 'search']);
  const result = await withdrawalRequestService.getRestaurantWithdrawalRequest(options);
  res.send(result);
});

const cityzenRestaurantWithdrawal = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['status', 'limit', 'page', 'search']);
  const result = await withdrawalRequestService.cityzenRestaurantWithdrawal(master, options);
  res.send(result);
});

const getDeliverymanWithdrawalRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['status', 'limit', 'page', 'search']);
  const result = await withdrawalRequestService.getDeliverymanWithdrawalRequest(options);
  res.send(result);
});

const cityzenDeliverymanWithdrawalRequest = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['status', 'limit', 'page', 'search']);
  const result = await withdrawalRequestService.cityzenDeliverymanWithdrawalRequest(
    master,
    options
  );
  res.send(result);
});

const withdrawalRequestDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await withdrawalRequestService.withdrawalRequestDetail(id);
  res.send(result);
});

const declineWithdrawalRequest = catchAsync(async (req, res) => {
  const { id, reason } = req.body;
  const result = await withdrawalRequestService.declineWithdrawalRequest(id, reason);
  res.send(result);
});

const approveWithdrawalRequest = catchAsync(async (req, res) => {
  const { id, approvedNotes, proof } = req.body;
  const result = await withdrawalRequestService.approveWithdrawalRequest(id, approvedNotes, proof);
  res.send(result);
});

const restaurantWithdrawalHistory = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await withdrawalRequestService.restaurantWithdrawalHistory(vendor, options);
  res.send(result);
});

const deliverymanWithdrawalHistory = catchAsync(async (req, res) => {
  const { deliveryman } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await withdrawalRequestService.deliverymanWithdrawalHistory(deliveryman, options);
  res.send(result);
});

const vendorWithdrawalRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await withdrawalRequestService.vendorWithdrawalRequest(options);
  res.send(result);
});

const deliverymanWithdrawalRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['deliveryman', 'limit', 'page']);
  const result = await withdrawalRequestService.deliverymanWithdrawalRequest(options);
  res.send(result);
});

const exportRestaurantRequestCollection = catchAsync(async (req, res) => {
  const { type, status, search } = req.query;
  if (type !== 'raw') {
    const result = await withdrawalRequestService.exportRestaurantRequestCollection(status, search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
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
        withdrawalMethodId:
          detail &&
          detail.withdrawalMethod &&
          detail.withdrawalMethod.id &&
          detail.withdrawalMethod.id !== null &&
          detail.withdrawalMethod.id !== ''
            ? detail.withdrawalMethod.id
            : '-',
        withdrawalMethodName:
          detail &&
          detail.withdrawalMethod &&
          detail.withdrawalMethod.name &&
          detail.withdrawalMethod.name !== null &&
          detail.withdrawalMethod.name !== ''
            ? detail.withdrawalMethod.name
            : '-',
        approvedNotes:
          detail &&
          detail.approvedNotes &&
          detail.approvedNotes !== null &&
          detail.approvedNotes !== ''
            ? detail.approvedNotes
            : '-',
        rejectedReason:
          detail &&
          detail.rejectedReason &&
          detail.rejectedReason !== null &&
          detail.rejectedReason !== ''
            ? detail.rejectedReason
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RestaurantWithdrawalRequest');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Payout', key: 'restaurantPayoutMethod' },
        { header: 'Method Id', key: 'withdrawalMethodId' },
        { header: 'Method Name', key: 'withdrawalMethodName' },
        { header: 'Amount', key: 'amount' },
        { header: 'Approved Notes', key: 'approvedNotes' },
        { header: 'Rejection Notes', key: 'rejectedReason' },
        { header: 'Requested At', key: 'createdAt' },
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
        Payout: detail.restaurantPayoutMethod,
        'Method Id':
          detail &&
          detail.withdrawalMethod &&
          detail.withdrawalMethod.id &&
          detail.withdrawalMethod.id !== null &&
          detail.withdrawalMethod.id !== ''
            ? detail.withdrawalMethod.id
            : '-',
        'Method Name':
          detail &&
          detail.withdrawalMethod &&
          detail.withdrawalMethod.name &&
          detail.withdrawalMethod.name !== null &&
          detail.withdrawalMethod.name !== ''
            ? detail.withdrawalMethod.name
            : '-',
        Amount: detail.amount,
        'Approved Notes':
          detail &&
          detail.approvedNotes &&
          detail.approvedNotes !== null &&
          detail.approvedNotes !== ''
            ? detail.approvedNotes
            : '-',
        'Rejection Notes':
          detail &&
          detail.rejectedReason &&
          detail.rejectedReason !== null &&
          detail.rejectedReason !== ''
            ? detail.rejectedReason
            : '-',
        'Requested At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await withdrawalRequestService.exportRawRestaurantRequestCollection(
      status,
      search
    );
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/restaurantwithdrawalrequest.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'restaurantwithdrawalrequest.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportDeliverymanRequestCollection = catchAsync(async (req, res) => {
  const { type, status, search } = req.query;
  if (type !== 'raw') {
    const result = await withdrawalRequestService.exportDeliverymanRequestCollection(
      status,
      search
    );
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        deliverymanId:
          detail &&
          detail.deliveryman &&
          detail.deliveryman.id &&
          detail.deliveryman.id !== null &&
          detail.deliveryman.id !== ''
            ? detail.deliveryman.id
            : 'Uknown',
        deliverymanFirstName:
          detail &&
          detail.deliveryman &&
          detail.deliveryman.firstName &&
          detail.deliveryman.firstName !== null &&
          detail.deliveryman.firstName !== ''
            ? detail.deliveryman.firstName
            : 'Uknown',
        deliverymanLastName:
          detail &&
          detail.deliveryman &&
          detail.deliveryman.lastName &&
          detail.deliveryman.lastName !== null &&
          detail.deliveryman.lastName !== ''
            ? detail.deliveryman.lastName
            : 'Uknown',
        withdrawalMethodId:
          detail &&
          detail.withdrawalMethod &&
          detail.withdrawalMethod.id &&
          detail.withdrawalMethod.id !== null &&
          detail.withdrawalMethod.id !== ''
            ? detail.withdrawalMethod.id
            : '-',
        withdrawalMethodName:
          detail &&
          detail.withdrawalMethod &&
          detail.withdrawalMethod.name &&
          detail.withdrawalMethod.name !== null &&
          detail.withdrawalMethod.name !== ''
            ? detail.withdrawalMethod.name
            : '-',
        approvedNotes:
          detail &&
          detail.approvedNotes &&
          detail.approvedNotes !== null &&
          detail.approvedNotes !== ''
            ? detail.approvedNotes
            : '-',
        rejectedReason:
          detail &&
          detail.rejectedReason &&
          detail.rejectedReason !== null &&
          detail.rejectedReason !== ''
            ? detail.rejectedReason
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('DeliverymanWithdrawalRequest');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Deliveryman Id', key: 'deliverymanId' },
        { header: 'Deliveryman FirstName', key: 'deliverymanFirstName' },
        { header: 'Deliveryman LastName', key: 'deliverymanLastName' },
        { header: 'Payout', key: 'deliverymanPayoutMethod' },
        { header: 'Method Id', key: 'withdrawalMethodId' },
        { header: 'Method Name', key: 'withdrawalMethodName' },
        { header: 'Amount', key: 'amount' },
        { header: 'Approved Notes', key: 'approvedNotes' },
        { header: 'Rejection Notes', key: 'rejectedReason' },
        { header: 'Requested At', key: 'createdAt' },
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
        'Deliveryman Id':
          detail &&
          detail.deliveryman &&
          detail.deliveryman.id &&
          detail.deliveryman.id !== null &&
          detail.deliveryman.id !== ''
            ? detail.deliveryman.id
            : 'Uknown',
        'Deliveryman FirstName':
          detail &&
          detail.deliveryman &&
          detail.deliveryman.firstName &&
          detail.deliveryman.firstName !== null &&
          detail.deliveryman.firstName !== ''
            ? detail.deliveryman.firstName
            : 'Uknown',
        'Deliveryman LastName':
          detail &&
          detail.deliveryman &&
          detail.deliveryman.lastName &&
          detail.deliveryman.lastName !== null &&
          detail.deliveryman.lastName !== ''
            ? detail.deliveryman.lastName
            : 'Uknown',
        Payout: detail.deliverymanPayoutMethod,
        'Method Id':
          detail &&
          detail.withdrawalMethod &&
          detail.withdrawalMethod.id &&
          detail.withdrawalMethod.id !== null &&
          detail.withdrawalMethod.id !== ''
            ? detail.withdrawalMethod.id
            : '-',
        'Method Name':
          detail &&
          detail.withdrawalMethod &&
          detail.withdrawalMethod.name &&
          detail.withdrawalMethod.name !== null &&
          detail.withdrawalMethod.name !== ''
            ? detail.withdrawalMethod.name
            : '-',
        Amount: detail.amount,
        'Approved Notes':
          detail &&
          detail.approvedNotes &&
          detail.approvedNotes !== null &&
          detail.approvedNotes !== ''
            ? detail.approvedNotes
            : '-',
        'Rejection Notes':
          detail &&
          detail.rejectedReason &&
          detail.rejectedReason !== null &&
          detail.rejectedReason !== ''
            ? detail.rejectedReason
            : '-',
        'Requested At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await withdrawalRequestService.exportRawDeliverymanRequestCollection(
      status,
      search
    );
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/deliverymanwithdrawalrequest.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deliverymanwithdrawalrequest.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

module.exports = {
  createRestaurantWithdrawalRequest,
  createDeliverymanWithdrawalRequest,
  getRestaurantWithdrawalRequest,
  getDeliverymanWithdrawalRequest,
  withdrawalRequestDetail,
  declineWithdrawalRequest,
  approveWithdrawalRequest,
  restaurantWithdrawalHistory,
  deliverymanWithdrawalHistory,
  vendorWithdrawalRequest,
  deliverymanWithdrawalRequest,
  cityzenRestaurantWithdrawal,
  cityzenDeliverymanWithdrawalRequest,
  exportRestaurantRequestCollection,
  exportDeliverymanRequestCollection,
};

