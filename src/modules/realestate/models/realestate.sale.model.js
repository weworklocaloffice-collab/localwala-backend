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
const moneyField = require('../../../utils/money.field');

/**
 * RealEstateSale — a recorded sale (plan §5.9).
 *
 * Created from a hold conversion (principal applied against
 * `saleValue`, never revenue) or as a direct sale. Creating it
 * triggers commission computation via
 * `realestate.commission.service.computeSaleCommissions()`, which
 * freezes `ruleSnapshot` on every row (BR-15).
 */
const realEstateSaleSchema = mongoose.Schema(
  {
    saleCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: true,
    },

    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    vendor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVendor',
      required: false,
    },

    lead: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateLead',
      required: false,
    },

    /** Hold this sale converts, if any. Principal → consideration. */
    hold: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstatePropertyHold',
      required: false,
    },

    /** Hold principal applied against the consideration. */
    holdPrincipalApplied: moneyField(0),

    saleValue: moneyField(0),

    transactionType: {
      type: String,
      required: true,
      default: 'BUY',
      enum: ['BUY', 'RENT'],
    },

    status: {
      type: String,
      required: true,
      default: 'COMPLETED',
      enum: ['COMPLETED', 'CANCELLED'],
    },

    soldAt: {
      type: Date,
      required: true,
      default: Date.now,
    },

    cancelledAt: { type: Date, required: false },
    cancellationReason: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateSaleSchema.plugin(toJSON);
realEstateSaleSchema.plugin(paginate);

realEstateSaleSchema.index({ saleCode: 1 }, { unique: true });
realEstateSaleSchema.index({ property: 1, createdAt: -1 });
realEstateSaleSchema.index({ customer: 1, createdAt: -1 });
realEstateSaleSchema.index({ hold: 1 }, { sparse: true });

/**
 * @typedef RealEstateSale
 */
const RealEstateSale = mongoose.model('RealEstateSale', realEstateSaleSchema);

module.exports = RealEstateSale;
