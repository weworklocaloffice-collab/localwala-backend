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
const { toJSON, paginate } = require('./plugins');

const cannedResponseSchema = mongoose.Schema(
  {
    locale: {
      type: String,
      default: 'en',
    },
    intent: {
      type: String,
      required: true,
      // where_is_my_order, refund, cancel, coupon, greeting, handover, etc
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
    },
    skills: {
      type: [String],
      default: [],
    },
    // Who sees this reply: agents (thread `/` picker) or customers (human-
    // state chips in the app). One taxonomy, two surfaces.
    audience: {
      type: String,
      enum: ['agent', 'customer'],
      default: 'agent',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

cannedResponseSchema.plugin(toJSON);
cannedResponseSchema.plugin(paginate);
cannedResponseSchema.index({ intent: 1, locale: 1 });

/**
 * @typedef CannedResponse
 */
const CannedResponse = mongoose.model('CannedResponse', cannedResponseSchema);

module.exports = CannedResponse;
