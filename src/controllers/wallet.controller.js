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
const { walletService, transactionService } = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { walletTransactionSchemaKeys } = require('../utils/importCollectionSchema');

const create = catchAsync(async (req, res) => {
  const result = await walletService.createWallet(req.body);
  res.send(result);
});

const getMyWalletData = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await walletService.getMyWalletData(req.params.user, options);
  res.send(result);
});

const vendorWalletTransaction = catchAsync(async (req, res) => {
  const { user } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await walletService.vendorWalletTransaction(user, options);
  res.send(result);
});

const vendorWalletWithdrawalDetail = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await walletService.vendorWalletWithdrawalDetail(vendor);
  res.send(result);
});

const deliverymanWalletTransaction = catchAsync(async (req, res) => {
  const { user } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await walletService.deliverymanWalletTransaction(user, options);
  res.send(result);
});

const deliverymanWalletWithdrawalDetail = catchAsync(async (req, res) => {
  const { deliveryman } = req.params;
  const result = await walletService.deliverymanWalletWithdrawalDetail(deliveryman);
  res.send(result);
});

const adminAddWalletFund = catchAsync(async (req, res) => {
  const { id, amount, userId, referral } = req.body;
  const result = await walletService.adminAddWalletFund(id, userId, amount, referral);
  res.send(result);
});

const getTransactionReport = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'filter',
    'status',
    'role',
    'filterDates',
    'search',
    'limit',
    'page',
  ]);
  const result = await transactionService.getTransactionReport(options);
  res.send(result);
});

const customerTransactionList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await transactionService.customerTransactionList(options);
  res.send(result);
});

const deliverymanTransactionList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['deliveryman', 'limit', 'page']);
  const result = await transactionService.deliverymanTransactionList(options);
  res.send(result);
});

const vendorTransactionList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await transactionService.vendorTransactionList(options);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['filter', 'status', 'role', 'filterDates', 'search']);
  const { type } = req.query;
  if (type !== 'raw') {
    const result = await transactionService.exportCollection(options);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
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
      const worksheet = workbook.addWorksheet('WalletTransactions');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'UUID', key: 'uuid' },
        { header: 'Type', key: 'type' },
        { header: 'Amount', key: 'amount' },
        { header: 'User Id', key: 'userId' },
        { header: 'User FirstName', key: 'userFirstName' },
        { header: 'User LastName', key: 'userLastName' },
        { header: 'User Role', key: 'userRole' },
        { header: 'Wallet UUID', key: 'walletUUID' },
        { header: 'Wallet Id', key: 'walletId' },
        { header: 'Wallet Balance', key: 'walletBalance' },
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
        UUID: detail.uuid,
        Type: detail.type,
        Amount: detail.amount,
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
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await transactionService.exportRawCollection(options);
    const downloadPath = path.join(__dirname, `../templates/downloads/transactions.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'transactions.json', (err) => {
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
              importKeys.length === walletTransactionSchemaKeys.length &&
              importKeys.every((item) => walletTransactionSchemaKeys.includes(item));
            if (validSchema) {
              const result = await transactionService.importCollection(records);
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
                    importKeys.length === walletTransactionSchemaKeys.length &&
                    importKeys.every((item) => walletTransactionSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await transactionService.importCollection(records);
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
  create,
  getMyWalletData,
  vendorWalletTransaction,
  vendorWalletWithdrawalDetail,
  deliverymanWalletTransaction,
  deliverymanWalletWithdrawalDetail,
  adminAddWalletFund,
  getTransactionReport,
  customerTransactionList,
  deliverymanTransactionList,
  vendorTransactionList,
  exportCollection,
  importCollection,
};

