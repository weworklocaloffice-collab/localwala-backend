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

const favouriteSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      required: false,
      default: 'restaurant', // restaurant // food // property
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: false,
    },
    food: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Food',
      required: false,
    },
    // Real Estate extension (plan §0A.2): a parallel optional ref, never a
    // parallel favourites table. Sparse index so the 100% of existing
    // restaurant/food rows (property === undefined) are unaffected, and no
    // existing query changes — they filter on restaurant/food as before.
    property: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateProperty',
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
favouriteSchema.plugin(toJSON);
favouriteSchema.plugin(paginate);

favouriteSchema.index({ user: 1, property: 1 }, { sparse: true, name: 'user_property_favourite' });

/**
 * @typedef Favourite
 */
const Favourite = mongoose.model('Favourite', favouriteSchema);

module.exports = Favourite;

