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
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { status: httpStatus } = require('http-status');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const config = require('../../../config/config');
const { mediaService, mediaStorageSettingService } = require('../../../services');
const ApiError = require('../../../utils/ApiError');

/**
 * Banner asset upload used by the header-banner authoring screen.
 *
 * This is deliberately NOT the shared `v1/file/web_upload_image` endpoint. That route
 * serves every module on the platform and enforces an image-only magic-byte policy, so
 * widening it to accept Lottie JSON would loosen validation everywhere. Lottie payloads
 * are JSON, not images, and deserve their own validation rather than a hole in the
 * shared one.
 *
 * Contract matches the existing upload route on purpose — `{ path }` relative to the
 * configured media base URL — so the panel's URL building stays uniform.
 */

const KIND_CONFIG = {
  image: {
    key: 'image',
    prefix: 'header-banner/images',
    extensions: {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
    },
    mimeLabel: 'jpg, png, webp, gif, svg',
  },
  lottie: {
    key: 'lottie',
    prefix: 'header-banner/lottie',
    extensions: {
      'application/json': '.json',
      'application/zip': '.lottie',
      'application/x-zip-compressed': '.lottie',
      'application/octet-stream': '.lottie',
    },
    mimeLabel: 'json, lottie, zip',
  },
};

const resolveKind = (raw) => {
  const kind = String(raw || 'image').toLowerCase();
  const resolved = KIND_CONFIG[kind];
  if (!resolved) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Unsupported asset kind "${kind}". Use image or lottie.`);
  }
  return resolved;
};

// Extensions are decided by us from a sniffed/validated type where possible, never
// purely from the client supplied filename.
const extensionFor = (kind, file) => {
  const mapped = kind.extensions[file.mimetype];
  if (mapped) return mapped;
  const fromName = path.extname(file.originalname || '').toLowerCase();
  if (kind.key === 'lottie' && fromName === '.json') return '.json';
  if (kind.key === 'lottie' && (fromName === '.lottie' || fromName === '.zip')) return '.lottie';
  if (kind.key === 'image' && fromName && kind.extensions[file.mimetype]) return fromName;
  return kind.key === 'lottie' ? '.json' : '';
};

const head = (file, max = 512) => (file.buffer ? file.buffer.subarray(0, max) : Buffer.alloc(0));
const looksLikeImage = (mime, buf) =>
  (mime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
  (mime === 'image/png' && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
  (mime === 'image/gif' && buf.toString('ascii', 0, 6).startsWith('GIF8')) ||
  (mime === 'image/webp' && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP');

const looksLikeZip = (buf) => buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05);

/**
 * Lottie validation.
 *
 * Shape is checked rather than "it parses": a valid-looking JSON document that is not a
 * Lottie animation would store fine and then render as nothing in the app, which is
 * exactly the class of silent failure this endpoint exists to prevent.
 *
 * Note the JSON is never executed here. Expressions embedded in a Lottie document are
 * JavaScript and `lottie-web` can evaluate them, so the admin preview strips them before
 * rendering; the Flutter client renders natively and never evaluates them at all.
 */
const validateLottieJson = (file) => {
  const text = file.buffer.toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Lottie file is not valid JSON.');
  }
  const isAnimation = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  const hasVersion = typeof parsed.v === 'string' && parsed.v.length > 0;
  const hasLayers = Array.isArray(parsed.layers) && parsed.layers.length > 0;
  if (!isAnimation || !hasVersion || !hasLayers) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'File is valid JSON but not a Lottie animation (expected "v" and a non-empty "layers").'
    );
  }
  return { frames: typeof parsed.op === 'number' ? parsed.op : null, layers: parsed.layers.length };
};

const verifyAsset = (file, kind) => {
  if (kind.key === 'image') {
    const buf = head(file);
    if (file.mimetype === 'image/svg+xml') {
      const text = head(file, 64 * 1024).toString('utf8').toLowerCase();
      if (/<script|on\w+\s*=|javascript:|foreignobject|<\?import|data:text\/html/i.test(text)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'SVG with active content is not allowed.');
      }
      return {};
    }
    if (!looksLikeImage(file.mimetype, buf)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'File content does not match its image type.');
    }
    return {};
  }

  const buf = head(file);
  if (looksLikeZip(buf)) {
    return {};
  }
  return validateLottieJson(file);
};

// ---------------------------------------------------------------------------- storage

const getStorageTarget = async () => {
  const setting = await mediaStorageSettingService.getMediaStorageSetting();
  if (!setting || !setting.id) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Media storage is not configured.');
  }
  const credentials = setting.credentials || {};
  return { name: setting.name, credentials };
};

const storeS3 = async (target, key, buffer, mimetype) => {
  const { credentials } = target;
  const region = credentials.awsRegionName;
  const bucket = credentials.awsBucketName;
  const missing = [region, bucket, credentials.awsAccessKey, credentials.awsSecretKey].filter((v) => !v);
  if (missing.length) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Media storage settings are incomplete.');
  }
  const client = new S3Client({
    region,
    credentials: { accessKeyId: credentials.awsAccessKey, secretAccessKey: credentials.awsSecretKey },
  });
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimetype })
  );
  return key;
};

const storeLocal = async (key, buffer) => {
  const destination = path.join(config.folder.public, key);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, buffer);
  return key;
};

const storeAsset = async (key, buffer, mimetype) => {
  const target = await getStorageTarget();
  if (target.name === 'aws_s3') {
    return storeS3(target, key, buffer, mimetype);
  }
  if (target.name === 'local') {
    return storeLocal(key, buffer);
  }
  // GCS and Azure are not wired for banner assets yet. Failing loudly beats the shared
  // controller's behaviour of falling through every branch and leaving the request open.
  throw new ApiError(
    httpStatus.NOT_IMPLEMENTED,
    `Header banner uploads do not support the "${target.name}" storage provider yet. Use S3 or local.`
  );
};

// ----------------------------------------------------------------------------- upload

const uploadAsset = async (req) => {
  const kind = resolveKind(req.body.kind);
  const file = req.file;
  if (!file) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Please select a file to upload.');
  }
  if (!kind.extensions[file.mimetype]) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Unsupported file type. Allowed: ${kind.mimeLabel}.`);
  }

  const meta = verifyAsset(file, kind);
  const key = `${kind.prefix}/${crypto.randomUUID()}${extensionFor(kind, file)}`;
  const storedPath = await storeAsset(key, file.buffer, file.mimetype);

  // Keep the shared media library consistent with the legacy upload route, which also
  // records every stored file.
  await mediaService.createMedia({
    path: storedPath,
    uid: req.body.uid && req.body.uid !== 'null' ? req.body.uid : null,
  });

  return { path: storedPath, kind: kind.key, size: file.size, meta };
};

