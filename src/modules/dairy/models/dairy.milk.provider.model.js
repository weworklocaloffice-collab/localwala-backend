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
 * DairyMilkProvider — a milk supplier.
 *
 * The counterparty at the start of the procurement chain:
 *
 *   Milk Provider → LocalWala Procurement → Collection → Quality Check
 *                 → Milk Batch → LocalWala Dairy → Customer
 */
const dairyMilkProviderSchema = mongoose.Schema(
  {
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    contactName: {
      type: String,
      required: false,
      trim: true,
    },
    mobile: {
      type: Number,
      required: true,
    },
    countryCode: {
      type: String,
      required: false,
      default: '+91',
    },
    address: {
      type: String,
      required: false,
      trim: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        required: false,
      },
    },
    /**
     * Animal type, which determines expected fat and SNF. Buffalo milk is
     * legitimately fatter than cow milk, so the QC thresholds are evaluated
     * against this rather than a single global number.
     */
    milkType: {
      type: String,
      required: false,
      default: 'cow', // cow, buffalo, mixed
    },
    /**
     * Agreement rate in rupees per litre, used to compute the provider payable.
     * Settled per collection, not per batch.
     */
    ratePerLitre: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    bankDetails: {
      accountName: {
        type: String,
        required: false,
      },
      accountNumber: {
        type: String,
        required: false,
      },
      ifsc: {
        type: String,
        required: false,
      },
      upiId: {
        type: String,
        required: false,
      },
    },
    /** Rolling totals, recomputed by the procurement service. */
    stats: {
      totalCollectedLitres: {
        type: Number,
        required: false,
        default: 0,
      },
      totalAcceptedLitres: {
        type: Number,
        required: false,
        default: 0,
      },
      totalRejectedLitres: {
        type: Number,
        required: false,
        default: 0,
      },
      totalPayable: {
        type: Number,
        required: false,
        get: (v) => Number((v / 100).toFixed(2)),
        set: (v) => Math.round(v * 100),
        default: 0,
      },
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

// add plugin that converts mongoose to json & convert to unique slug
dairyMilkProviderSchema.plugin(toJSON);
dairyMilkProviderSchema.plugin(paginate);
dairyMilkProviderSchema.index({ business: 1, code: 1 }, { unique: true });
dairyMilkProviderSchema.index({ business: 1, mobile: 1 });
dairyMilkProviderSchema.index({ business: 1, status: 1 });

/**
 * @typedef DairyMilkProvider
 */
const DairyMilkProvider = mongoose.model('DairyMilkProvider', dairyMilkProviderSchema);

module.exports = DairyMilkProvider;