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

function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const transactionSchema = mongoose.Schema(
  {
    payableId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    walletId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Wallet',
      required: true,
    },
    type: {
      type: String, // deposite or withdrawal
      required: true,
    },
    amount: {
      type: Number,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      required: true,
    },
    uuid: {
      type: String,
    },
    confirmed: {
      type: Boolean,
      default: false,
    },
    meta: {
      type: Array,
      default: [],
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
transactionSchema.plugin(toJSON);
transactionSchema.plugin(paginate);

transactionSchema.pre('save', async function () {
  const transactions = this;
  transactions.uuid = randomUUID();
});

/**
 * @typedef Transactions
 */
const Transactions = mongoose.model('Transactions', transactionSchema);

module.exports = Transactions;

