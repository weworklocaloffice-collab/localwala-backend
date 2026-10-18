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
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { subscriberService, subscriptionService } = require('../services');
const { restaurantSubscriberSchemaKey } = require('../utils/importCollectionSchema');

const create = catchAsync(async (req, res) => {
  if (
    req &&
    req.body &&
    req.body.subscription &&
    req.body.subscription !== '' &&
    req.body.subscription !== null
  ) {
    let serverTrailStartDate;
    let serverTrailEndDate;
    let serverStartDate;
    let serverEndDate;
    const subscription = await subscriptionService.getById(req.body.subscription);
    if (subscription && subscription.haveTrial === true) {
      const dateOfSubscription =
        parseInt(subscription.trialValidity, 10) + parseInt(subscription.validity, 10);
      const now = DateTime.now();
      serverTrailStartDate = now.toFormat('yyyy-MM-dd');
      serverTrailEndDate = now.plus({ days: subscription.trialValidity }).toFormat('yyyy-MM-dd');
      serverStartDate = now.plus({ days: subscription.trialValidity }).toFormat('yyyy-MM-dd');
      serverEndDate = now.plus({ days: dateOfSubscription }).toFormat('yyyy-MM-dd');

      const subscriptionData = {
        subscriptions: req.body.subscription,
        restaurant: req.body.restaurant,
        trialStartDate: serverTrailStartDate,
        trialEndDate: serverTrailEndDate,
        startDate: serverStartDate,
        endDate: serverEndDate,
      };
      await subscriberService.createSubscriber(subscriptionData);
    } else {
      const now = DateTime.now();

      serverStartDate = now.toFormat('yyyy-MM-dd');
      serverEndDate = now.plus({ days: subscription.validity }).toFormat('yyyy-MM-dd');

      const subscriptionData = {
        subscriptions: req.body.subscription,
        restaurant: req.body.restaurant,
        trialStartDate: serverTrailStartDate,
        trialEndDate: serverTrailEndDate,
        startDate: serverStartDate,
        endDate: serverEndDate,
      };
      await subscriberService.createSubscriber(subscriptionData);
    }
  }

  res.send('ok');
});

const get = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await subscriberService.getAllSubscriber(options);
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const result = await subscriberService.updateSubscriberById(req.params.subscriberId, req.body);
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  await subscriberService.deleteSubscriberById(req.params.subscriberId);
  res.send({ success: true });
});

const extendSubscriptionDate = catchAsync(async (req, res) => {
  const result = await subscriberService.extendSubscriptionDate(req.body);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await subscriberService.exportCollection(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
        packageId:
          detail &&
          detail.subscriptions &&
          detail.subscriptions.id &&
          detail.subscriptions.id !== null &&
          detail.subscriptions.id !== ''
            ? detail.subscriptions.id
            : 'Unknow',
        packageName:
          detail &&
          detail.subscriptions &&
          detail.subscriptions.name &&
          detail.subscriptions.name !== null &&
          detail.subscriptions.name !== ''
            ? detail.subscriptions.name
            : 'Unknow',
        restaurantName:
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : 'Unknow',
        startDate:
          detail && detail.startDate && detail.startDate !== null && detail.startDate !== ''
            ? DateTime.fromJSDate(new Date(detail.startDate)).toFormat('dd LLL yyyy')
            : '-',
        endDate:
          detail && detail.endDate && detail.endDate !== null && detail.endDate !== ''
            ? DateTime.fromJSDate(new Date(detail.endDate)).toFormat('dd LLL yyyy')
            : '-',
        trialStartDate:
          detail &&
          detail.trialStartDate &&
          detail.trialStartDate !== null &&
          detail.trialStartDate !== ''
            ? DateTime.fromJSDate(new Date(detail.trialStartDate)).toFormat('dd LLL yyyy')
            : '-',
        trialEndDate:
          detail &&
          detail.trialEndDate &&
          detail.trialEndDate !== null &&
          detail.trialEndDate !== ''
            ? DateTime.fromJSDate(new Date(detail.trialEndDate)).toFormat('dd LLL yyyy')
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('PackageSubscriber');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Package Id', key: 'packageId' },
        { header: 'Package Name', key: 'packageName' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Start Date', key: 'startDate' },
        { header: 'End Date', key: 'endDate' },
        { header: 'Trial Start Date', key: 'trialStartDate' },
        { header: 'Trial End Date', key: 'trialEndDate' },
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
        'Package Id':
          detail &&
          detail.subscriptions &&
          detail.subscriptions.id &&
          detail.subscriptions.id !== null &&
          detail.subscriptions.id !== ''
            ? detail.subscriptions.id
            : 'Unknow',
        'Package Name':
          detail &&
          detail.subscriptions &&
          detail.subscriptions.name &&
          detail.subscriptions.name !== null &&
          detail.subscriptions.name !== ''
            ? detail.subscriptions.name
            : 'Unknow',
        'Restaurant Name':
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : 'Unknow',
        'Start Date':
          detail && detail.startDate && detail.startDate !== null && detail.startDate !== ''
            ? DateTime.fromJSDate(new Date(detail.startDate)).toFormat('dd LLL yyyy')
            : '-',
        'End Date':
          detail && detail.endDate && detail.endDate !== null && detail.endDate !== ''
            ? DateTime.fromJSDate(new Date(detail.endDate)).toFormat('dd LLL yyyy')
            : '-',
        'Trial Start Date':
          detail &&
          detail.trialStartDate &&
          detail.trialStartDate !== null &&
          detail.trialStartDate !== ''
            ? DateTime.fromJSDate(new Date(detail.trialStartDate)).toFormat('dd LLL yyyy')
            : '-',
        'Trial End Date':
          detail &&
          detail.trialEndDate &&
          detail.trialEndDate !== null &&
          detail.trialEndDate !== ''
            ? DateTime.fromJSDate(new Date(detail.trialEndDate)).toFormat('dd LLL yyyy')
            : '-',
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await subscriberService.exportRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/subscribers.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'subscribers.json', (err) => {
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
              importKeys.length === restaurantSubscriberSchemaKey.length &&
              importKeys.every((item) => restaurantSubscriberSchemaKey.includes(item));
            if (validSchema) {
              const result = await subscriberService.importCollection(records);
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
                    importKeys.length === restaurantSubscriberSchemaKey.length &&
                    importKeys.every((item) => restaurantSubscriberSchemaKey.includes(item));
                  if (validSchema) {
                    const result = await subscriberService.importCollection(records);
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
  get,
  update,
  drop,
  extendSubscriptionDate,
  exportCollection,
  importCollection,
};

