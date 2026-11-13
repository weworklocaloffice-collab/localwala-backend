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

const mongoose = require('mongoose');
const { toJSON } = require('../../../models/plugins');

/**
 * A customer's saved local SERVICE (bookable concept), not a provider.
 * The unique (customer, service) pair makes double-tap idempotent and keeps
 * DELETE deterministic.
 */
const localServiceFavoriteSchema = mongoose.Schema(
  {
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    service: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'LocalServiceService',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

localServiceFavoriteSchema.plugin(toJSON);

localServiceFavoriteSchema.index({ customer: 1, service: 1 }, { unique: true });
localServiceFavoriteSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model('LocalServiceFavorite', localServiceFavoriteSchema);
