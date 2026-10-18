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
const folderPath = require('path');
const { DateTime } = require('luxon');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { mediaService } = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { mediaFileSchemaKeys } = require('../utils/importCollectionSchema');

const drop = catchAsync(async (req, res) => {
  await mediaService.dropFile(req.params.path);
  res.send({ success: true });
});

const get = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await mediaService.getMediaListForAdminDialog(options);
  res.send(result);
});

const getVendorMedia = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await mediaService.getMediaListForVendorDialog(req.params.userId, options);
  res.send(result);
});

const cityzenMediaDialog = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await mediaService.cityzenMediaDialog(req.params.userId, options);
  res.send(result);
});

const dropUserMedia = catchAsync(async (req, res) => {
  const { path, uid } = req.body;
  const result = await mediaService.dropUserMediaFile(path, uid);
  res.send(result);
});

const getMediaListAdmin = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await mediaService.getMediaListAdmin(options);
  res.send(result);
});

const cityzenMediaFiles = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await mediaService.cityzenMediaFiles(master, options);
  res.send(result);
});

const getMyMediaFiles = catchAsync(async (req, res) => {
  const { uid } = req.params;
  const result = await mediaService.getMyMediaFiles(uid);
  res.send(result);
});

const customerMediaFiles = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await mediaService.customerMediaFiles(options);
  res.send(result);
});

const vendorMediaFiles = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await mediaService.vendorMediaFiles(options);
  res.send(result);
});

const deliverymanMediaFiles = catchAsync(async (req, res) => {
  const options = pick(req.query, ['deliveryman', 'limit', 'page']);
  const result = await mediaService.deliverymanMediaFiles(options);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type } = req.params;
  if (type !== 'raw') {
    const result = await mediaService.exportCollection();
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        createdOn: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
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
        userImage:
          detail &&
          detail.userInfo &&
          detail.userInfo.image &&
          detail.userInfo.image !== null &&
          detail.userInfo.image !== ''
            ? detail.userInfo.image
            : '-',
        userRole:
          detail &&
          detail.userInfo &&
          detail.userInfo.role &&
          detail.userInfo.role !== null &&
          detail.userInfo.role !== ''
            ? detail.userInfo.role
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Medias');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Path', key: 'path' },
        { header: 'User Id', key: 'userId' },
        { header: 'User First Name', key: 'userFirstName' },
        { header: 'User Last Name', key: 'userLastName' },
        { header: 'User Image', key: 'userImage' },
        { header: 'User Role', key: 'userRole' },
        { header: 'Uploaded At', key: 'createdOn' },
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
        Path: detail.path,
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
        'User Image':
          detail &&
          detail.userInfo &&
          detail.userInfo.image &&
          detail.userInfo.image !== null &&
          detail.userInfo.image !== ''
            ? detail.userInfo.image
            : '-',
        'User Role':
          detail &&
          detail.userInfo &&
          detail.userInfo.role &&
          detail.userInfo.role !== null &&
          detail.userInfo.role !== ''
            ? detail.userInfo.role
            : '-',
        'Uploaded At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await mediaService.exportRawCollection();
    const downloadPath = folderPath.join(__dirname, `../templates/downloads/media.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'media.json', (err) => {
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
          const ext = folderPath.extname(req.file.originalname).toLowerCase();
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
              importKeys.length === mediaFileSchemaKeys.length &&
              importKeys.every((item) => mediaFileSchemaKeys.includes(item));
            if (validSchema) {
              const result = await mediaService.importCollection(records);
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
                    importKeys.length === mediaFileSchemaKeys.length &&
                    importKeys.every((item) => mediaFileSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await mediaService.importCollection(records);
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
  drop,
  get,
  getVendorMedia,
  dropUserMedia,
  getMediaListAdmin,
  getMyMediaFiles,
  customerMediaFiles,
  vendorMediaFiles,
  deliverymanMediaFiles,
  cityzenMediaDialog,
  cityzenMediaFiles,
  exportCollection,
  importCollection,
};

