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
const { foodService, subscriptionTiffinPackageService } = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { tiffinSubscriptionPackageSchemaKeys } = require('../utils/importCollectionSchema');

const create = catchAsync(async (req, res) => {
  if (req && req.body && req.body.foods && req.body.foods !== '') {
    req.body.foods = req.body.foods.split(',');
  } else {
    req.body.foods = [];
  }
  if (req && req.body && req.body.offDays && req.body.offDays !== '') {
    req.body.offDays = req.body.offDays.split(',');
  } else {
    req.body.offDays = [];
  }
  const result = await subscriptionTiffinPackageService.createPackage(req.body);
  res.send(result);
});

const updatePackage = catchAsync(async (req, res) => {
  const { id } = req.params;
  if (req && req.body && req.body.foods && req.body.foods !== '') {
    req.body.foods = req.body.foods.split(',');
  } else {
    req.body.foods = [];
  }
  if (req && req.body && req.body.offDays && req.body.offDays !== '') {
    req.body.offDays = req.body.offDays.split(',');
  } else {
    req.body.offDays = [];
  }
  const result = await subscriptionTiffinPackageService.updatePackage(id, req.body);
  res.send(result);
});

const updatePackageStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await subscriptionTiffinPackageService.updatePackageStatus(id, req.body);
  res.send(result);
});

const getBasic = catchAsync(async (req, res) => {
  const { restaurant } = req.params;
  const result = await foodService.getFoodListForSubscription(restaurant);
  res.send(result);
});

const getMyPackagesList = catchAsync(async (req, res) => {
  const { restaurant } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await subscriptionTiffinPackageService.getSubscriptionPackageListVendor(
    restaurant,
    options
  );
  res.send(result);
});

const getSubscriptionPackageListAdmin = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await subscriptionTiffinPackageService.getSubscriptionPackageListAdmin(options);
  res.send(result);
});

const cityzenPackageList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await subscriptionTiffinPackageService.cityzenPackageList(master, options);
  res.send(result);
});

const getById = catchAsync(async (req, res) => {
  const { id, restaurant } = req.params;
  const result = await subscriptionTiffinPackageService.getById(id, restaurant);
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  const { id } = req.params;
  await subscriptionTiffinPackageService.deletePackage(id);
  res.send({ success: true });
});

const getSubscriptionPackageDetailCustomer = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await subscriptionTiffinPackageService.getSubscriptionPackageDetailCustomer(id);
  res.send(result);
});

const buySubscriptionDetails = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await subscriptionTiffinPackageService.buySubscriptionDetails(id);
  res.send(result);
});

const getSubscriptionPackageFromVendor = catchAsync(async (req, res) => {
  const { restaurant } = req.body;
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await subscriptionTiffinPackageService.getSubscriptionPackageFromVendor(
    restaurant,
    options
  );
  res.send(result);
});

const vendorTiffinPackageList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await subscriptionTiffinPackageService.vendorTiffinPackageList(options);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await subscriptionTiffinPackageService.exportCollection(search);
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
        discountType: detail.discountType === '%' ? 'Percentage' : 'Amount',
        canSelectAddon: detail.canSelectAddon ? 'Yes' : 'No',
        canSelectVariation: detail.canSelectVariation ? 'Yes' : 'No',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('SubscriptionTiffinPackage');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Short Description', key: 'shortDescription' },
        { header: 'Image', key: 'image' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Price', key: 'price' },
        { header: 'Discount Type', key: 'discountType' },
        { header: 'Discount', key: 'discount' },
        { header: 'Foods In Package', key: 'foodCount' },
        { header: 'Available', key: 'available' },
        { header: 'Order To', key: 'orderTo' },
        { header: 'Delivery Area', key: 'deliveryArea' },
        { header: 'Interval', key: 'interval' },
        { header: 'Total Order', key: 'totalOrder' },
        { header: 'Can Select Addon', key: 'canSelectAddon' },
        { header: 'Can Select Variation', key: 'canSelectVariation' },
        { header: 'Off Days', key: 'offDayCount' },
        { header: 'Total Purchase', key: 'totalPurchase' },
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
        Name: detail.name,
        'Short Description': detail.shortDescription,
        Image: detail.image,
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
        Price: detail.price,
        'Discount Type': detail.discountType === '%' ? 'Percentage' : 'Amount',
        Discount: detail.discount,
        'Foods In Package': detail.foodCount,
        Available: detail.available,
        'Order To': detail.orderTo,
        'Delivery Area': detail.deliveryArea,
        Interval: detail.interval,
        'Total Order': detail.totalOrder,
        'Can Select Addon': detail.canSelectAddon ? 'Yes' : 'No',
        'Can Select Variation': detail.canSelectVariation ? 'Yes' : 'No',
        'Off Days': detail.offDayCount,
        'Total Purchase': detail.totalPurchase,
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await subscriptionTiffinPackageService.exportRawCollection(search);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/subscriptiontiffinpackages.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'subscriptiontiffinpackages.json', (err) => {
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
              importKeys.length === tiffinSubscriptionPackageSchemaKeys.length &&
              importKeys.every((item) => tiffinSubscriptionPackageSchemaKeys.includes(item));
            if (validSchema) {
              const result = await subscriptionTiffinPackageService.importCollection(records);
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
                    importKeys.length === tiffinSubscriptionPackageSchemaKeys.length &&
                    importKeys.every((item) => tiffinSubscriptionPackageSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await subscriptionTiffinPackageService.importCollection(records);
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
  updatePackage,
  updatePackageStatus,
  getBasic,
  getById,
  getMyPackagesList,
  getSubscriptionPackageListAdmin,
  drop,
  getSubscriptionPackageDetailCustomer,
  buySubscriptionDetails,
  getSubscriptionPackageFromVendor,
  vendorTiffinPackageList,
  cityzenPackageList,
  exportCollection,
  importCollection,
};

