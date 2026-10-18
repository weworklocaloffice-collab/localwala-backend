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
 * PropertyCategory — what kind of property this is, and which fields it carries.
 *
 * ## Why the schema is data, not code
 *
 * Real Estate plan §56 freezes "Property categories: Admin configurable". Taken
 * literally that is a promise the code would break the moment an operator wanted a
 * new field on Apartments — which is the normal request, not the exotic one.
 *
 * So `specSchema` holds field *descriptors*, and
 * `realestate.category.service.compileSpecSchema()` turns them into a Joi schema at
 * write time. Adding "Balcony" to Apartments is a database update, not a deploy.
 *
 * ## Why a typed array and not a free-form object
 *
 * `specSchema.fields[]` with a `type` discriminator, rather than `specSchema: { arbitrary: Object }`,
 * because the descriptors are read by three consumers that each need the type: the
 * runtime validator, the Angular form builder, and the admin UI that renders the field
 * editor. All three switch on the same `type`. A free-form object would make each of
 * them re-guess the type from the value, and a `STRING` field whose value happens to be
 * `"3"` would render as a number in one place and a string in another.
 *
 * ## `specSchema` is versioned by `updatedAt`
 *
 * The compiled-Joi cache keys on `(_id, updatedAt)`. Editing a category therefore
 * invalidates the cache automatically, with no explicit bust — see
 * `realestate.category.service.js`.
 */
const realEstatePropertyCategorySchema = mongoose.Schema(
  {
    /**
     * Stable machine key. `key` is what code branches on; `name` is what an operator
     * edits and a customer reads. Changing `name` is routine, changing `key` is a
     * breaking change, so `key` has no rename path and is documented as immutable.
     *
     * Seeded: APARTMENT, INDEPENDENT_HOUSE, VILLA, PLOT, COMMERCIAL_OFFICE,
     * COMMERCIAL_SHOP, COMMERCIAL_SHOWROOM, COMMERCIAL_WAREHOUSE, COMMERCIAL_LAND
     */
    key: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Public grouping. Blueprint §4 has five primary categories (Apartments,
     * Independent Houses, Villas, Plots, Commercial) with Commercial broken out into
     * five sub-types. `group` is that primary grouping, so the customer app can render
     * "Commercial" once with five children underneath rather than five flat entries.
     */
    group: {
      type: String,
      required: false,
      trim: true,
      uppercase: true,
      // APARTMENT, HOUSE, VILLA, PLOT, COMMERCIAL
    },

    description: {
      type: String,
      required: false,
      trim: true,
    },

    icon: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * Which transaction types this category may be listed under.
     *
     * A closed list on the category, not on the property, so an operator cannot
     * accidentally create "Plots for rent" by choosing the wrong dropdown. Blueprint
     * §5 says every property supports BUY and RENT; this is where a category opts out
     * of one of them.
     */
    transactionTypes: {
      type: [String],
      required: false,
      default: undefined,
    },

    /**
     * Blueprint §7 — which extra fields this category carries.
     *
     * Field descriptors, read by the runtime validator, the admin form builder and the
     * Angular property form. `key` is the key written into
     * `RealEstateProperty.specs`.
     */
    specSchema: {
      fields: {
        type: Array,
        default: undefined,
      },
      /**
       * Group headings so the property form is not one flat wall of inputs.
       * e.g. ['Location', 'Dimensions', 'Configuration', 'Age & furnishing']
       */
      groups: {
        type: [String],
        required: false,
        default: undefined,
      },
    },

    /**
     * Amenity codes a property in this category may carry.
     *
     * Admin-editable rather than a hardcoded enum, because the amenity vocabulary
     * differs by category — "Covered parking" means nothing for a plot and
     * "Corner plot" means nothing for a villa. Validated at property write time
     * against this list.
     */
    amenityOptions: {
      type: [String],
      required: false,
      default: undefined,
    },

    /**
     * Which specification keys are search-filterable, so the search endpoint knows
     * what it may accept in a filter without a hardcoded per-category map.
     */
    filterableKeys: {
      type: [String],
      required: false,
      default: undefined,
    },

    /**
     * Ordering in the customer app's category list. Lower first.
     */
    sortOrder: {
      type: Number,
      required: false,
      default: 0,
    },

    /**
     * Whether a new category needs a human to look at it before properties use it.
     *
     * `false` for the nine seeded categories. `true` is the right default for anything
     * an operator creates, because a category with a malformed `specSchema` silently
     * rejects every property written against it.
     */
    requiresReview: {
      type: Boolean,
      required: false,
      default: true,
    },

    translations: {
      type: Array,
      default: [],
    },

    status: {
      type: Boolean,
      default: true,
    },

    slug: {
      type: String,
      /**
       * Derived from `key`, NOT from `name`.
       *
       * `key` is immutable and unique; `name` is neither. A slug built from `name`
       * changes when an operator renames a category, which breaks any URL that points
       * at it. And two categories named "Commercial" would collide on a name-derived
       * slug while being legitimately distinct by key.
       *
       * The service also sets this explicitly, because `findOneAndUpdate` does NOT fire
       * `pre('save')` — so `slugGenerator` never runs on the upsert path. Relying on the
       * plugin alone left every row at `slug: null` and the second row died on
       * `E11000 dup key: { slug: null }`.
       */
      source: 'key',
      unique: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
realEstatePropertyCategorySchema.plugin(toJSON);
realEstatePropertyCategorySchema.plugin(paginate);
realEstatePropertyCategorySchema.plugin(slugGenerator);

// `unique: true` is declared on the slug field above, so it is NOT repeated here —
// declaring it in both places makes Mongoose warn about a duplicate index on every
// boot. Same rule as `vertical.model.js`.

realEstatePropertyCategorySchema.index({ key: 1 }, { unique: true });
realEstatePropertyCategorySchema.index({ status: 1, sortOrder: 1 });
realEstatePropertyCategorySchema.index({ group: 1, status: 1, sortOrder: 1 });
// Customer-facing lookup. Partial so a disabled category cannot collide with a live
// one on the same key.
realEstatePropertyCategorySchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

/**
 * @typedef RealEstatePropertyCategory
 */
const RealEstatePropertyCategory = mongoose.model(
  'RealEstatePropertyCategory',
  realEstatePropertyCategorySchema
);

module.exports = RealEstatePropertyCategory;
