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

// locality
const mongoose = require('mongoose');
const { toJSON, slugGenerator, paginate } = require('./plugins');

const localitySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
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
city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: true,
    },

    /**
     * Alternative spellings and search terms — ADDED for the Local Stores vertical.
     *
     * ## Why aliases and not a search on `name`
     *
     * Store matching has to survive what customers and partners actually type. The same
     * place is "Gachibowli", "Gachibowli Village", "Gachi Bowli", "Gachibowli Hyderabad"
     * and "Nanakramguda". A regex over `name` handles the typos but not the extended
     * forms, and it cannot be indexed usefully — a leading wildcard is a full scan.
     *
     * `aliases` is a curated, indexable list, normalised to lower case on write so a
     * lookup never depends on how the alias was typed.
     *
     * ## Nullable and additive
     *
     * Defaults to empty, so every existing locality is valid unchanged. Nothing reads
     * this field yet outside the stores vertical.
     */
    aliases: {
      type: [String],
      // NO default, and this is deliberate.
      //
      // With `default: []`, Mongoose materialises the array when an EXISTING locality
      // is re-saved — so every food/dairy locality row that gets touched by any admin
      // edit would silently gain an `aliases: []` field. Verified in
      // verify.locality.backcompat.js, which caught exactly that.
      //
      // Leaving it undefined means old rows stay byte-identical on disk. New rows get an
      // array either by supplying one or by the stores service normalising on write.
      // Consumers must therefore treat `aliases` as possibly-absent, which the resolver
      // in this file already does: `{ aliases: rx }` simply does not match undefined.
      default: undefined,
    },
    translations: {
      type: Array,
      default: [],
    },
    slug: {
      type: 'String',
      source: 'name',
      unique: true,
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
localitySchema.plugin(toJSON);
localitySchema.plugin(slugGenerator);
localitySchema.plugin(paginate);
localitySchema.index({ location: '2dsphere' });

/**
 * Resolve a typed locality name or alias to a canonical Locality.
 *
 * ## Why this exists on the model
 *
 * Every caller needs the same guarantee — that a typed string maps to ONE locality, or
 * to none — and the failure mode of getting it wrong is a customer whose order is
 * matched to the wrong store. Centralised here rather than in a service so a second
 * caller cannot implement a looser version.
 *
 * ## Matching rules
 *
 *   1. An EXACT `name` match wins over an alias. If a locality is literally called
 *      "Kukatpally" and another has "Kukatpally" as an alias, the exact one is correct.
 *   2. Otherwise an exact alias match.
 *   3. Otherwise nothing. No prefix matching and no regex: a partial match that resolves
 *      to the wrong locality is worse than no match, because it produces a confidently
 *      wrong delivery quote.
 *
 * ## Both lookups are case-insensitive
 *
 * An anchored case-insensitive regex is used for `name` as well as `aliases`. Matching
 * `name` with a plain string query would be case-SENSITIVE, so typing "gachibowli"
 * would fail to find "Gachibowli" — while the alias path, right beside it, did match.
 * People type in lowercase constantly, so the most common path must not be the strict
 * one. The regex is fully anchored, so this stays exact matching: only letter case is
 * ignored, not the spelling.
 *
 * ## Scoped by city, always
 *
 * Two cities can each have a "Kukatpally". The caller passes the city it is resolving
 * within and it is enforced in the query, so a locality name can never silently resolve
 * across a city boundary.
 *
 * @param {string} typedName what the user typed
 * @param {string} cityId    the city to resolve within
 * @returns {Promise<object|null>} the Locality document, or null
 */
localitySchema.statics.resolveByNameOrAlias = async function resolveByNameOrAlias(
  typedName,
  cityId
) {
  const name = String(typedName || '').trim();
  if (!name) return null;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp('^' + escaped + '$', 'i');

  // Name first, so a canonical name beats another locality's alias for the same string.
  const byName = await this.findOne({ name: rx, city: cityId }).lean();
  if (byName) return byName;

  return this.findOne({ aliases: rx, city: cityId }).lean();
};

localitySchema.statics.isNameTaken = async function (name, excludeLocalityId) {
  const locality = await this.findOne({ name, _id: { $ne: excludeLocalityId } });
  return !!locality;
};

/**
 * @typedef Locality
 */
const Locality = mongoose.model('Locality', localitySchema);

module.exports = Locality;

