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
const { toJSON, slugGenerator, paginate } = require('../../../models/plugins');

/**
 * State — the level between `Country` and `City`.
 *
 * ## Why this exists
 *
 * `country.model.js`, `city.model.js` and `locality.model.js` already exist, but the
 * chain they form is **two orphans and one link**:
 *
 *     Country    ← orphan. Nothing in the platform refs it.
 *     City       ← orphan. Fields are name, image, location, slug, translations,
 *                           status. No country ref. No state ref.
 *     Locality   → city: Ref('City')     ✓ the only link that exists
 *
 * Real Estate needs a state to filter listings ("Telangana", "Maharashtra") and to
 * print on a title document. Rather than add `state` to `City` — which 21 models
 * reference, including `restaurant.model.js`, `driver.model.js`, `user.model.js` and
 * every dairy model — Real Estate refs `State` directly from `RealEstateProperty`.
 * See the Real Estate plan §4.2.2.
 *
 * ## `country` is optional on purpose
 *
 * It is optional rather than required so a state can be seeded before the country
 * list is reconciled. `India` is the only country in scope, and making the ref
 * required would block seeding on an empty database for no benefit. When the chain is
 * reconciled, tighten this to `required: true` with a backfill.
 */
const stateSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * ISO 3166-2 subdivision code, e.g. `IN-TG`, `IN-MH`.
     *
     * Optional because Indian state codes are not always what an operator types, and
     * a wrong code is worse than an absent one when it is used as a lookup key.
     */
    code: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
    },

    country: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Country',
      required: false,
    },

    /**
     * State centroid — used for map fallbacks and "nearby states" suggestions, never
     * for a radius search a customer initiated.
     *
     * ## Geometry: no default on the nested `type`
     *
     * `City` (line 37), `Locality` (line 34) and `Restaurant` (line 85) ALL set
     * `default: 'Point'` here. That writes `type: 'Point'` into any document saved
     * without coordinates, producing a Point with an empty array, which the `2dsphere`
     * index then rejects. There is no correct reference implementation in this
     * repository, which is why it keeps being copied wrong.
     *
     * This field is the first correct one. If you are adding a geo field to another
     * model, copy THIS, not `Restaurant`.
     */
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function (v) {
            if (!Array.isArray(v) || v.length !== 2) return false;
            const [lng, lat] = v;
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
            if (lng < -180 || lng > 180) return false;
            if (lat < -90 || lat > 90) return false;
            // Null island. A failed geocode must not persist as a real position.
            if (lng === 0 && lat === 0) return false;
            return true;
          },
          message:
            'coordinates must be [lng, lat] with lng in [-180,180], lat in [-90,90], and not [0,0]',
        },
      },
    },

    slug: {
      type: String,
      source: 'name',
      unique: true,
    },

    /**
     * Alternative spellings and search terms, lower-cased on write.
     *
     * Same rationale as `Locality.aliases` (added for Local Stores): operators type
     * "Telangana", "Telangana State", "TG", "TS". A curated indexable list beats a
     * leading-wildcard regex, which cannot use an index.
     */
    aliases: {
      type: [String],
    },

    translations: {
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
stateSchema.plugin(toJSON);
stateSchema.plugin(paginate);
stateSchema.plugin(slugGenerator);

stateSchema.index({ location: '2dsphere' });
stateSchema.index({ country: 1, status: 1 });
// ONE index on `name`, with a collation for case-insensitive uniqueness.
//
// Declaring both `{ name: 1 }` and `{ name: 1, unique, collation }` creates two
// indexes over the same key pattern, which MongoDB rejects with
// IndexKeySpecsConflict on first sync. The collation index already serves plain
// `name` lookups, so a second index buys nothing.
//
// The collation is the point: `slug` is derived from `name`, so "Telangana" and
// "telangana" collide on slug — while a case-SENSITIVE existence check (the pattern
// at `city.model.js:70`) lets both through. `City` and `Locality` carry that latent
// bug; this closes it here instead of inheriting it.
stateSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

/**
 * Lower-case every alias on write so a lookup never depends on how it was typed.
 */
stateSchema.pre('save', function (next) {
  if (Array.isArray(this.aliases) && this.aliases.length) {
    this.aliases = this.aliases
      .filter((a) => typeof a === 'string' && a.trim())
      .map((a) => a.trim().toLowerCase());
  }
  next();
});

/**
 * @typedef State
 */
const State = mongoose.model('State', stateSchema);

module.exports = State;
