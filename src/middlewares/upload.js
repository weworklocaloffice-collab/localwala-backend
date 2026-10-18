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

const multer = require('multer');
const fs = require('fs');
const { status: httpStatus } = require('http-status');
const path = require('path');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');

function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getExtensionFromMime(mimeType) {
  const mimeMap = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
  };
  return mimeMap[mimeType] || '';
}

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.folder.public);
  },
  filename: (req, file, cb) => {
    try {
      const extName = path.extname(file.originalname) || getExtensionFromMime(file.mimetype);
      const uniqueFileName = `${randomUUID()}${extName}`;
      cb(null, uniqueFileName);
      // eslint-disable-next-line no-unused-vars
    } catch (_error) {
      cb(new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Error creating unique file name'));
    }
  },
});

const memoryStorage = multer.memoryStorage();

const upload = (storageType = 'local') => {
  const chosenStorage = storageType === 'local' ? diskStorage : memoryStorage;
  return multer({
    storage: chosenStorage,
    limits: { fileSize: config.file.maxUploadSize },
    fileFilter: (req, file, cb) => {
      try {
        const arrFileType = config.file.allowUploadFileType.split(',');
        if (arrFileType.includes(file.mimetype)) {
          cb(null, true);
        } else {
          const arrMimeType = arrFileType.map((type) => type.split('/')[1]);
          cb(
            new ApiError(
              httpStatus.BAD_REQUEST,
              `Only ${arrMimeType.join(', ')} files are allowed!`
            )
          );
        }
        // eslint-disable-next-line no-unused-vars
      } catch (_err) {
        cb(new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'File filter error'));
      }
    },
  });
};

module.exports = upload;

// Content verification: the client-declared mimetype is trivially spoofable,
// so every stored file must match its magic bytes. SVG is XML and can carry
// scripts — it is scanned for active content and rejected on any hit.
// Runs AFTER multer writes (memory or disk); a rejected disk file is deleted.
const sniffHead = (file, max = 512) => {
  if (file.buffer && file.buffer.length) return file.buffer.subarray(0, max);
  if (file.path) {
    const fd = fs.openSync(file.path, 'r');
    try {
      const buf = Buffer.alloc(max);
      const n = fs.readSync(fd, buf, 0, max, 0);
      return buf.subarray(0, n);
    } finally {
      fs.closeSync(fd);
    }
  }
  return Buffer.alloc(0);
};

const verifyUploadedImage = (file) => {
  if (!file) throw new ApiError(httpStatus.BAD_REQUEST, 'Please select a file to upload!');
  const head = sniffHead(file);
  const mime = file.mimetype || '';
  const ok =
    (mime === 'image/jpeg' && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) ||
    (mime === 'image/png' &&
      head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) ||
    (mime === 'image/gif' && head.toString('ascii', 0, 6).startsWith('GIF8')) ||
    (mime === 'image/webp' &&
      head.toString('ascii', 0, 4) === 'RIFF' &&
      head.toString('ascii', 8, 12) === 'WEBP');
  if (mime === 'image/svg+xml') {
    // Active content can hide deep in the file: scan the first 64 KB.
    const text = sniffHead(file, 64 * 1024).toString('utf8').toLowerCase();
    const active = /<script|on\w+\s*=|javascript:|foreignobject|<\?import|data:text\/html/i.test(text);
    if (!active) return;
    if (file.path) fs.unlink(file.path, () => {});
    throw new ApiError(httpStatus.BAD_REQUEST, 'SVG with active content is not allowed');
  }
  if (!ok) {
    if (file.path) fs.unlink(file.path, () => {});
    throw new ApiError(httpStatus.BAD_REQUEST, 'File content does not match its image type');
  }
};

module.exports.verifyUploadedImage = verifyUploadedImage;

