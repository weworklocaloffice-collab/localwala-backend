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

const PDF = 'application/pdf';
const JPEG = 'image/jpeg';
const PNG = 'image/png';
const WEBP = 'image/webp';

const DOCUMENT_MIME_ALLOWLIST = Object.freeze({
  OWNERSHIP: Object.freeze([PDF, JPEG, PNG, WEBP]),
  APPROVAL: Object.freeze([PDF, JPEG, PNG]),
  TAX: Object.freeze([PDF, JPEG, PNG]),
  ENCUMBRANCE: Object.freeze([PDF]),
  PROJECT: Object.freeze([PDF, JPEG, PNG, WEBP]),
  SELLER: Object.freeze([PDF, JPEG, PNG, WEBP]),
  OTHER: Object.freeze([PDF, JPEG, PNG, WEBP]),
});

const DEFAULT_DOCUMENT_MAX_SIZE_BYTES = 1048576;

function normalizeMimeType(value) {
  return String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

function documentRuleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertDocumentUpload({ category, mimeType, sizeBytes, maxSizeBytes }) {
  if (sizeBytes === undefined || sizeBytes === null) {
    throw documentRuleError('DOCUMENT_SIZE_REQUIRED', 'Document sizeBytes is required.');
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw documentRuleError('DOCUMENT_SIZE_INVALID', 'Document sizeBytes must be a positive integer.');
  }

  const max = Number(maxSizeBytes) || DEFAULT_DOCUMENT_MAX_SIZE_BYTES;
  if (sizeBytes > max) {
    throw documentRuleError(
      'DOCUMENT_TOO_LARGE',
      `Document exceeds the ${max}-byte upload limit.`
    );
  }

  const normalized = normalizeMimeType(mimeType);
  if (!normalized) {
    throw documentRuleError('DOCUMENT_MIME_TYPE_REQUIRED', 'Document mimeType is required.');
  }

  const allowed = DOCUMENT_MIME_ALLOWLIST[category] || [];
  if (!allowed.includes(normalized)) {
    throw documentRuleError(
      'DOCUMENT_MIME_TYPE_NOT_ALLOWED',
      `Document type "${normalized}" is not allowed for category ${category}.`
    );
  }

  return normalized;
}

module.exports = {
  DOCUMENT_MIME_ALLOWLIST,
  DEFAULT_DOCUMENT_MAX_SIZE_BYTES,
  normalizeMimeType,
  assertDocumentUpload,
};