// Memory storage: assets are small and are validated on the raw bytes before anything
// reaches disk or S3.
const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.file.maxUploadSize },
}).single('fileName');

const uploadMiddleware = (req, res, next) =>
  uploadSingle(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const mb = config.file.maxUploadSize / (1024 * 1024);
        return next(new ApiError(httpStatus.BAD_REQUEST, `Maximum file size is ${mb} MB.`));
      }
      return next(new ApiError(httpStatus.BAD_REQUEST, err.message));
    }
    return next(err);
  });

// ------------------------------------------------------------------ preview (read back)

const ASSET_PREFIX = 'header-banner/';

/**
 * Guards a client supplied storage key.
 *
 * The key becomes an S3 object key or a filesystem path, so it is confined to the banner
 * prefix and denied traversal. Without this a crafted `path` could read any object the
 * API credentials can reach.
 */
const assertSafeAssetPath = (raw) => {
  const key = String(raw || '').replace(/^\/+/, '');
  if (!key.startsWith(ASSET_PREFIX)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Asset path is outside the header banner prefix.');
  }
  if (key.includes('..') || key.includes('\\') || [...key].some((ch) => ch.codePointAt(0) < 0x20)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Asset path is not a valid storage key.');
  }
  return key;
};

const readS3 = async (target, key) => {
  const { credentials } = target;
  const client = new S3Client({
    region: credentials.awsRegionName,
    credentials: { accessKeyId: credentials.awsAccessKey, secretAccessKey: credentials.awsSecretKey },
  });
  const response = await client.send(
    new GetObjectCommand({ Bucket: credentials.awsBucketName, Key: key })
  );
  return response.Body.transformToString();
};

const readLocal = async (key) => fs.promises.readFile(path.join(config.folder.public, key), 'utf8');

/**
 * Removes Lottie expression holders.
 *
 * Lottie stores expressions as a string under an `x` key, and `lottie-web` evaluates them
 * as JavaScript. The Flutter client renders natively and never evaluates them, so
 * stripping here costs the preview nothing while removing the only script surface an
 * uploaded animation could reach in a browser.
 *
 * The test is "`x` holds a string" rather than "the object has keyframes, so `x` is an
 * expression": in a keyframed property the expression sits on each keyframe element
 * (`{ t, s, x }`), and those elements carry no `k` of their own. Non-string `x` values are
 * kept — split-position transforms legitimately use `x`/`y` objects there.
 */
const stripExpressions = (node) => {
  if (Array.isArray(node)) return node.map(stripExpressions);
  if (node && typeof node === 'object') {
    const out = {};
    Object.keys(node).forEach((field) => {
      const value = node[field];
      if (field === 'x' && typeof value === 'string') return;
      out[field] = stripExpressions(value);
    });
    return out;
  }
  return node;
};

/**
 * Returns a stored Lottie as parsed animation data.
 *
 * The admin preview cannot read the asset URL directly: the storage bucket serves no CORS
 * headers, so a browser fetch to it is blocked. Proxying through the API keeps the preview
 * on an origin the panel is already allowed to call, and works for local storage too.
 *
 * Only JSON animations are readable. A zipped `.lottie` cannot be handed to `lottie-web`,
 * so it is reported as unrenderable rather than silently producing a blank preview.
 */
const getPreviewAnimation = async (assetPath) => {
  const key = assertSafeAssetPath(assetPath);
  if (!key.toLowerCase().endsWith('.json')) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Only JSON Lottie files can be previewed in the browser. The uploaded animation still plays in the app.'
    );
  }

  const target = await getStorageTarget();
  let text;
  if (target.name === 'aws_s3') {
    text = await readS3(target, key);
  } else if (target.name === 'local') {
    text = await readLocal(key);
  } else {
    throw new ApiError(
      httpStatus.NOT_IMPLEMENTED,
      `Header banner previews do not support the "${target.name}" storage provider yet.`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Stored Lottie file is not valid JSON.');
  }
  return stripExpressions(parsed);
};

module.exports = { uploadAsset, uploadMiddleware, getPreviewAnimation };
