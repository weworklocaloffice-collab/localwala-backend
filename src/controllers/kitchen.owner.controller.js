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
const { userService, walletService, kitchenOwnerService } = require('../services');
const { Wallet } = require('../models');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { restaurantKitchenOwnerSchemaKeys } = require('../utils/importCollectionSchema');

const registerKitchenOwnerAccount = catchAsync(async (req, res) => {
  const user = await userService.createKitchenAccount(req.body);
  const walletData = new Wallet({
    holderId: user.id,
  });
  await walletService.createWallet(walletData);
  req.body.userId = user.id;
  await kitchenOwnerService.createKitchenOwner(req.body);
  res.status(201).send({ success: true });
});

const getKitchenOwners = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await kitchenOwnerService.getAllVendorKitchenOwner(req.params.restaurant, options);
  res.send(result);
});

const getById = catchAsync(async (req, res) => {
  const { kitchenId } = req.params;
  const info = await kitchenOwnerService.getById(kitchenId);
  res.send(info);
});

const updateKitchenOwnerInfo = catchAsync(async (req, res) => {
  const { userId } = req.params;
  const info = await kitchenOwnerService.updateKitchenOwnerInfo(userId, req.body);
  res.send(info);
});

const updateKitchenOwnerStatus = catchAsync(async (req, res) => {
  const { kitchenId } = req.params;
  const { status } = req.body;
  const info = await kitchenOwnerService.updateKitchenOwnerStatus(kitchenId, status);
  res.send(info);
});

const kitchenOwnerListAdmin = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await kitchenOwnerService.kitchenOwnerListAdmin(options);
  res.send(result);
});

const cityzenKitchenOwnerList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await kitchenOwnerService.cityzenKitchenOwnerList(master, options);
  res.send(result);
});

const vendorKitchenOwnerList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await kitchenOwnerService.vendorKitchenOwnerList(options);
  res.send(result);
});

const kitchenOrder = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const { owner, status } = req.body;
  const result = await kitchenOwnerService.kitchenOrder(owner, status, options);
  res.send(result);
});

const preparingKitchenOrder = catchAsync(async (req, res) => {
  const { order, owner } = req.params;
  const result = await kitchenOwnerService.preparingKitchenOrder(order, owner);
  res.send(result);
});

const completeKitchenOrder = catchAsync(async (req, res) => {
  const { order, owner } = req.params;
  const result = await kitchenOwnerService.completeKitchenOrder(order, owner);
  res.send(result);
});

const kitchenOrderDetail = catchAsync(async (req, res) => {
  const { order, owner } = req.params;
  const result = await kitchenOwnerService.kitchenOrderDetail(order, owner);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await kitchenOwnerService.exportCollection(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        ownerId:
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.id &&
          detail.ownerInfo.id !== null &&
          detail.ownerInfo.id !== ''
            ? detail.ownerInfo.id
            : '-',
        ownerFirstName:
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.firstName &&
          detail.ownerInfo.firstName !== null &&
          detail.ownerInfo.firstName !== ''
            ? detail.ownerInfo.firstName
            : '-',
        ownerLastName:
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.lastName &&
          detail.ownerInfo.lastName !== null &&
          detail.ownerInfo.lastName !== ''
            ? detail.ownerInfo.lastName
            : '-',
        ownerImage:
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.image &&
          detail.ownerInfo.image !== null &&
          detail.ownerInfo.image !== ''
            ? detail.ownerInfo.image
            : '-',
        ownerCountryCode:
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.countryCode &&
          detail.ownerInfo.countryCode !== null &&
          detail.ownerInfo.countryCode !== ''
            ? detail.ownerInfo.countryCode
            : '-',
        ownerMobile:
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.mobile &&
          detail.ownerInfo.mobile !== null &&
          detail.ownerInfo.mobile !== ''
            ? detail.ownerInfo.mobile
            : '-',
        ownerEmail:
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.email &&
          detail.ownerInfo.email !== null &&
          detail.ownerInfo.email !== ''
            ? detail.ownerInfo.email
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
      const worksheet = workbook.addWorksheet('RestaurantKitchenOwners');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Owner Id', key: 'ownerId' },
        { header: 'First Name', key: 'ownerFirstName' },
        { header: 'Last Name', key: 'ownerLastName' },
        { header: 'Country Code', key: 'ownerCountryCode' },
        { header: 'Mobile', key: 'ownerMobile' },
        { header: 'Email', key: 'ownerEmail' },
        { header: 'Owner Image', key: 'ownerImage' },
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
        'Owner Id':
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.id &&
          detail.ownerInfo.id !== null &&
          detail.ownerInfo.id !== ''
            ? detail.ownerInfo.id
            : '-',
        'First Name':
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.firstName &&
          detail.ownerInfo.firstName !== null &&
          detail.ownerInfo.firstName !== ''
            ? detail.ownerInfo.firstName
            : '-',
        'Last Name':
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.lastName &&
          detail.ownerInfo.lastName !== null &&
          detail.ownerInfo.lastName !== ''
            ? detail.ownerInfo.lastName
            : '-',
        'Country Code':
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.countryCode &&
          detail.ownerInfo.countryCode !== null &&
          detail.ownerInfo.countryCode !== ''
            ? detail.ownerInfo.countryCode
            : '-',
        Mobile:
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.mobile &&
          detail.ownerInfo.mobile !== null &&
          detail.ownerInfo.mobile !== ''
            ? detail.ownerInfo.mobile
            : '-',
        Email:
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.email &&
          detail.ownerInfo.email !== null &&
          detail.ownerInfo.email !== ''
            ? detail.ownerInfo.email
            : '-',
        'Owner Image':
          detail &&
          detail.ownerInfo &&
          detail.ownerInfo.image &&
          detail.ownerInfo.image !== null &&
          detail.ownerInfo.image !== ''
            ? detail.ownerInfo.image
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
    const result = await kitchenOwnerService.exportRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/kitchenowners.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'kitchenowners.json', (err) => {
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
              importKeys.length === restaurantKitchenOwnerSchemaKeys.length &&
              importKeys.every((item) => restaurantKitchenOwnerSchemaKeys.includes(item));
            if (validSchema) {
              const result = await kitchenOwnerService.importCollection(records);
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
                    importKeys.length === restaurantKitchenOwnerSchemaKeys.length &&
                    importKeys.every((item) => restaurantKitchenOwnerSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await kitchenOwnerService.importCollection(records);
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
  registerKitchenOwnerAccount,
  getKitchenOwners,
  getById,
  updateKitchenOwnerInfo,
  updateKitchenOwnerStatus,
  kitchenOwnerListAdmin,
  cityzenKitchenOwnerList,
  vendorKitchenOwnerList,
  kitchenOrder,
  preparingKitchenOrder,
  completeKitchenOrder,
  kitchenOrderDetail,
  exportCollection,
  importCollection,
};

