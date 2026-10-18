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

const storeDriverRemittanceSchema = mongoose.Schema(
  {
    driver: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreDriver',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    expected: moneyField(0),
    collected: moneyField(0),
    remitted: moneyField(0),
    variance: moneyField(0),
    status: {
      type: String,
      default: 'pending',
      enum: ['pending', 'reconciled', 'disputed'],
    },
    notes: { type: String, trim: true, max: 500 },
    reconciledBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
    reconciledAt: Date,
  },
  {
    timestamps: true,
  }
);

storeDriverRemittanceSchema.plugin(toJSON);
storeDriverRemittanceSchema.plugin(paginate);

storeDriverRemittanceSchema.index({ driver: 1, date: 1 }, { unique: true });
storeDriverRemittanceSchema.index({ outlet: 1, status: 1, date: -1 });

module.exports = mongoose.model('StoreDriverRemittance', storeDriverRemittanceSchema);