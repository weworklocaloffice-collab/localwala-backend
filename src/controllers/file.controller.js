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
const path = require('path');
const multer = require('multer');
const { Storage } = require('@google-cloud/storage');
const { BlobServiceClient } = require('@azure/storage-blob');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const config = require('../config/config');
const { mediaService, mediaStorageSettingService } = require('../services');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const uploadMiddleware = require('../middlewares/upload');

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

const uploadImage = catchAsync(async (req, res) => {
  try {
    const mediaSetting = await mediaStorageSettingService.getMediaStorageSetting();
    let storageType = 'local';
    let gcsProjectIdCreds = '';
    let gcsBucketNameCreds = '';
    let azureConnectionStringCreds = '';
    let azureContainerNameCreds = '';
    let awsAccessKeyCreds = '';
    let awsRegionNameCreds = '';
    let awsSecretKeyCreds = '';
    let awsBucketNameCreds = '';

    if (mediaSetting && mediaSetting.id) {
      storageType = mediaSetting.name;
      const {
        gcsProjectId,
        gcsBucketName,
        azureConnectionString,
        azureContainerName,
        awsAccessKey,
        awsRegionName,
        awsSecretKey,
        awsBucketName,
      } = mediaSetting.credentials;
      gcsProjectIdCreds = gcsProjectId;
      gcsBucketNameCreds = gcsBucketName;
      azureConnectionStringCreds = azureConnectionString;
      azureContainerNameCreds = azureContainerName;
      awsAccessKeyCreds = awsAccessKey;
      awsRegionNameCreds = awsRegionName;
      awsSecretKeyCreds = awsSecretKey;
      awsBucketNameCreds = awsBucketName;
    }
    const upload = uploadMiddleware(storageType);

    upload.single('fileName')(req, res, async (err) => {
      try {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            const sizeCount = config.file.maxUploadSize / (1024 * 1024);
            throw new ApiError(httpStatus.BAD_REQUEST, `Maximum file size is ${sizeCount} MB`);
          }
          throw new ApiError(httpStatus.BAD_REQUEST, err.message);
        }
        if (err) throw new ApiError(httpStatus.BAD_REQUEST, err.message);
        if (!req.file) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Please select a file to upload!');
        }
        // Enterprise attachment policy: magic-byte + active-content check on
        // the stored bytes, not the client header. Rejects delete the file.
        uploadMiddleware.verifyUploadedImage(req.file);
        let uploadedPath = '';
        if (storageType === 'gcs') {
          // GCS Upload
          // Google Cloud setup
          const gcs = new Storage({
            projectId: `${gcsProjectIdCreds}`,
            keyFilename: path.join(__dirname, '../fcm_keys/serviceAccountKey.json'),
          });
          const bucket = gcs.bucket(`${gcsBucketNameCreds}`);
          const { file } = req;
          const ext = getExtensionFromMime(file.mimetype);
          const uniqueFileName = `${randomUUID()}${ext}`;
          const blob = bucket.file(uniqueFileName);
          const blobStream = blob.createWriteStream({
            resumable: false,
            contentType: file.mimetype,
          });
          blobStream.on('error', (error) => {
            res
              .status(500)
              .send({ code: 500, message: 'Error uploading file to GCS', extra: error.message });
          });
          blobStream.on('finish', async () => {
            try {
              uploadedPath = `${blob.name}`;
              await mediaService.createMedia({
                path: uploadedPath,
                uid: req && req.body && req.body.uid && req.body.uid !== null ? req.body.uid : null,
              });
              res.status(200).send({ path: uploadedPath });
            } catch (dbErr) {
              res.status(500).send({
                code: 500,
                message: 'File uploaded but DB save failed',
                extra: dbErr.message,
              });
            }
          });
          blobStream.end(file.buffer);
        } else if (storageType === 'azure') {
          const { file } = req;
          const ext = getExtensionFromMime(file.mimetype);
          const uniqueFileName = `${randomUUID()}${ext}`;

          try {
            const blobServiceClient = BlobServiceClient.fromConnectionString(
              azureConnectionStringCreds
            );
            const containerClient = blobServiceClient.getContainerClient(azureContainerNameCreds);
            const containerExists = await containerClient.exists();
            if (!containerExists) {
              await containerClient.create({ access: 'container' });
            }

            const blockBlobClient = containerClient.getBlockBlobClient(uniqueFileName);
            await blockBlobClient.uploadData(file.buffer, {
              blobHTTPHeaders: { blobContentType: file.mimetype },
            });

            // const publicUrl = blockBlobClient.url;
            await mediaService.createMedia({
              path: `${uniqueFileName}`,
              uid: req && req.body && req.body.uid && req.body.uid !== null ? req.body.uid : null,
            });
            return res.status(200).send({ path: `${uniqueFileName}` });
            // eslint-disable-next-line no-unused-vars
          } catch (azureErr) {
            throw new ApiError(
              httpStatus.INTERNAL_SERVER_ERROR,
              `Error uploading file to Azure Blob`
            );
          }
        } else if (storageType === 'aws_s3') {
          // AWS SDK v3
          const { file } = req;
          const ext = getExtensionFromMime(file.mimetype);
          const uniqueFileName = `${randomUUID()}${ext}`;

          const s3 = new S3Client({
            region: awsRegionNameCreds,
            credentials: {
              accessKeyId: awsAccessKeyCreds,
              secretAccessKey: awsSecretKeyCreds,
            },
          });
          const key = `images/${uniqueFileName}`;
          try {
            const command = new PutObjectCommand({
              Bucket: awsBucketNameCreds,
              Key: key,
              Body: file.buffer,
              ContentType: file.mimetype,
            });

            await s3.send(command);

            await mediaService.createMedia({
              path: key,
              uid: req && req.body && req.body.uid && req.body.uid !== null ? req.body.uid : null,
            });

            return res.status(200).send({ path: key });
          } catch (awsErr) {
            throw new ApiError(
              httpStatus.INTERNAL_SERVER_ERROR,
              `Error uploading file to AWS S3: ${awsErr.message}`
            );
          }
        } else if (storageType === 'local') {
          // LOCAL Upload
          const locationName = req.file.path;
          uploadedPath = locationName.replace('public/', '');
          await mediaService.createMedia({
            path: uploadedPath,
            uid: req && req.body && req.body.uid && req.body.uid !== null ? req.body.uid : null,
          });
          res.status(200).send({ path: uploadedPath });
        }
      } catch (innerErr) {
        res
          .status(innerErr.statusCode || httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: innerErr.message, extra: '' });
      }
    });
  } catch (outerErr) {
    res
      .status(outerErr.statusCode || httpStatus.INTERNAL_SERVER_ERROR)
      .send({ code: 400, message: outerErr.message || 'Unexpected error', extra: '' });
  }
});

module.exports = {
  uploadImage,
};

