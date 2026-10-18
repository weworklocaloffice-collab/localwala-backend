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

const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { status: httpStatus } = require('http-status');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const Reel = require('../../../models/reel.model');
const { MediaStorageSetting } = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');

const UPLOAD_TTL_SEC = 15 * 60;
const MAX_RAW_BYTES = 200 * 1024 * 1024; // 30s of 9:16 phone video fits comfortably
const ALLOWED_CONTENT_TYPES = ['video/mp4'];
const RAW_PREFIX = 'reels/raw';
const RENDITION_PREFIX = 'reels/renditions';

// Singleton row (media.storage.setting.service enforces one). Expected shape:
// credentials: { provider: 's3', region, bucket, accessKeyId, secretAccessKey,
//                keyPrefix?, cdnBaseUrl? }
const getStorageConfig = async () => {
  const row = await MediaStorageSetting.findOne().lean();
  const credentials = (row && row.credentials) || {};
  const provider = credentials.provider || (row && row.name === 'aws_s3' ? 's3' : '');
  const region = credentials.region || credentials.awsRegionName || '';
  const bucket = credentials.bucket || credentials.awsBucketName || '';
  const accessKeyId = credentials.accessKeyId || credentials.awsAccessKey || '';
  const secretAccessKey = credentials.secretAccessKey || credentials.awsSecretKey || '';
  const cdnBaseUrl = credentials.cdnBaseUrl || '';
  const keyPrefix = credentials.keyPrefix || '';
  const missing = [region, bucket, accessKeyId, secretAccessKey].filter((v) => !v);
  if (!row || !provider || provider !== 's3' || missing.length) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      `Reel storage is not configured${missing.length ? `: missing ${missing.join(', ')}` : ''}. ` +
        'Set the media storage setting with provider "s3".'
    );
  }
  return {
    provider,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    cdnBaseUrl,
    keyPrefix,
  };
};

const buildS3Client = (cfg) =>
  new S3Client({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });

const publicUrlFor = (cfg, key) =>
  cfg.cdnBaseUrl
    ? `${cfg.cdnBaseUrl.replace(/\/$/, '')}/${key}`
    : `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`;

