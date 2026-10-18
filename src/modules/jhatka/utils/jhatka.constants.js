/**
 * jhatka.constants.js — centralised magic numbers and enums for the Jhatka module.
 *
 * Keeps lookup tables and constant values in one place so they can be imported
 * by services, routes, and validators without duplication.
 */

const MANUAL_MOVEMENT_TYPES = [
  'ADJUSTMENT',
  'COUNT_ADJUSTMENT',
  'STOCK_IN',
  'RETURN',
  'TRANSFER',
];

const WASTAGE_CAUSES = [
  'TRIM',
  'SPOILAGE',
  'EXPIRY',
  'OVER_PREPARATION',
  'CUSTOMER_REJECTED',
  'QUALITY_REJECTION',
  'PACKAGING_DAMAGE',
  'THEFT_LOSS',
  'OTHER',
];

const SUBSCRIPTION_CHARGE_MODES = [
  'ceiling',
  'fixed',
];

const KIND_TYPES = ['raw', 'prepared', 'packaging'];

const STATUS_TYPES = {
  BATCH: ['source', 'opened', 'consumed', 'expired', 'quarantined', 'discarded'],
  RECALL: ['open', 'notifying', 'closed'],
  PURCHASE_ORDER: ['draft', 'placed', 'partially_received', 'received', 'closed', 'cancelled'],
  RECEIPT: ['draft', 'posted', 'cancelled'],
  SUBSCRIPTION: ['active', 'paused', 'completed', 'cancelled'],
  INVENTORY_ITEM: ['active', 'damaged'],
};

const QUALITY_RATING_LEVELS = ['A', 'B', 'C', 'D', 'E'];

const CREDIT_TERM_OPTS = [7, 14, 30, 45];

/**
 * Map a human-readable kind string to its single-letter code.
 * Used by the inventory item schema and API.
 */
const KIND_CODE_MAP = {
  raw: 'r',
  prepared: 'p',
  packaging: 'k',
};

/**
 * Map a quality rating string to a numeric value.
 */
const QUALITY_RATING_MAP = {
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
};

module.exports = {
  MANUAL_MOVEMENT_TYPES,
  WASTAGE_CAUSES,
  SUBSCRIPTION_CHARGE_MODES,
  KIND_TYPES,
  STATUS_TYPES,
  QUALITY_RATING_LEVELS,
  CREDIT_TERM_OPTS,
  KIND_CODE_MAP,
  QUALITY_RATING_MAP,
};