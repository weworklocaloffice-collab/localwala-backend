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
 * jhatka.partner.inventory.validation.js — Joi schemas for the inventory surface.
 *
 * Status enums below mirror the service checks a second time (§15.1): the
 * transition/table check stays authoritative, Joi is the first gate.
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const pageQuery = {
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(500),
};

const itemParam = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};

const batchParam = {
  params: Joi.object().keys({
    batch: objectId.required(),
  }),
};

const poParam = {
  params: Joi.object().keys({
    po: objectId.required(),
  }),
};

const receiptParam = {
  params: Joi.object().keys({
    receipt: objectId.required(),
  }),
};

const recallParam = {
  params: Joi.object().keys({
    recall: objectId.required(),
  }),
};

const reasonBody = {
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(3).required(),
    })
    .unknown(true),
};

const adjustBody = {
  body: Joi.object()
    .keys({
      inventoryItem: objectId.required(),
      qtyDelta: Joi.number(),
      reservedDelta: Joi.number(),
      movementType: Joi.string()
        .valid('ADJUSTMENT', 'COUNT_ADJUSTMENT', 'STOCK_IN', 'RETURN', 'TRANSFER')
        .required(),
      reason: Joi.string().trim().min(3).required(),
      referenceType: Joi.string(),
      referenceId: Joi.string(),
      notes: Joi.string(),
    })
    .unknown(true),
};

const wastageBody = {
  body: Joi.object()
    .keys({
      inventoryItem: objectId.required(),
      qty: Joi.number().positive().required(),
      unit: Joi.string().required(),
      cause: Joi.string()
        .valid(
          'TRIM',
          'SPOILAGE',
          'EXPIRY',
          'OVER_PREPARATION',
          'CUSTOMER_REJECTED',
          'QUALITY_REJECTION',
          'PACKAGING_DAMAGE',
          'THEFT_LOSS',
          'OTHER'
        )
        .required(),
      order: objectId,
      orderItem: Joi.string(),
      notes: Joi.string(),
      occurredAt: Joi.date(),
    })
    .unknown(true),
};

const receiptBody = {
  body: Joi.object()
    .keys({
      purchaseOrder: objectId,
      supplier: objectId.required(),
      supplierInvoiceRef: Joi.string(),
      lines: Joi.array()
        .min(1)
        .items(
          Joi.object()
            .keys({
              product: objectId.required(),
              rawSku: Joi.string().required(),
              receivedQty: Joi.object()
                .keys({
                  value: Joi.number().required(),
                  unit: Joi.string().required(),
                })
                .unknown(true)
                .required(),
              unitPrice: Joi.number().required(),
            })
            .unknown(true)
        )
        .required(),
      vehicleNo: Joi.string(),
      receivedAt: Joi.date(),
      note: Joi.string(),
    })
    .unknown(true),
};

const inventoryListQuery = {
  query: Joi.object().keys({
    variant: Joi.string(),
    batch: Joi.string(),
    kind: Joi.string().valid('raw', 'prepared', 'packaging'),
    lowStock: Joi.string(),
    ...pageQuery,
  }),
};

const batchListQuery = {
  query: Joi.object().keys({
    status: Joi.string().valid('source', 'opened', 'consumed', 'expired', 'quarantined', 'discarded'),
    supplier: Joi.string(),
    expiringWithinDays: Joi.number().integer().min(1),
    ...pageQuery,
  }),
};

const recallListQuery = {
  query: Joi.object().keys({
    status: Joi.string().valid('open', 'notifying', 'closed'),
    ...pageQuery,
  }),
};

const poListQuery = {
  query: Joi.object().keys({
    status: Joi.string().valid('draft', 'placed', 'partially_received', 'received', 'closed', 'cancelled'),
    ...pageQuery,
  }),
};

const receiptListQuery = {
  query: Joi.object().keys({
    status: Joi.string().valid('draft', 'posted', 'cancelled'),
    ...pageQuery,
  }),
};

const movementListQuery = {
  query: Joi.object().keys({
    inventoryItem: Joi.string(),
    movementType: Joi.string(),
    from: Joi.date(),
    to: Joi.date(),
    ...pageQuery,
  }),
};

module.exports = {
  itemParam,
  batchParam,
  poParam,
  receiptParam,
  recallParam,
  reasonBody,
  adjustBody,
  wastageBody,
  receiptBody,
  inventoryListQuery,
  batchListQuery,
  recallListQuery,
  poListQuery,
  receiptListQuery,
  movementListQuery,
};
