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
const { toJSON } = require('./plugins');

const userAddressSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    title: {
      type: Number,
      required: true,
      default: 0, // 0 = home // 1 = work // 2 = hotel // 3 = other
    },
    receiverName: {
      type: String,
      required: true,
    },
    countryCode: {
      type: Number,
      required: true,
    },
    receiverContact: {
      type: String,
      required: true,
    },
    flatHouse: {
      type: String,
      required: true,
    },
locality: {
      type: String,
      required: true,
    },

    /**
     * Structured locality reference — ADDED for the Local Stores vertical.
     *
     * ## Why this and not reusing `locality`
     *
     * `locality` above is a free-text String, and that is correct for food and dairy,
     * which ship to a typed address. Local Stores, however, matches an order against the
     * outlets a store actually serves, so it has to compare canonical identifiers.
     * Matching on the String means "Gachibowli", "Gachibowli, Hyderabad" and
     * "gachibowli" are three different places and a customer's order silently fails to
     * find a store two streets away.
     *
     * So `locality` is left exactly as it is and this new, NULLABLE ref is added beside
     * it. Nullable on purpose:
     *
     *   - no existing address has one, and requiring it would break every saved address
     *   - `locality` stays authoritative for the human-readable address, as before
     *   - the vertical reads `localityRef` when present and falls back to text matching
     *     otherwise, so behaviour is strictly better and never worse
     *
     * ## The alternative that was rejected
     *
     * Changing `locality` to an ObjectId ref would be cleaner on paper and would silently
     * reclassify a text column. Every existing read of `UserAddress.locality` would
     * return an ObjectId, and food and dairy currently display that field directly.
     */
    localityRef: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Locality',
      required: false,
      index: true,
    },

    /**
     * City reference. `locality` alone is not enough to scope delivery, because two
     * localities sharing a name exist in different cities.
     */
    cityRef: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: false,
      index: true,
    },

    /**
     * PIN code — ADDED for Local Stores, and deliberately NOT required.
     *
     * V1 of the stores vertical matches on locality plus a delivery radius, not on
     * pincode, because outlet coverage is defined by the radius each store actually
     * delivers to. Making this required would force every customer through a pincode
     * lookup that the vertical does not yet use, for no benefit.
     *
     * It is stored now because the address form already collects it elsewhere and
     * retrofitting a required field onto millions of rows later is far more expensive
     * than accepting it optionally from day one.
     */
    pincode: {
      type: String,
      required: false,
      trim: true,
    },

    landmark: {
      type: String,
      required: false,
    },
    location: {
      type: {
        type: String, // Don't do `{ location: { type: String } }`
        enum: ['Point'], // 'location.type' must be 'Point'
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
      },
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
userAddressSchema.plugin(toJSON);
userAddressSchema.index({ location: '2dsphere' });

/**
 * Stores outlet matching: "which addresses fall in any of these localities".
 *
 * Compound rather than a plain `localityRef` index because the stores queries always
 * filter on city as well, and a leading `cityRef` lets Mongo skip whole cities instead
 * of walking every locality index entry in the collection.
 *
 * Sparse, so the millions of existing food/dairy addresses with no refs do not all
 * collapse onto a single `null` key and defeat the index.
 */
userAddressSchema.index(
  { cityRef: 1, localityRef: 1 },
  {
    sparse: true,
    name: 'city_locality_lookup',
  }
);

/**
 * @typedef UserAddress
 */
const UserAddress = mongoose.model('UserAddress', userAddressSchema);

module.exports = UserAddress;

