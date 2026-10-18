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
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const {
  tiffinSubscriptionRefundRequestService,
  emailConfigService,
  fcmNotificationService,
} = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { tiffinRefundSchemaKeys } = require('../utils/importCollectionSchema');

const saveRefundRequest = catchAsync(async (req, res) => {
  const result = await tiffinSubscriptionRefundRequestService.saveRefundRequest(req.body);
  if (result !== null && result.id !== null) {
    const { purchaseId, reason } = req.body;
    await emailConfigService.sendTiffinSubscriptionRefundRequestToAdmin(
      purchaseId,
      reason,
      result.id
    );
  }
  res.send({ success: true });
});

const getActiveRefundRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'status', 'search']);
  const result = await tiffinSubscriptionRefundRequestService.getActiveRefundRequest(options);
  res.send(result);
});

const cityzenRefundRequest = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'status', 'search']);
  const result = await tiffinSubscriptionRefundRequestService.cityzenRefundRequest(master, options);
  res.send(result);
});

const getTiffinSubscriptionRefundRequestInfo = catchAsync(async (req, res) => {
  const result =
    await tiffinSubscriptionRefundRequestService.getTiffinSubscriptionRefundRequestInfo(
      req.params.requestId
    );
  res.send(result);
});

const cancelRefundRequest = catchAsync(async (req, res) => {
  const result = await tiffinSubscriptionRefundRequestService.cancelRefundRequest(
    req.body.requestId,
    req.body.cancelReason
  );
  if (
    result !== null &&
    result.user !== null &&
    result.restaurant !== null &&
    result.status === 'cancelled'
  ) {
    await fcmNotificationService.adminCancelTiffinSubscriptionRefundRequest(
      result.user,
      req.body.cancelReason,
      result.purchaseSubscription
    );
  }
  res.send({ success: true });
});

const refundFromMerchant = catchAsync(async (req, res) => {
  const result = await tiffinSubscriptionRefundRequestService.refundFromMerchant(
    req.body.requestId
  );
  if (result !== null && result.user !== null && result.restaurant !== null) {
    await fcmNotificationService.approvedTiffinSubscriptionRefundRequest(
      result.user,
      result.grandTotal,
      result.id
    );
  }
  res.send({ success: true });
});

const approveRefundRequest = catchAsync(async (req, res) => {
  const { purchaseId, refundAmount, refundTo, refundType, requestId } = req.body;
  const result = await tiffinSubscriptionRefundRequestService.approveRefundRequest(
    purchaseId,
    refundAmount,
    refundTo,
    refundType,
    requestId
  );
  if (result !== null && result.user !== null && result.restaurant !== null) {
    await fcmNotificationService.approvedTiffinSubscriptionRefundRequest(
      result.user,
      result.grandTotal,
      result.id
    );
  }
  res.send({ success: true });
});

const exportQueryCollection = catchAsync(async (req, res) => {
  const { type, status, search } = req.query;
  if (type !== 'raw') {
    const result = await tiffinSubscriptionRefundRequestService.exportQueryCollection(
      status,
      search
    );
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
        reasonId:
          detail &&
          detail.reason &&
          detail.reason.id &&
          detail.reason.id !== null &&
          detail.reason.id !== ''
            ? detail.reason.id
            : '-',
        reasonName:
          detail &&
          detail.reason &&
          detail.reason.name &&
          detail.reason.name !== null &&
          detail.reason.name !== ''
            ? detail.reason.name
            : '-',
        cancelReason:
          detail &&
          detail.cancelReason &&
          detail.cancelReason !== null &&
          detail.cancelReason !== ''
            ? detail.cancelReason
            : '-',
        packageId:
          detail &&
          detail.packageInfo &&
          detail.packageInfo.id &&
          detail.packageInfo.id !== null &&
          detail.packageInfo.id !== ''
            ? detail.packageInfo.id
            : '-',
        packageName:
          detail &&
          detail.packageInfo &&
          detail.packageInfo.name &&
          detail.packageInfo.name !== null &&
          detail.packageInfo.name !== ''
            ? detail.packageInfo.name
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('TiffinSubscriptionRefund');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Purchase Id', key: 'purchaseSubscription' },
        { header: 'Package Id', key: 'packageId' },
        { header: 'Package Name', key: 'packageName' },
        { header: 'Amount', key: 'amount' },
        { header: 'User Id', key: 'userId' },
        { header: 'User First Name', key: 'userFirstName' },
        { header: 'User Last Name', key: 'userLastName' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Reason Id', key: 'reasonId' },
        { header: 'Reason Name', key: 'reasonName' },
        { header: 'Payment Id', key: 'paymentId' },
        { header: 'Payment Name', key: 'paymentName' },
        { header: 'Payment Way', key: 'paymentWay' },
        { header: 'Cancel Reason', key: 'cancelReason' },
        { header: 'Refund To', key: 'refundTo' },
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
        'Purchase Id': detail.purchaseSubscription,
        'Package Id':
          detail &&
          detail.packageInfo &&
          detail.packageInfo.id &&
          detail.packageInfo.id !== null &&
          detail.packageInfo.id !== ''
            ? detail.packageInfo.id
            : '-',
        'Package Name':
          detail &&
          detail.packageInfo &&
          detail.packageInfo.name &&
          detail.packageInfo.name !== null &&
          detail.packageInfo.name !== ''
            ? detail.packageInfo.name
            : '-',
        Amount: detail.amount,
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
        'Reason Id':
          detail &&
          detail.reason &&
          detail.reason.id &&
          detail.reason.id !== null &&
          detail.reason.id !== ''
            ? detail.reason.id
            : '-',
        'Reason Name':
          detail &&
          detail.reason &&
          detail.reason.name &&
          detail.reason.name !== null &&
          detail.reason.name !== ''
            ? detail.reason.name
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
        'Cancel Reason':
          detail &&
          detail.cancelReason &&
          detail.cancelReason !== null &&
          detail.cancelReason !== ''
            ? detail.cancelReason
            : '-',
        'Refund To': detail.refundTo,
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await tiffinSubscriptionRefundRequestService.exportQueryRawCollection(
      status,
      search
    );
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/tiffinsubscriptionrefundrequests.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'tiffinsubscriptionrefundrequests.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
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
              importKeys.length === tiffinRefundSchemaKeys.length &&
              importKeys.every((item) => tiffinRefundSchemaKeys.includes(item));
            if (validSchema) {
              const result = await tiffinSubscriptionRefundRequestService.importCollection(records);
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
                    importKeys.length === tiffinRefundSchemaKeys.length &&
                    importKeys.every((item) => tiffinRefundSchemaKeys.includes(item));
                  if (validSchema) {
                    const result =
                      await tiffinSubscriptionRefundRequestService.importCollection(records);
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

module.exports = {
  saveRefundRequest,
  getActiveRefundRequest,
  getTiffinSubscriptionRefundRequestInfo,
  cancelRefundRequest,
  refundFromMerchant,
  approveRefundRequest,
  cityzenRefundRequest,
  exportQueryCollection,
  importCollection,
};

