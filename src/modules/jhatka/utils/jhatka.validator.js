/**
 * jhatka.validator.js — request body validators for Jhatka routes.
 *
 * Centralized validation following the codebase pattern:
 *   if (!field) throw new ApiError(httpStatus.BAD_REQUEST, 'message');
 *
 * Each function returns an object compatible with Express middleware:
 *   { body: validatedBody, params: validatedParams, query: validatedQuery }
 * or throws ApiError on failure.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/**
 * Validate subscription items body.
 * Pure extraction from POST /:subscription/items — ensures required fields.
 */
function validateSubscriptionItems(body) {
  if (!body) throw new ApiError(httpStatus.BAD_REQUEST, 'body is required');

  const { items, reason } = body || {};
  if (!Array.isArray(items) || !items.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'items is required');
  }
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required for an items change');

  return { items, reason };
}

/**
 * Validate deliver POD body.
 * Pure extraction from POST /deliveries/:delivery/deliver.
 */
function validateDeliverPod(body) {
  if (!body) throw new ApiError(httpStatus.BAD_REQUEST, 'body is required');

  const { deliveredTempC, photo, signature, location, otp, receiverName, note } = body || {};
  if (deliveredTempC !== undefined && deliveredTempC !== null && isNaN(Number(deliveredTempC))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'deliveredTempC must be a number');
  }
  if (otp !== undefined && isNaN(Number(otp))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'otp must be a number');
  }
  return { deliveredTempC, photo, signature, location, otp, receiverName, note };
}

/**
 * Validate collect-cod body.
 * Pure extraction from POST /deliveries/:delivery/collect-cod.
 */
function validateCollectCod(body) {
  if (!body) throw new ApiError(httpStatus.BAD_REQUEST, 'body is required');

  const { amountPaise, receiptPhoto, capturedBy } = body || {};
  if (amountPaise === undefined) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amountPaise is required');
  }
  const amount = Number(amountPaise);
  if (!Number.isInteger(amount) || amount < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amountPaise must be a non-negative integer');
  }
  return { amountPaise: amount, receiptPhoto, capturedBy };
}

/**
 * Validate label generation body.
 * Pure extraction from POST / (labels).
 */
function validateLabelBody(body) {
  if (!body) throw new ApiError(httpStatus.BAD_REQUEST, 'body is required');

  const { outlet, kind, quantity, weight } = body || {};
  if (!outlet) throw new ApiError(httpStatus.BAD_REQUEST, 'outlet is required');
  if (!kind) throw new ApiError(httpStatus.BAD_REQUEST, 'kind is required');
  return { outlet, kind, quantity, weight };
}

/**
 * Validate receipt body (inventory).
 * Pure extraction from POST /receipts.
 */
function validateReceiptBody(body) {
  if (!body) throw new ApiError(httpStatus.BAD_REQUEST, 'body is required');

  const { outlet, variant, kind, quantity, rate, note } = body || {};
  if (!outlet) throw new ApiError(httpStatus.BAD_REQUEST, 'outlet is required');
  if (!variant) throw new ApiError(httpStatus.BAD_REQUEST, 'variant is required');
  if (!kind) throw new ApiError(httpStatus.BAD_REQUEST, 'kind is required');
  if (quantity === undefined || quantity === null) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'quantity is required');
  }
  if (rate === undefined || rate === null) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'rate is required');
  }
  return { outlet, variant, kind, quantity, rate, note };
}

module.exports = {
  validateSubscriptionItems,
  validateDeliverPod,
  validateCollectCod,
  validateLabelBody,
  validateReceiptBody,
};