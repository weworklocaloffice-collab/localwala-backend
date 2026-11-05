/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright c 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential. Unauthorized copying, redistribution, resale,
 * publication, modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const { status: httpStatus } = require('http-status');
const config = require('../../../config/config');
const catchAsync = require('../../../utils/catchAsync');
const { parseImportFile, sendError } = require('../../../utils/importFile');
const uploadMiddleware = require('../../../middlewares/upload');
const importService = require('../services/stores.admin.taxonomy.import.service');

/**
 * Taxonomy import/export transport.
 *
 * Parsing lives here because it is a transport concern: CSV and XLSX are two
 * encodings of the same rows, and the service should not know which one arrived.
 * The service owns every business rule and both files end at the same
 * `importCollection(collection, records, headers)` call.
 *
 * Multer's callback is asynchronous, so a rejected service call inside it would
 * escape `catchAsync`. This handler therefore owns its try/catch and always
 * removes the temporary upload, including on the error path.
 */

const importCollection = (req, res) => {
  const upload = uploadMiddleware('local');

  upload.single('file')(req, res, async (uploadError) => {
    const cleanup = async () => {
      if (!req.file || !req.file.path) return;
      await fs.promises.unlink(req.file.path).catch(() => {});
    };

    try {
      if (uploadError) {
        if (uploadError instanceof multer.MulterError) {
          const message =
            uploadError.code === 'LIMIT_FILE_SIZE'
              ? `Maximum file size is ${config.file.maxUploadSize / (1024 * 1024)} MB`
              : uploadError.message;
          return res.status(httpStatus.BAD_REQUEST).send({
            code: httpStatus.BAD_REQUEST,
            message,
            extra: config.file.maxUploadSize / (1024 * 1024),
          });
        }
        throw uploadError;
      }

      if (!req.file) {
        return res.status(httpStatus.BAD_REQUEST).send({
          code: httpStatus.BAD_REQUEST,
          message: 'Please select a file to upload',
          extra: '',
        });
      }

      const extension = path.extname(req.file.originalname || req.file.path).toLowerCase();
      const parsed = await parseImportFile(req.file.path, extension);
      if (!parsed) {
        return res.status(httpStatus.BAD_REQUEST).send({
          code: httpStatus.BAD_REQUEST,
          message: 'Only .csv and .xlsx files are supported',
          extra: '',
        });
      }

      const result = await importService.importCollection(
        req.params.collection,
        parsed.records,
        parsed.headers
      );

      return res.send({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    } finally {
      await cleanup();
    }
  });
};

const exportCollection = catchAsync(async (req, res) => {
  const collection = req.params.collection;
  const type = req.query.type || 'csv';
  const { keys, rows } = await importService.exportCollection(collection);

  if (type === 'raw') {
    res.setHeader('Content-Disposition', `attachment; filename=${collection}.json`);
    res.setHeader('Content-Type', 'application/json');
    return res.send(rows);
  }

  if (type === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');

    worksheet.addRow(keys);
    worksheet.getRow(1).font = { bold: true };
    keys.forEach((key, index) => {
      worksheet.getColumn(index + 1).width = Math.max(16, key.length + 6);
    });

    rows.forEach((row) => {
      worksheet.addRow(keys.map((key) => row[key]));
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${collection}.xlsx`);
    await workbook.xlsx.write(res);
    return res.end();
  }

  const lines = [keys.join(',')];
  if (rows.length) {
    lines.push(
      Papa.unparse(rows, {
        columns: keys,
        header: false,
        newline: '\n',
      })
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${collection}.csv`);
  return res.send(lines.join('\n'));
});

module.exports = {
  importCollection,
  exportCollection,
};
