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
 * Joi validation for the supply-request surface (partner + admin).
 *
 * §15.1 convention: state transitions are route parameters allow-listed here a
 * SECOND time, behind the service's transition table. Quantities accept the
 * receipt model's rule — integers in the unit (1.4 kg arrives as 1400 GRAM).
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const quantity = Joi.object().keys({
  value: Joi.number().greater(0).required(),
  unit: Joi.string().valid('KG', 'GRAM', 'PIECE', 'TRAY').required(),
});

/** Partner: create a supply request. */
const supplyRequestCreateBody = {
  body: Joi.object()
    .keys({
      items: Joi.array()
        .items(
          Joi.object().keys({
            product: objectId.required(),
            quantity: quantity.required(),
          })
        )
        .min(1)
        .required(),
      neededBy: Joi.date().iso().min('now'),
      note: Joi.string().trim().max(500),
      paymentMode: Joi.string().valid('prepaid', 'on_delivery', 'deduct').required(),
    })
    .unknown(true),
};

/** Admin: approve — the credit AND price decision. Rates are paise per unit. */
const supplyApproveBody = {
  body: Joi.object()
    .keys({
      rates: Joi.object()
        .pattern(objectId, Joi.number().min(0).max(100000000))
        .required(),
      note: Joi.string().trim().max(500),
    })
    .unknown(true),
};

/** Admin: reject / cancel — a reason is always required (explainable, §12). */
const supplyReasonBody = {
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(3).max(500).required(),
    })
    .unknown(true),
};

/** Admin: fulfil — supplier of record + raw SKU per product (manual input in
 * this vertical), optional partial quantities and per-line expiry. */
const supplyFulfilBody = {
  body: Joi.object()
    .keys({
      supplier: objectId.required(),
      rawSkuByProduct: Joi.object()
        .pattern(objectId, Joi.string().trim().uppercase().min(1).max(40))
        .required(),
      deliveredQuantities: Joi.object().pattern(objectId, Joi.number().greater(0)),
      expiresAtByLine: Joi.object().pattern(Joi.string(), Joi.date().iso()),
    })
    .unknown(true),
};

const idParam = {
  params: Joi.object().keys({
    id: objectId.required(),
  }),
};

// OD-12 companion: partner-proposed delivery-area change (increase/decrease).
const areaRequestCreateBody = {
  body: Joi.object()
    .keys({
      proposed: Joi.object()
        .keys({
          radiusKm: Joi.number().min(0).max(50).required(),
          extendedRadiusKm: Joi.number().min(0).max(50).required(),
          extendedDeliveryFee: Joi.number().min(0),
        })
        .required(),
      reason: Joi.string().trim().min(3).max(500).required(),
    })
    .unknown(true),
};

const areaReasonBody = {
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(3).max(500),
    })
    .unknown(true),
};

module.exports = {
  supplyRequestCreateBody,
  supplyApproveBody,
  supplyReasonBody,
  supplyFulfilBody,
  idParam,
  areaRequestCreateBody,
  areaReasonBody,
};
