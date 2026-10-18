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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const storePolicySchema = mongoose.Schema(
  {
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
    },
    type: {
      type: String,
      required: true,
      enum: ['return', 'exchange', 'warranty', 'cancellation', 'delivery', 'privacy', 'terms'],
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    returnWindowDays: {
      type: Number,
      default: 7,
    },
    exchangeWindowDays: {
      type: Number,
      default: 7,
    },
    warrantyDefaultMonths: {
      type: Number,
      default: 0,
    },
    cancellationWindowHours: {
      type: Number,
      default: 24,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    effectiveFrom: {
      type: Date,
      default: Date.now,
    },
    effectiveTo: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

storePolicySchema.plugin(toJSON);
storePolicySchema.plugin(paginate);

storePolicySchema.index({ chain: 1, type: 1, isActive: 1 });
storePolicySchema.index({ outlet: 1, type: 1 });
storePolicySchema.index({ chain: 1, type: 1, version: -1 });

storePolicySchema.statics.findActive = async function (chainId, type) {
  const filter = { chain: chainId, isActive: true };
  if (type) filter.type = type;
  return this.find(filter).sort({ version: -1 });
};

storePolicySchema.statics.findByType = async function (chainId, type) {
  return this.findOne({ chain: chainId, type, isActive: true }).sort({ version: -1 });
};

module.exports = mongoose.model('StorePolicy', storePolicySchema);