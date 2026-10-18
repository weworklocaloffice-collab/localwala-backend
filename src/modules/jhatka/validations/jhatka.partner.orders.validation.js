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
 * jhatka.partner.orders.validation.js — Joi schemas for the partner order surface.
 *
 * §15.1: every id is `objectId` (a malformed id reaching a query throws a Mongoose
 * cast error and becomes a 500); every state a service transition table ALSO
 * checks is allow-listed here a second time.
 */

const Joi = require('joi');
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);

const orderParam = {
  params: Joi.object().keys({
    order: objectId.required(),
  }),
};

const rejectBody = {
  body: Joi.object()
    .keys({
      reason: Joi.string().trim().min(3).required(),
    })
    .unknown(true),
};

const weighBody = {
  body: Joi.object()
    .keys({
      items: Joi.array()
        .min(1)
        .items(
          Joi.object()
            .keys({
              orderItem: objectId,
              itemId: objectId,
              actualQuantity: Joi.object()
                .keys({
                  value: Joi.number().positive().required(),
                  unit: Joi.string().required(),
                })
                .unknown(true)
                .required(),
              batchAllocations: Joi.array().items(
                Joi.object()
                  .keys({
                    batch: objectId.required(),
                    qty: Joi.number().required(),
                  })
                  .unknown(true)
              ),
            })
            .unknown(true)
        )
        .required(),
      evidence: Joi.object()
        .keys({
          photoUrl: Joi.string(),
          ticketNo: Joi.string(),
          ticketPhotoUrl: Joi.string(),
          capturedAt: Joi.date(),
          deviceId: Joi.string(),
        })
        .unknown(true),
      override: Joi.object()
        .keys({
          reason: Joi.string().trim().min(3).required(),
          approvedBy: Joi.string(),
        })
        .unknown(true),
    })
    .unknown(true),
};

module.exports = {
  orderParam,
  rejectBody,
  weighBody,
};