// Step 1 of the pipeline: hand the admin panel a short-lived PUT URL so the
// raw bytes never transit the API process.
const createUploadUrl = async ({ contentType, sizeBytes }) => {
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Only ${ALLOWED_CONTENT_TYPES.join(', ')} uploads are allowed`
    );
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_RAW_BYTES) {
    throw new ApiError(httpStatus.BAD_REQUEST, `sizeBytes must be between 1 and ${MAX_RAW_BYTES}`);
  }
  const cfg = await getStorageConfig();
  const key = `${RAW_PREFIX}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.mp4`;
  const url = await getSignedUrl(
    buildS3Client(cfg),
    new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType }),
    { expiresIn: UPLOAD_TTL_SEC }
  );
  return { uploadUrl: url, key, expiresIn: UPLOAD_TTL_SEC };
};

// Step 2: confirm the bytes landed (HeadObject), then mark the reel PROCESSING
// for the transcode poller. The reel itself is created via POST /admin/reels.
const finalizeUpload = async (reelId, key) => {
  const reel = await Reel.findById(reelId);
  if (!reel) throw new ApiError(httpStatus.NOT_FOUND, 'Reel not found');
  if (!key || !key.startsWith(`${RAW_PREFIX}/`)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown upload key');
  }
  const cfg = await getStorageConfig();
  try {
    await buildS3Client(cfg).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    // eslint-disable-next-line no-unused-vars
  } catch (_err) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Upload not received yet — finish the S3 upload first'
    );
  }
  reel.status = 'PROCESSING';
  reel.media = reel.media || {};
  reel.media.sourceKey = key;
  reel.processing = { stage: 'PROCESSING', progress: 10, error: undefined };
  await reel.save();
  return reel;
};

const runFfmpeg = (args) =>
  new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', ...args], (error, _stdout, stderr) => {
      if (error) {
        const err = new Error(`ffmpeg failed: ${String(stderr).slice(-500)}`);
        err.cause = error;
        return reject(err);
      }
      return resolve();
    });
  });

const streamToFile = async (client, bucket, key, dest) =>
  new Promise((resolve, reject) => {
    client
      .send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      .then((res) => {
        const out = fs.createWriteStream(dest);
        res.Body.pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
      })
      .catch(reject);
  });

const uploadFileToS3 = async (buffer, contentType, keyPrefix = RAW_PREFIX) => {
  const cfg = await getStorageConfig();
  const key = `${keyPrefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.mp4`;
  await buildS3Client(cfg).send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return { key, bucket: cfg.bucket, region: cfg.region };
};

const onlyPresent = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  return value;
};
const onlyObjectId = (value) => {
  const cleaned = onlyPresent(value);
  if (!cleaned) return undefined;
  if (typeof cleaned !== 'string' || !/^[0-9a-f]{24}$/i.test(cleaned)) return undefined;
  return cleaned;
};

const uploadProxy = async ({ file, reelId, vertical, target, caption, hashtags, cta, cityId, localityId, adminId }) => {
  try {
    if (!file || !file.buffer) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'video/mp4 file is required');
    }
    if (file.mimetype !== 'video/mp4') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Only video/mp4 uploads are allowed');
    }
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_RAW_BYTES) {
      throw new ApiError(httpStatus.BAD_REQUEST, `video must be between 1 byte and ${MAX_RAW_BYTES} bytes`);
    }
    const resolvedReelId = reelId || undefined;
    let finalReelId = resolvedReelId;
    if (!finalReelId) {
      if (!vertical || !target || !target.type || !target.refId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'vertical and target are required to create a new reel');
      }
      if (!adminId) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'Admin identity is required to create a new reel');
      }
      const cleanedTarget = {
        type: target.type,
        refId: onlyPresent(target.refId),
      };
      if (!cleanedTarget.refId) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'target.refId is required');
      }
      logger.info('[reels] upload proxy creating reel', { vertical, target: cleanedTarget, adminId });
      const reel = await require('./reels.admin.service').createReel(adminId, {
        videoUrl: 'pending://upload',
        caption: caption || '',
        hashtags: hashtags || [],
        vertical,
        target: cleanedTarget,
        cta: cta || undefined,
        cityId: onlyObjectId(cityId) || undefined,
        localityId: onlyObjectId(localityId) || undefined,
      });
      finalReelId = String(reel._id);
    }
    logger.info('[reels] upload proxy uploading to S3', { reelId: finalReelId, size: file.size });
    const { key } = await uploadFileToS3(file.buffer, file.mimetype);
    const reel = await Reel.findById(finalReelId);
    if (!reel) throw new ApiError(httpStatus.NOT_FOUND, 'Reel not found');
    reel.status = 'PROCESSING';
    reel.media = reel.media || {};
    reel.media.sourceKey = key;
    reel.processing = { stage: 'PROCESSING', progress: 10, error: undefined };
    await reel.save();

    (async () => {
      try {
        await transcodeReel(finalReelId);
      } catch (err) {
        logger.error(`[reels] auto transcode failed for reel ${finalReelId}: ${err.message}`);
      }
    })();

    return { reelId: String(reel._id), key };
  } catch (err) {
    logger.error('[reels] upload proxy failed:', err);
    throw err;
  }
};

// Transcode one PROCESSING reel: 720p MP4 + thumbnail → READY.
// Absent ffmpeg binary is a retriable FAILED state, never a crash — the admin
// list shows the reason and finalize can be re-run.
const transcodeReel = async (reelId) => {
  const reel = await Reel.findById(reelId);
  if (!reel) throw new ApiError(httpStatus.NOT_FOUND, 'Reel not found');
  if (reel.status !== 'PROCESSING' || !reel.media?.sourceKey) return reel;

  try {
    await runFfmpeg(['-version']);
    // eslint-disable-next-line no-unused-vars
  } catch (_err) {
    reel.processing = {
      stage: 'FAILED',
      progress: 0,
      error: 'ffmpeg binary not available on this host',
    };
    await reel.save();
    logger.warn(`reels.media: ffmpeg missing, reel ${reelId} parked as FAILED`);
    return reel;
  }

  const cfg = await getStorageConfig();
  const client = buildS3Client(cfg);
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reel-'));
  const input = path.join(tmp, 'input.mp4');
  const rendition = path.join(tmp, '720p.mp4');
  const thumbnail = path.join(tmp, 'thumb.jpg');
  try {
    reel.processing = { stage: 'PROCESSING', progress: 30, error: undefined };
    await reel.save();
    await streamToFile(client, cfg.bucket, reel.media.sourceKey, input);
    await runFfmpeg([
      '-i',
      input,
      '-vf',
      'scale=-2:1280',
      '-c:v',
      'libx264',
      '-profile:v',
      'main',
      '-level',
      '3.1',
      '-pix_fmt',
      'yuv420p',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-colorspace',
      'bt709',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      rendition,
    ]);
    reel.processing = { stage: 'THUMBNAIL', progress: 90, error: undefined };
    await reel.save();
    await runFfmpeg(['-i', input, '-ss', '00:00:01', '-vframes', '1', thumbnail]);

    const base = `${RENDITION_PREFIX}/${String(reel._id)}`;
    const renditionKey = `${base}-720p.mp4`;
    const thumbnailKey = `${base}-thumb.jpg`;
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: renditionKey,
        Body: fs.createReadStream(rendition),
        ContentType: 'video/mp4',
      })
    );
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: thumbnailKey,
        Body: fs.createReadStream(thumbnail),
        ContentType: 'image/jpeg',
      })
    );

    reel.media.renditions = [{ quality: '720p', url: publicUrlFor(cfg, renditionKey) }];
    reel.media.thumbnailUrl = publicUrlFor(cfg, thumbnailKey);
    reel.videoUrl = publicUrlFor(cfg, renditionKey);
    reel.thumbnail = publicUrlFor(cfg, thumbnailKey);
    reel.status = 'READY';
    reel.processing = { stage: 'READY', progress: 100, error: undefined };
    await reel.save();
    return reel;
  } catch (err) {
    reel.processing = { stage: 'FAILED', progress: 0, error: String(err.message).slice(0, 500) };
    await reel.save();
    logger.error(`reels.media: transcode failed for reel ${reelId}: ${err.message}`);
    return reel;
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
};

// Cron entry (Step 5 wires the schedule): oldest PROCESSING reels first.
const pollProcessing = async ({ limit = 5 } = {}) => {
  const pending = await Reel.find({ status: 'PROCESSING' })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .select('_id');
  const results = [];
  for (const row of pending) {
    const reel = await transcodeReel(row._id);
    results.push({ reelId: String(row._id), status: reel.status, stage: reel.processing?.stage });
  }
  return { processed: results.length, results };
};

module.exports = {
  MAX_RAW_BYTES,
  createUploadUrl,
  finalizeUpload,
  transcodeReel,
  pollProcessing,
  uploadProxy,
};
