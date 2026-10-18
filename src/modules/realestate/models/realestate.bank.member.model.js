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
 * RealEstateBankMember — a bank officer on the bank-team portal.
 *
 * Identity resolves from the access token via bank auth. No bank id
 * or member id ever comes from a URL path (plan §7.1).
 */
const realEstateBankMemberSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    bank: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateBank',
      required: true,
    },

    designation: { type: String, required: false, trim: true },

    status: {
      type: String,
      required: true,
      default: 'ACTIVE',
      enum: ['ACTIVE', 'SUSPENDED', 'TERMINATED'],
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateBankMemberSchema.plugin(toJSON);
realEstateBankMemberSchema.plugin(paginate);

realEstateBankMemberSchema.index({ user: 1 }, { unique: true });
realEstateBankMemberSchema.index({ bank: 1, status: 1 });

/**
 * @typedef RealEstateBankMember
 */
const RealEstateBankMember = mongoose.model('RealEstateBankMember', realEstateBankMemberSchema);

module.exports = RealEstateBankMember;
