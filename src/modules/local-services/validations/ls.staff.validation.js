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
const { objectId: objectIdCustom } = require('../../../validations/custom.validation');

const objectId = Joi.string().custom(objectIdCustom);
const time = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/);

const shift = Joi.object().keys({
  day: Joi.number().integer().min(0).max(6).required(),
  start: time.required(),
  end: time.required(),
});

const leave = Joi.object().keys({
  from: Joi.date().required(),
  to: Joi.date().greater(Joi.ref('from')).required(),
  reason: Joi.string().max(500).allow('', null),
});

const staffFields = {
  name: Joi.string().max(200),
  skills: Joi.array().items(Joi.string().max(64)),
  services: Joi.array().items(objectId),
  shifts: Joi.array().items(shift),
  leave: Joi.array().items(leave),
  status: Joi.string().valid('active', 'inactive'),
};

const staffBody = {
  body: Joi.object()
    .keys({
      ...staffFields,
      name: staffFields.name.required(),
    })
    .unknown(false),
};

const updateStaffBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object().keys(staffFields).min(1).unknown(false),
};

const resourceBody = {
  body: Joi.object()
    .keys({
      kind: Joi.string().valid('room', 'vehicle', 'equipment', 'staff_slot', 'other'),
      name: Joi.string().max(200).required(),
      code: Joi.string().max(50).allow('', null),
      capacity: Joi.number().integer().min(1).max(10000),
      turnaroundMinutes: Joi.number().integer().min(0).max(1440),
      status: Joi.string().valid('active', 'inactive'),
    })
    .unknown(false),
};

const updateResourceBody = {
  params: Joi.object().keys({ id: objectId.required() }),
  body: Joi.object()
    .keys({
      kind: Joi.string().valid('room', 'vehicle', 'equipment', 'staff_slot', 'other'),
      name: Joi.string().max(200),
      code: Joi.string().max(50).allow('', null),
      capacity: Joi.number().integer().min(1).max(10000),
      turnaroundMinutes: Joi.number().integer().min(0).max(1440),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1)
    .unknown(false),
};

const idParam = {
  params: Joi.object().keys({ id: objectId.required() }),
};

module.exports = { staffBody, updateStaffBody, resourceBody, updateResourceBody, idParam };
