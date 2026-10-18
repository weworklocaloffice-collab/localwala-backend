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
const { restaurantComplaintsService } = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { restaurantComplaintSchemaKeys } = require('../utils/importCollectionSchema');

const save = catchAsync(async (req, res) => {
  if (req && req.body && req.body.proof && req.body.proof !== '') {
    req.body.proof = req.body.proof.split(',');
  } else {
    req.body.proof = [];
  }
  const result = await restaurantComplaintsService.saveComplaint(req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'status', 'search']);
  const result = await restaurantComplaintsService.getComplaints(options);
  res.send(result);
});

const cityzenComplaints = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'status', 'search']);
  const result = await restaurantComplaintsService.cityzenComplaints(master, options);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, status, search } = req.query;
  const statusName = status === true || status === 'true';
  if (type !== 'raw') {
    const result = await restaurantComplaintsService.exportCollection(statusName, search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Resolved',
        reasonId:
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        reasonName:
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
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
        orderId:
          detail &&
          detail.orderInfo &&
          detail.orderInfo.id &&
          detail.orderInfo.id !== null &&
          detail.orderInfo.id !== ''
            ? detail.orderInfo.id
            : '-',
        restaurantId:
          detail &&
          detail.restaurantInfo &&
          detail.restaurantInfo.id &&
          detail.restaurantInfo.id !== null &&
          detail.restaurantInfo.id !== ''
            ? detail.restaurantInfo.id
            : '-',
        restaurantName:
          detail &&
          detail.restaurantInfo &&
          detail.restaurantInfo.name &&
          detail.restaurantInfo.name !== null &&
          detail.restaurantInfo.name !== ''
            ? detail.restaurantInfo.name
            : '-',
        driverId:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.id &&
          detail.driverInfo.id !== null &&
          detail.driverInfo.id !== ''
            ? detail.driverInfo.id
            : '-',
        driverFirstName:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.firstName &&
          detail.driverInfo.firstName !== null &&
          detail.driverInfo.firstName !== ''
            ? detail.driverInfo.firstName
            : '-',
        driverLastName:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.lastName &&
          detail.driverInfo.lastName !== null &&
          detail.driverInfo.lastName !== ''
            ? detail.driverInfo.lastName
            : '-',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        proof: JSON.stringify(detail.proof),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RestaurantComplaints');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Title', key: 'title' },
        { header: 'Brief', key: 'brief' },
        { header: 'Issue With', key: 'issueWith' },
        { header: 'Proof', key: 'proof' },
        { header: 'Reason Id', key: 'reasonId' },
        { header: 'Reason Name', key: 'reasonName' },
        { header: 'User Id', key: 'userId' },
        { header: 'User First Name', key: 'userFirstName' },
        { header: 'User Last Name', key: 'userLastName' },
        { header: 'Order Id', key: 'orderId' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Deliveryman Id', key: 'driverId' },
        { header: 'Deliveryman First Name', key: 'driverFirstName' },
        { header: 'Deliveryman Last Name', key: 'driverLastName' },
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
        Title: detail.title,
        Brief: detail.brief,
        'Issue With': detail.issueWith,
        Proof: JSON.stringify(detail.proof),
        'Reason Id':
          detail &&
          detail.reasons &&
          detail.reasons.id &&
          detail.reasons.id !== null &&
          detail.reasons.id !== ''
            ? detail.reasons.id
            : '-',
        'Reason Name':
          detail &&
          detail.reasons &&
          detail.reasons.name &&
          detail.reasons.name !== null &&
          detail.reasons.name !== ''
            ? detail.reasons.name
            : '-',
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
        'Order Id':
          detail &&
          detail.orderInfo &&
          detail.orderInfo.id &&
          detail.orderInfo.id !== null &&
          detail.orderInfo.id !== ''
            ? detail.orderInfo.id
            : '-',
        'Restaurant Id':
          detail &&
          detail.restaurantInfo &&
          detail.restaurantInfo.id &&
          detail.restaurantInfo.id !== null &&
          detail.restaurantInfo.id !== ''
            ? detail.restaurantInfo.id
            : '-',
        'Restaurant Name':
          detail &&
          detail.restaurantInfo &&
          detail.restaurantInfo.name &&
          detail.restaurantInfo.name !== null &&
          detail.restaurantInfo.name !== ''
            ? detail.restaurantInfo.name
            : '-',
        'Deliveryman Id':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.id &&
          detail.driverInfo.id !== null &&
          detail.driverInfo.id !== ''
            ? detail.driverInfo.id
            : '-',
        'Deliveryman First Name':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.firstName &&
          detail.driverInfo.firstName !== null &&
          detail.driverInfo.firstName !== ''
            ? detail.driverInfo.firstName
            : '-',
        'Deliveryman Last Name':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.lastName &&
          detail.driverInfo.lastName !== null &&
          detail.driverInfo.lastName !== ''
            ? detail.driverInfo.lastName
            : '-',
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status ? 'Active' : 'Resolved',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await restaurantComplaintsService.exportRawCollection(statusName, search);
    const downloadPath = path.join(__dirname, `../templates/downloads/restaurantcomplaints.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'restaurantcomplaints.json', (err) => {
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
              importKeys.length === restaurantComplaintSchemaKeys.length &&
              importKeys.every((item) => restaurantComplaintSchemaKeys.includes(item));
            if (validSchema) {
              const result = await restaurantComplaintsService.importCollection(records);
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
                    importKeys.length === restaurantComplaintSchemaKeys.length &&
                    importKeys.every((item) => restaurantComplaintSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await restaurantComplaintsService.importCollection(records);
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
  save,
  get,
  cityzenComplaints,
  exportCollection,
  importCollection,
};

