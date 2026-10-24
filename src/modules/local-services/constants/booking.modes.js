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

module.exports.BOOKING_MODES = Object.freeze(['INSTANT', 'SLOT', 'REQUEST', 'DATE_RANGE', 'RECURRING']);

module.exports.BOOKING_STATUSES = Object.freeze([
  'DRAFT',
  'REQUESTED',
  'PENDING_PROVIDER',
  'ACCEPTED',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'DISPUTED',
]);

/**
 * Allowed transitions — single table required by service (realestate pattern).
 * Target is route param + Joi allow-listed.
 */
module.exports.BOOKING_TRANSITIONS = Object.freeze({
  DRAFT: ['REQUESTED', 'PAYMENT_PENDING', 'CANCELLED'],
  REQUESTED: ['PENDING_PROVIDER', 'CANCELLED'],
  PENDING_PROVIDER: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PAYMENT_PENDING', 'CONFIRMED', 'CANCELLED'],
  PAYMENT_PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'DISPUTED', 'CANCELLED'],
  COMPLETED: ['DISPUTED'],
  CANCELLED: [],
  NO_SHOW: [],
  DISPUTED: [],
});
