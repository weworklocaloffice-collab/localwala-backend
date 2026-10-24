/**
 * LocalWala �?" Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Ac 2026 WeWorkLocal Private Limited
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
const { toJSON } = require('../../../models/plugins');

/**
 * A customer's saved CHAIN, not an outlet.
 *
 * The catalogue, brand and offers belong to the chain (BR-18); an outlet is where the
 * customer happens to shop today and can close without the brand meaning anything less.
 * Favouriting the chain keeps the saved item valid when its usual outlet is closed, and
 * the browse surface can then show which nearby outlet of that chain is open.
 *
 * The pair is unique rather than using a single `favourite` id with an upsert race: a
 * double-tapped heart would otherwise create two rows, and `DELETE` would remove one and
 * leave the heart lit.
 */
const storeFavouriteSchema = mongoose.Schema(
  {
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

storeFavouriteSchema.plugin(toJSON);

storeFavouriteSchema.index({ customer: 1, chain: 1 }, { unique: true });
storeFavouriteSchema.index({ customer: 1, createdAt: -1 });

module.exports = mongoose.model('StoreFavourite', storeFavouriteSchema);
