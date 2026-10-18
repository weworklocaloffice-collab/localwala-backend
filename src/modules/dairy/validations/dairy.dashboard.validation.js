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

/**
 * Dashboard query.
 *
 * No `params` at all: the outlet comes from the token via `resolveOutlet`, so
 * there is nothing for the client to send and nothing it could widen.
 */
const dashboardValidation = {
  query: Joi.object().keys({
    lowStockThreshold: Joi.number().integer().min(0).max(1000),
  }),
};

module.exports = {
  dashboardValidation,
};