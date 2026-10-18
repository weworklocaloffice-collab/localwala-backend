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
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { userService, walletService, waiterService, restaurantService } = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { Wallet } = require('../models');
const { restaurantWaiterSchemaKeys } = require('../utils/importCollectionSchema');

const registerWaiterAccount = catchAsync(async (req, res) => {
  const user = await userService.createWaiterAccount(req.body);
  const walletData = new Wallet({
    holderId: user.id,
  });
  await walletService.createWallet(walletData);
  req.body.userId = user.id;
  await waiterService.createWaiter(req.body);
  res.status(201).send({ success: true });
});

const getMyWaiter = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await waiterService.getAllVendorWaiter(req.params.restaurant, options);
  res.send(result);
});

const getById = catchAsync(async (req, res) => {
  const { waiterId } = req.params;
  const info = await waiterService.getById(waiterId);
  res.send(info);
});

const updateWaiterInfo = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const info = await waiterService.updateWaiterInfo(userId, req.body);
  res.send(info);
});

const updateWaiterStatus = catchAsync(async (req, res) => {
  const { waiterId } = req.params;
  const { status } = req.body;
  const info = await waiterService.updateWaiterStatus(waiterId, status);
  res.send(info);
});

const waiterListAdmin = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await waiterService.waiterListAdmin(options);
  res.send(result);
});

const cityzenWaiterList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await waiterService.cityzenWaiterList(master, options);
  res.send(result);
});

const waiterFoodList = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantService.waiterFoodList(vendor);
  res.send(result);
});

const waiterFoodSearchInitialData = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantService.waiterFoodSearchInitialData(vendor);
  res.send(result);
});

const waiterFoodSearch = catchAsync(async (req, res) => {
  const { vendor, searchQuery } = req.params;
  const result = await restaurantService.waiterFoodSearch(vendor, searchQuery);
  res.send(result);
});

const vendorWaiterList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await waiterService.vendorWaiterList(options);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await waiterService.exportCollection(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        waiterId:
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.id &&
          detail.waiterInfo.id !== null &&
          detail.waiterInfo.id !== ''
            ? detail.waiterInfo.id
            : '-',
        waiterFirstName:
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.firstName &&
          detail.waiterInfo.firstName !== null &&
          detail.waiterInfo.firstName !== ''
            ? detail.waiterInfo.firstName
            : '-',
        waiterLastName:
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.lastName &&
          detail.waiterInfo.lastName !== null &&
          detail.waiterInfo.lastName !== ''
            ? detail.waiterInfo.lastName
            : '-',
        waiterImage:
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.image &&
          detail.waiterInfo.image !== null &&
          detail.waiterInfo.image !== ''
            ? detail.waiterInfo.image
            : '-',
        waiterCountryCode:
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.countryCode &&
          detail.waiterInfo.countryCode !== null &&
          detail.waiterInfo.countryCode !== ''
            ? detail.waiterInfo.countryCode
            : '-',
        waiterMobile:
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.mobile &&
          detail.waiterInfo.mobile !== null &&
          detail.waiterInfo.mobile !== ''
            ? detail.waiterInfo.mobile
            : '-',
        waiterEmail:
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.email &&
          detail.waiterInfo.email !== null &&
          detail.waiterInfo.email !== ''
            ? detail.waiterInfo.email
            : '-',
        restaurantId:
          detail &&
          detail.restaurants &&
          detail.restaurants.id &&
          detail.restaurants.id !== null &&
          detail.restaurants.id !== ''
            ? detail.restaurants.id
            : '-',
        restaurantName:
          detail &&
          detail.restaurants &&
          detail.restaurants.name &&
          detail.restaurants.name !== null &&
          detail.restaurants.name !== ''
            ? detail.restaurants.name
            : '-',
        status: detail.status ? 'Active' : 'Deactivated',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RestaurantWaiters');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Waiter Id', key: 'waiterId' },
        { header: 'First Name', key: 'waiterFirstName' },
        { header: 'Last Name', key: 'waiterLastName' },
        { header: 'Country Code', key: 'waiterCountryCode' },
        { header: 'Mobile', key: 'waiterMobile' },
        { header: 'Email', key: 'waiterEmail' },
        { header: 'Waiter Image', key: 'waiterImage' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
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
        'Waiter Id':
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.id &&
          detail.waiterInfo.id !== null &&
          detail.waiterInfo.id !== ''
            ? detail.waiterInfo.id
            : '-',
        'First Name':
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.firstName &&
          detail.waiterInfo.firstName !== null &&
          detail.waiterInfo.firstName !== ''
            ? detail.waiterInfo.firstName
            : '-',
        'Last Name':
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.lastName &&
          detail.waiterInfo.lastName !== null &&
          detail.waiterInfo.lastName !== ''
            ? detail.waiterInfo.lastName
            : '-',
        'Country Code':
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.countryCode &&
          detail.waiterInfo.countryCode !== null &&
          detail.waiterInfo.countryCode !== ''
            ? detail.waiterInfo.countryCode
            : '-',
        Mobile:
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.mobile &&
          detail.waiterInfo.mobile !== null &&
          detail.waiterInfo.mobile !== ''
            ? detail.waiterInfo.mobile
            : '-',
        Email:
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.email &&
          detail.waiterInfo.email !== null &&
          detail.waiterInfo.email !== ''
            ? detail.waiterInfo.email
            : '-',
        'Waiter Image':
          detail &&
          detail.waiterInfo &&
          detail.waiterInfo.image &&
          detail.waiterInfo.image !== null &&
          detail.waiterInfo.image !== ''
            ? detail.waiterInfo.image
            : '-',
        'Restaurant Id':
          detail &&
          detail.restaurants &&
          detail.restaurants.id &&
          detail.restaurants.id !== null &&
          detail.restaurants.id !== ''
            ? detail.restaurants.id
            : '-',
        'Restaurant Name':
          detail &&
          detail.restaurants &&
          detail.restaurants.name &&
          detail.restaurants.name !== null &&
          detail.restaurants.name !== ''
            ? detail.restaurants.name
            : '-',
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await waiterService.exportRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/waiters.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'waiters.json', (err) => {
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
              importKeys.length === restaurantWaiterSchemaKeys.length &&
              importKeys.every((item) => restaurantWaiterSchemaKeys.includes(item));
            if (validSchema) {
              const result = await waiterService.importCollection(records);
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
                    importKeys.length === restaurantWaiterSchemaKeys.length &&
                    importKeys.every((item) => restaurantWaiterSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await waiterService.importCollection(records);
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
  registerWaiterAccount,
  getMyWaiter,
  getById,
  updateWaiterInfo,
  updateWaiterStatus,
  waiterListAdmin,
  waiterFoodList,
  waiterFoodSearchInitialData,
  waiterFoodSearch,
  vendorWaiterList,
  cityzenWaiterList,
  exportCollection,
  importCollection,
};

