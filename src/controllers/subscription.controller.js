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
const { subscriptionService } = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { subscriptionPackageSchemaKeys } = require('../utils/importCollectionSchema');

const create = catchAsync(async (req, res) => {
  const result = await subscriptionService.createSubscriptions(req.body);
  res.send(result);
});

const getAdminSubscriptionList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await subscriptionService.getAdminSubscriptionList(options);
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const result = await subscriptionService.updateSubscriptionById(
    req.params.subscriptionId,
    req.body
  );
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  await subscriptionService.deleteSubscriptionById(req.params.subscriptionId);
  res.send({ success: true });
});

const getById = catchAsync(async (req, res) => {
  const result = await subscriptionService.getById(req.params.subscriptionId);
  res.send(result);
});

const updateStatus = catchAsync(async (req, res) => {
  const result = await subscriptionService.updateStatus(req.params.subscriptionId, req.body);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await subscriptionService.exportCollection(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
        haveTrial: detail.haveTrial ? 'Yes' : 'No',
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
        productLimit: detail.productLimit !== -1 ? detail.productLimit : 'Unlimited',
        orderLimit: detail.orderLimit !== -1 ? detail.orderLimit : 'Unlimited',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('SubscriptionPackages');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Slug', key: 'slug' },
        { header: 'Price', key: 'price' },
        { header: 'Discount', key: 'discount' },
        { header: 'Commission', key: 'commission' },
        { header: 'Validity', key: 'validity' },
        { header: 'Have Trial', key: 'haveTrial' },
        { header: 'Trial Validity', key: 'trialValidity' },
        { header: 'Product Limit', key: 'productLimit' },
        { header: 'Order Limit', key: 'orderLimit' },
        { header: 'Icon', key: 'icon' },
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
        Slug: detail.slug,
        Price: detail.price,
        Discount: detail.discount,
        Commission: detail.commission,
        Validity: detail.validity,
        'Have Trial': detail.haveTrial ? 'Yes' : 'No',
        'Trial Validity': detail.trialValidity,
        'Product Limit': detail.productLimit !== -1 ? detail.productLimit : 'Unlimited',
        'Order Limit': detail.orderLimit !== -1 ? detail.orderLimit : 'Unlimited',
        Icon: detail.icon,
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
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await subscriptionService.exportRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/subscriptions.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'subscriptions.json', (err) => {
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
              importKeys.length === subscriptionPackageSchemaKeys.length &&
              importKeys.every((item) => subscriptionPackageSchemaKeys.includes(item));
            if (validSchema) {
              const result = await subscriptionService.importCollection(records);
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
                    importKeys.length === subscriptionPackageSchemaKeys.length &&
                    importKeys.every((item) => subscriptionPackageSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await subscriptionService.importCollection(records);
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
  update,
  drop,
  getById,
  updateStatus,
  getAdminSubscriptionList,
  exportCollection,
  importCollection,
};

