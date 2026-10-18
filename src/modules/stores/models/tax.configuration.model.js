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
 * TaxConfiguration — an effective-dated GST rate table (BR-41).
 *
 * WHY A TABLE AND NOT A NUMBER ON THE PRODUCT
 *
 * GST rates change, and a rate change must never rewrite history. Storing `taxRate: 18`
 * on the product means an order placed last quarter cannot prove which rate applied.
 *
 * A rate is resolved by `(code, atOrderDate)`: the entry with the latest
 * `effectiveFrom` that is not expired. The resolved rate is then FROZEN onto the
 * order line, so a rate change next month does not touch last month's orders, and a
 * refund six months later recomputes from the snapshot rather than from today's table.
 *
 * `code` is an HSN code for goods and a SAC code for services.
 *
 * @typedef TaxConfiguration
 */
const taxConfigurationSchema = mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    // 0, 0.25, 0.5, 3, 5, 12, 18, 28. Decimal fractions exist (0.25% and 0.5%
    // are used for gold, diamonds and rough diamonds), so this is not an integer.
    gstRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    effectiveFrom: {
      type: Date,
      required: true,
    },
    // null or absent means open-ended
    effectiveTo: {
      type: Date,
      required: false,
    },
    isDefault: {
      type: Boolean,
      required: false,
      default: false,
    },
    status: {
      type: Boolean,
      required: false,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

taxConfigurationSchema.plugin(toJSON);
taxConfigurationSchema.plugin(paginate);

// The resolution query is: { code, status: true, effectiveFrom: { $lte: date },
//                            $or: [ { effectiveTo: null }, { effectiveTo: { $gte: date } } ] }
// sorted by effectiveFrom desc, take the first.
taxConfigurationSchema.index({ code: 1, effectiveFrom: -1 });
taxConfigurationSchema.index({ status: 1, effectiveFrom: -1 });

/**
 * Resolve the rate in force for a tax code on a given date.
 * Throws rather than defaulting — a missing or expired config must never silently
 * produce a zero-rated order.
 *
 * @param {string} code HSN or SAC code
 * @param {Date} atDate the transaction date
 * @returns {Promise<object>} the TaxConfiguration document in force
 */
taxConfigurationSchema.statics.resolveRate = async function resolveRate(code, atDate) {
  const at = atDate instanceof Date ? atDate : new Date(atDate || Date.now());

  const entry = await this.findOne({
    code: String(code).toUpperCase(),
    status: true,
    effectiveFrom: { $lte: at },
    $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gte: at } }],
  }).sort({ effectiveFrom: -1 });

  if (!entry) {
    const exists = await this.exists({ code: String(code).toUpperCase() });
    if (!exists) throw new Error(`TAX_CONFIG_MISSING: no tax configuration for code ${code}`);
    throw new Error(`TAX_CONFIG_NOT_IN_FORCE: no rate for ${code} effective on ${at.toISOString()}`);
  }
  return entry;
};

const TaxConfiguration = mongoose.model('TaxConfiguration', taxConfigurationSchema);

module.exports = TaxConfiguration;