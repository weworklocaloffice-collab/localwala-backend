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

const Joi = require('joi');
// src/modules/stores/validations -> src/validations
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

/**
 * Joi schemas for the LOCAL STORES ADMIN surface.
 *
 * These are separate from `stores.validation.js` on purpose. That file validates what a
 * PARTNER may send; this one validates what an ADMIN may send. The overlap is a page and
 * a limit, but the permission model is different — an admin can create a category that a
 * partner can never create, so collapsing them would either over-restrict the admin or
 * under-restrict the partner.
 *
 * Every id is `objectId`: a malformed id reaching a query throws a Mongoose cast error
 * and becomes a 500, which is an information leak and a log line nobody reads.
 */
const objectId = Joi.string().custom(objectIdCustom);

/** Shared list shape. `status` is a string here because it arrives on the query string. */
const adminList = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(20),
  search: Joi.string().trim().allow(''),
  status: Joi.string().allow(''),
});

const categoryCreate = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  icon: Joi.string().trim().max(60),
  sortOrder: Joi.number().integer().min(0),
  status: Joi.boolean(),
});

const categoryUpdate = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  icon: Joi.string().trim().max(60),
  sortOrder: Joi.number().integer().min(0),
  status: Joi.boolean(),
}).min(1);

const categoryId = Joi.object({ category: objectId.required() });

const subcategoryList = adminList.keys({ category: objectId });

const subcategoryCreate = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  category: objectId.required(),
  /**
   * Per-subcategory overrides of the category defaults. This IS the mechanism BR-26
   * describes — one engine, many categories — so it is free-form rather than a fixed
   * shape: a new category flag must not require a schema change to be usable.
   */
  categoryDefaults: Joi.object().unknown(true),
  sortOrder: Joi.number().integer().min(0),
  status: Joi.boolean(),
});

const subcategoryUpdate = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  categoryDefaults: Joi.object().unknown(true),
  sortOrder: Joi.number().integer().min(0),
  status: Joi.boolean(),
}).min(1);

const subcategoryId = Joi.object({ subcategory: objectId.required() });

const brandList = adminList;

const brandCreate = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  aliases: Joi.array().items(Joi.string().trim()).default([]),
  categories: Joi.array().items(objectId).default([]),
  subcategories: Joi.array().items(objectId).default([]),
  originCountry: Joi.string().trim().max(60),
  website: Joi.string().trim().max(200),
  description: Joi.string().trim().max(1000),
  logo: Joi.string().trim(),
  banner: Joi.string().trim(),
  /**
   * `approved` without a category is refused in the service (§5.7.4) because an
   * approved brand with no taxonomy has no browse path. Joi cannot express "at least one
   * category only when approved" without a conditional, so the service carries it and
   * Joi keeps the enum honest.
   */
  status: Joi.string().valid('pending', 'approved', 'rejected', 'archived').default('pending'),
});

const brandUpdate = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  aliases: Joi.array().items(Joi.string().trim()),
  categories: Joi.array().items(objectId),
  subcategories: Joi.array().items(objectId),
  originCountry: Joi.string().trim().max(60),
  website: Joi.string().trim().max(200),
  description: Joi.string().trim().max(1000),
  logo: Joi.string().trim(),
  banner: Joi.string().trim(),
  status: Joi.string().valid('pending', 'approved', 'rejected', 'archived'),
  isVerified: Joi.boolean(),
}).min(1);

const brandId = Joi.object({ brand: objectId.required() });

