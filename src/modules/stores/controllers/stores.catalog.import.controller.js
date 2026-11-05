/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
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
const { status: httpStatus } = require('http-status');
const config = require('../../../config/config');
const { parseImportFile, sendError } = require('../../../utils/importFile');
const uploadMiddleware = require('../../../middlewares/upload');
const importService = require('../services/stores.catalog.import.service');

/**
 * Product import transport. Business rules and the brand-request side effect
 * live in `stores.catalog.import.service`.
 */
const importProducts = (req, res) => {
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

      const result = await importService.importProducts({
        chain: req.chain,
        by: req.user._id,
        records: parsed.records,
        headers: parsed.headers,
      });

      return res.send({ success: true, ...result });
    } catch (error) {
      return sendError(res, error);
    } finally {
      await cleanup();
    }
  });
};

module.exports = {
  importProducts,
};
