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
 * RealEstateSettlement — a frozen statement over ledger entries.
 *
 * Generated FROM the ledger, never by re-running commission
 * arithmetic (plan §5.11). `entryIds[]` freezes which rows were
 * counted; a later correction is a new compensating entry that lands
 * in the NEXT period. Recomputing from source documents would let a
 * corrected commission silently change a statement someone already
 * received — which is exactly what this shape prevents.
 */
const realEstateSettlementSchema = mongoose.Schema(
  {
    settlementNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    partyType: {
      type: String,
      required: true,
      enum: ['VENDOR', 'EXECUTIVE', 'REFERRER', 'BANK', 'LOCALWALA'],
    },

    party: {
      type: mongoose.SchemaTypes.ObjectId,
      required: false,
    },

    periodFrom: {
      type: Date,
      required: true,
    },

    periodTo: {
      type: Date,
      required: true,
    },

    /** The frozen ledger entries counted. Never edited after creation. */
    entryIds: {
      type: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'RealEstateLedgerEntry' }],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A settlement must freeze at least one ledger entry.',
      },
    },

    totals: {
      gross: moneyField(0),
      tds: moneyField(0),
      net: moneyField(0),
    },

    status: {
      type: String,
      required: true,
      default: 'PENDING',
      enum: ['PENDING', 'VERIFIED', 'EARNED', 'SETTLEMENT_CREATED', 'PAID'],
    },

    approvedAt: { type: Date, required: false },
    approvedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    paidAt: { type: Date, required: false },
    payoutReference: { type: String, required: false, trim: true },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateSettlementSchema.plugin(toJSON);
realEstateSettlementSchema.plugin(paginate);

realEstateSettlementSchema.index({ settlementNo: 1 }, { unique: true });
realEstateSettlementSchema.index({ partyType: 1, party: 1, createdAt: -1 });
realEstateSettlementSchema.index({ status: 1, createdAt: -1 });

/**
 * @typedef RealEstateSettlement
 */
const RealEstateSettlement = mongoose.model('RealEstateSettlement', realEstateSettlementSchema);

module.exports = RealEstateSettlement;