const attributeTemplateCreate = Joi.object({
  name: Joi.string().trim().min(2).max(100).required(),
  type: Joi.string()
    .valid('text', 'number', 'select', 'multi_select', 'boolean', 'color', 'size', 'date', 'file')
    .required(),
  options: Joi.array()
    .items(
      Joi.object({
        value: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()).required(),
        label: Joi.string().trim().required(),
        swatch: Joi.string().trim(),
        sortOrder: Joi.number().integer().min(0),
      })
    )
    .default([]),
  unit: Joi.string().trim().max(20),
  filterable: Joi.boolean().default(false),
  searchable: Joi.boolean().default(false),
  required: Joi.boolean().default(false),
  /**
   * `variantAxis` is what makes this template GENERATE variants rather than just record
   * a value. §5.4's cartesian generation reads exactly this flag, so a template that
   * should have produced a size grid but has it off silently produces one variant and no
   * error anywhere.
   */
  variantAxis: Joi.boolean().default(false),
  isOrganicRelevant: Joi.boolean().default(false),
  displayOrder: Joi.number().integer().min(0),
  status: Joi.boolean().default(true),
});

const attributeTemplateUpdate = Joi.object({
  name: Joi.string().trim().min(2).max(100),
  type: Joi.string().valid('text', 'number', 'select', 'multi_select', 'boolean', 'color', 'size', 'date', 'file'),
  options: Joi.array().items(
    Joi.object({
      value: Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean()).required(),
      label: Joi.string().trim().required(),
      swatch: Joi.string().trim(),
      sortOrder: Joi.number().integer().min(0),
    })
  ),
  unit: Joi.string().trim().max(20),
  filterable: Joi.boolean(),
  searchable: Joi.boolean(),
  required: Joi.boolean(),
  variantAxis: Joi.boolean(),
  isOrganicRelevant: Joi.boolean(),
  displayOrder: Joi.number().integer().min(0),
  status: Joi.boolean(),
}).min(1);

const attributeTemplateId = Joi.object({ template: objectId.required() });

/**
 * Admin list shape for records that have no parent filter.
 *
 * `status` accepts a comma-separated list as well as a single value, because the console
 * links carry multi-status filters such as `payment_due,retrying,grace_period` and an
 * operator pastes that straight into the URL bar. Splitting here keeps every controller
 * from having to remember.
 */
const recordList = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(20),
  search: Joi.string().trim().allow(''),
  status: Joi.string().trim().allow(''),
  outlet: objectId,
  chain: objectId,
});

const orderList = recordList.keys({
  lifecycle: Joi.string().trim().allow(''),
  from: Joi.date(),
  to: Joi.date(),
});

const orderId = Joi.object({ order: objectId.required() });

/**
 * The target status is a route parameter AND is allow-listed here AND is checked again by
 * the partner service's transition table. Three gates, deliberately: Joi is the first
 * gate a client meets, and the service table is the authority.
 */
const orderTransition = Joi.object({
  order: objectId.required(),
  status: Joi.string()
    .valid(
      'payment_pending',
      'paid',
      'store_received',
      'accepted',
      'picking',
      'packing',
      'ready',
      'driver_assigned',
      'picked_up',
      'out_for_delivery',
      'delivered',
      'completed',
      'rejected',
      'cancelled',
      'payment_failed'
    )
    .required(),
});

const driverId = Joi.object({ driver: objectId.required() });

const driverReason = Joi.object({
  driver: objectId.required(),
  reason: Joi.string().trim().max(500),
});

const deliveryList = recordList.keys({
  driver: objectId,
  outlet: objectId,
  status: Joi.string().valid(
    'assigned', 'accepted', 'at_store', 'picked_up', 'out_for_delivery', 'delivered', 'failed', 'cancelled',
  ),
});

const deliveryId = Joi.object({ delivery: objectId.required() });

const postOrderList = recordList.keys({
  kind: Joi.string().valid('return', 'exchange', 'warranty'),
});

const returnTransition = Joi.object({
  return: objectId.required(),
  status: Joi.string()
    .valid('approved', 'rejected', 'picked_up', 'received', 'refunded', 'cancelled')
    .required(),
});

const exchangeTransition = Joi.object({
  exchange: objectId.required(),
  status: Joi.string()
    .valid('approved', 'rejected', 'picked_up', 'received', 'exchanged', 'cancelled')
    .required(),
});

