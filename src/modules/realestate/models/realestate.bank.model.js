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
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * RealEstateBank — a lending partner.
 *
 * A bank sees ONLY its own loan leads and customers (plan §13.3).
 * Cross-bank visibility would be a data leak to a competitor — so
 * every loan query is scoped by `bank`, resolved from the token via
 * bank auth, never from a URL param.
 */
const realEstateBankSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    contactEmail: { type: String, required: false, trim: true, lowercase: true },
    contactPhone: { type: String, required: false, trim: true },

    status: {
      type: String,
      required: true,
      default: 'ACTIVE',
      enum: ['ACTIVE', 'SUSPENDED', 'CLOSED'],
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateBankSchema.plugin(toJSON);
realEstateBankSchema.plugin(paginate);

realEstateBankSchema.index({ code: 1 }, { unique: true });
realEstateBankSchema.index({ status: 1 });

/**
 * @typedef RealEstateBank
 */
const RealEstateBank = mongoose.model('RealEstateBank', realEstateBankSchema);

module.exports = RealEstateBank;
