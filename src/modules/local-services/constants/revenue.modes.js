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

/**
 * local-services revenue modes — frozen enums, never free strings.
 * Calculation modes are separate from price-control modes (CENTRAL/PARTNER/QUOTE).
 */
module.exports.REVENUE_MODELS = Object.freeze([
  'BOOKING_FEE',
  'COMMISSION',
  'COMBINED',
  'LEAD_FEE',
  'SUBSCRIPTION',
  'FEATURED',
]);

module.exports.CALCULATION_BASES = Object.freeze([
  'LABOUR_ONLY',
  'SERVICE_VALUE',
  'ELIGIBLE_COLLECTED_AMOUNT',
  'BOOKING_VALUE',
  'QUALIFIED_LEAD',
]);

module.exports.FEE_PAYERS = Object.freeze(['customer', 'provider', 'split']);

module.exports.QUALIFYING_EVENTS = Object.freeze([
  'BOOKING_CREATED',
  'PAYMENT_RECEIVED',
  'SERVICE_COMPLETED',
  'COMPLETION_VERIFIED',
  'QUOTE_ACCEPTED',
]);

module.exports.RULE_STATUSES = Object.freeze([
  'draft',
  'pending_approval',
  'approved',
  'scheduled',
  'active',
  'suspended',
  'expired',
  'archived',
]);