const warrantyTransition = Joi.object({
  warranty: objectId.required(),
  status: Joi.string()
    .valid('approved', 'rejected', 'in_repair', 'resolved', 'closed', 'cancelled')
    .required(),
});

const promotionList = recordList.keys({
  approvalStatus: Joi.string().valid('not_required', 'pending', 'approved', 'rejected'),
});

/**
 * BR-22 admin type gating. `status` is required because a moderation call with no
 * decision is meaningless — it would clear nothing and change nothing while reporting
 * success.
 */
const promotionModeration = Joi.object({
  promotion: objectId.required(),
  status: Joi.string().valid('not_required', 'pending', 'approved', 'rejected').required(),
  note: Joi.string().trim().max(1000),
});

const reviewList = recordList;
const reviewModeration = Joi.object({
  review: objectId.required(),
  status: Joi.string().valid('pending', 'approved', 'rejected', 'archived').required(),
  reply: Joi.object({
    text: Joi.string().trim().max(1000).required(),
    repliedBy: objectId.required(),
  }),
});

const complaintList = recordList.keys({
  priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
});

/**
 * `resolution` is required only when closing. The previous `.and('status',
 * 'resolution')` read as conditional but behaved as always-required — `status`
 * is itself required, so every transition without a resolution 400d, including
 * a legitimate "escalate this, no resolution yet". `Joi.when` expresses the
 * actual rule: required on resolved/closed, optional (but still accepted)
 * everywhere else.
 */
const complaintModeration = Joi.object({
  complaint: objectId.required(),
  status: Joi.string().valid('open', 'in_progress', 'resolved', 'closed', 'escalated').required(),
  resolution: Joi.string()
    .valid('refunded', 'replaced', 'apology', 'no_action', 'pending')
    .when('status', {
      is: Joi.valid('resolved', 'closed'),
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
  resolutionNotes: Joi.string().trim().max(2000),
});

const settlementList = recordList.keys({
  counterparty: objectId,
  store: objectId,
  vertical: Joi.string().valid('stores', 'dairy'),
});

const settlementId = Joi.object({ settlement: objectId.required() });

const settlementSettle = Joi.object({
  settlement: objectId.required(),
  payoutMethod: Joi.string().valid('bank', 'wallet'),
  payoutDetails: Joi.object({
    accountName: Joi.string(),
    accountNumber: Joi.string(),
    ifsc: Joi.string(),
    upiId: Joi.string(),
  }),
  gatewayReference: Joi.string().trim(),
});

const settlementFail = Joi.object({
  settlement: objectId.required(),
  failureReason: Joi.string().trim().max(500).required(),
});

const settlementReverse = Joi.object({
  settlement: objectId.required(),
  reason: Joi.string().trim().max(500).required(),
});

const refundList = recordList.keys({ order: objectId });

const subscriptionList = recordList.keys({ business: objectId });

const subscriptionPaymentList = recordList.keys({ subscription: objectId });

const organicModeration = Joi.object({
  verification: objectId.required(),
  status: Joi.string().valid('pending', 'approved', 'rejected', 'expired').required(),
  note: Joi.string().trim().max(1000),
});

module.exports = {
  adminList,
  categoryCreate,
  categoryUpdate,
  categoryId,
  subcategoryList,
  subcategoryCreate,
  subcategoryUpdate,
  subcategoryId,
  brandList,
  brandCreate,
  brandUpdate,
  brandId,
  attributeTemplateCreate,
  attributeTemplateUpdate,
  attributeTemplateId,
  recordList,
  orderList,
  orderId,
  orderTransition,
  driverId,
  driverReason,
  deliveryList,
  deliveryId,
  postOrderList,
  returnTransition,
  exchangeTransition,
  warrantyTransition,
  promotionList,
  promotionModeration,
  reviewList,
  reviewModeration,
  complaintList,
  complaintModeration,
  settlementList,
  settlementId,
  settlementSettle,
  settlementFail,
  settlementReverse,
  refundList,
  subscriptionList,
  subscriptionPaymentList,
  organicModeration,
};