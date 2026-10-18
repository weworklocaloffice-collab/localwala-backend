/**
 * LocalWala â€“ Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Â© 2026 WeWorkLocal Private Limited
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
 * RealEstateProperty â€” a listing.
 *
 * The largest model in the vertical and the one with the most failure modes. Four
 * decisions in here are load-bearing; the rest is straightforward.
 *
 * ## 1. `status` and `availability` are different questions (BR-11)
 *
 *   status        â€” moderation. Is this allowed to be seen?
 *                  DRAFT â†’ SUBMITTED â†’ IN_REVIEW â†’ APPROVED â†’ PUBLISHED â€¦
 *   availability  â€” commerce. Can it be transacted?
 *                  AVAILABLE | ON_HOLD | SOLD | RENTED | UNAVAILABLE | SUSPENDED
 *
 * A property can be `PUBLISHED` and `ON_HOLD` at the same time â€” it is visible, and
 * somebody else is negotiating for it. Conflating the two is how a held property
 * disappears from search while customers are actively asking about it.
 *
 * `SUSPENDED` appears in both lists, deliberately and for different reasons: as a
 * status it means "an admin pulled this listing"; as an availability it means "the
 * unit is off market". They are set by different actors and must not be cross-written.
 *
 * ## 2. `specs` is a loose object validated against the category (blueprint Â§7)
 *
 * "Don't make every property use every field." A flat schema would make every plot
 * carry `bedrooms`. So the shape is `{ type: Object }` and the contract is enforced at
 * write time by `realestate.category.service.validateSpecs()`, which compiles the
 * category's `specSchema` into Joi on the fly. See that service for the cache.
 *
 * Mongo cannot index inside this object, which is why every field a customer can
 * filter or sort on is ALSO a first-class field or a `filterableKeys` entry handled by
 * the search service. `specs` is for the long tail, not for the hot path.
 *
 * ## 3. `categorySnapshot` freezes what the customer was shown
 *
 * Categories are admin-editable (plan Â§56). If an admin renames "3 BHK Apartment" to
 * "Premium Residences" or reorders the amenity list, a live listing must not change
 * shape under a customer who already has it in a saved search. The snapshot is taken at
 * publish time and thereafter only changes when the listing is re-published.
 *
 * ## 4. `location` has NO default on the nested `type` (F-13)
 *
 * `City` line 37, `Locality` line 34 and `Restaurant` line 85 all set
 * `default: 'Point'` on the nested GeoJSON type. That writes `type: 'Point'` into any
 * document saved without coordinates, leaving a Point with an empty array, which the
 * `2dsphere` index then rejects.
 *
 * There is no correct reference implementation in this repository, which is why it
 * keeps being copied wrong. This field is the first correct one â€” `State.location` in
 * the geographic kernel is the other. Copy those, not `Restaurant`.
 *
 * `[0, 0]` is rejected outright: a failed geocode that persists as null island will
 * silently match a radius search centred on the Atlantic, and for a property the pin
 * is the field an encumbrance check depends on.
 */
const realEstatePropertySchema = mongoose.Schema(
  {
    /**
     * Human-facing reference, e.g. `RE-HYD-000123`.
     *
     * Shown to customers and support, and it is what a vendor reads over the phone.
     * Distinct from `_id` on purpose: `_id` is not something to put in a UI.
     */
    propertyCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    // ---------------------------------------------------------------- identity

    /**
     * BR-01. Exactly two sources.
     *
     * `LOCALWALA_DIRECT` â€” sourced and controlled by LocalWala. Still goes through
     * verification (BR-04): "admin made it" is not "admin verified it".
     * `VENDOR` â€” listed by a property vendor under a listing package (BR-02).
     */
    source: {
      type: String,
      required: true,
      enum: ['LOCALWALA_DIRECT', 'VENDOR'],
    },

    /** Null iff `source` is `LOCALWALA_DIRECT`. Enforced in the service, not here. */
    vendor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVendor',
      required: false,
    },

    // -------------------------------------------------------------- catalogue

    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstatePropertyCategory',
      required: true,
    },

    /**
     * Frozen customer-visible category facts at publish time: key, name, group,
     * amenity vocabulary, sort order. See the class doc, decision 3.
     */
    categorySnapshot: {
      key: { type: String },
      name: { type: String },
      group: { type: String },
      amenityOptions: { type: [String] },
      frozenAt: { type: Date },
    },

    transactionType: {
      type: String,
      required: true,
      enum: ['BUY', 'RENT'],
    },

    // ------------------------------------------------------------------ money

    /**
     * Listing price for BUY, monthly rent for RENT.
     *
     * `moneyField()` â€” rupees at the edges, paise inside. See src/utils/money.field.js.
     */
    price: moneyField(0),

    /**
     * When true, `price` is not published. Lets a vendor list "price on request"
     * without the price leaking through a filter, a sort, or an API response.
     *
     * Enforced in the read mapper AND by the search service, which must exclude such
     * properties from price-bounded filters.
     */
    priceOnRequest: {
      type: Boolean,
      required: false,
      default: false,
    },

    /** Rent is quoted per month; kept explicit so a yearly quote is never assumed. */
    pricePeriod: {
      type: String,
      required: false,
      // MONTH, YEAR, ONE_TIME
    },

    // -------------------------------------------------------------- location

    addressLine: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * `locality` is REQUIRED here and optional on `Restaurant`.
     *
     * That asymmetry is deliberate and is the reason `Property` does not reuse the
     * restaurant location shape: a property cannot be published without a locality,
     * because locality drives discovery, executive assignment and the operational zone.
     * Making it optional would mean a listing no executive can be assigned to.
     */
    locality: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Locality',
      required: true,
    },

    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: true,
    },

    /**
     * Its own `state` ref rather than reaching through `city`.
     *
     * `City` has no `state` field and is referenced by 21 models, so adding one is a
     * platform change, not Real Estate's business. See plan §4.2.2 Option A.
     *
     * Optional, not required: no client can resolve a State id (there is no
     * states endpoint and cities carry no state link), so the service derives
     * it from the locality's operational zone when the caller omits it — the
     * same derivation rule as `operationalZone` (BR-19). A caller-supplied
     * value (admin, scripts) is kept as-is.
     *
     * Cost of the denormalisation: `property.state` could theoretically disagree with
     * `city → state`. Indian cities do not change states, and a backfill can populate
     * this from `city.state` if and when that field is added.
     */
    state: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'State',
      required: false,
    },

    country: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Country',
      required: false,
    },

    pincode: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * NO DEFAULT on the nested `type`. See the class doc, decision 4.
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
            // Null island â€” a failed geocode must not become a searchable position.
            if (lng === 0 && lat === 0) return false;
            return true;
          },
          message:
            'location.coordinates must be [lng, lat], lng in [-180,180], lat in [-90,90], and not [0,0]',
        },
      },
    },

    /** Geocoded display address, kept separate from `addressLine` (vendor's words). */
    mapAddress: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * BR-19. LocalWala's internal service area. Derived from `locality`, never
     * written to a customer address, and never accepted from a client on a property
     * write â€” it is resolved server-side by `geographic.service`.
     */
    operationalZone: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'OperationalZone',
      required: false,
    },

    // ------------------------------------------------------------------ specs

    /**
     * Category-specific fields. Validated against `category.specSchema` at write time.
     * See the class doc, decision 2.
     */
    specs: {
      type: Object,
      required: false,
      default: undefined,
    },

    /**
     * Amenity codes, validated against `category.amenityOptions`.
     *
     * No default: an empty array on every existing document is noise, and it makes
     * "no amenities" indistinguishable from "never set".
     */
    amenities: {
      type: [String],
      required: false,
      default: undefined,
    },

    // ------------------------------------------------------------------ media

    /**
     * Images, videos, floor plans, virtual tours.
     *
     * Embedded rather than a separate collection: a listing has a bounded number of
     * items (20 images, 3 videos by default), and the property card needs the cover
     * image in the same read as the listing. A join per card would be the wrong trade.
     *
     * `visibility` is the same class vocabulary as documents (BR-18) so a media filter
     * and a document filter can share one implementation.
     */
    media: {
      type: Array,
      default: undefined,
    },

    // ----------------------------------------------------------------- text

    title: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * Accepted by the vendor create/update validation but previously
     * missing here, so strict mode silently dropped them. Optional
     * project/builder names shown on the listing.
     */
    projectName: {
      type: String,
      required: false,
      trim: true,
    },

    builderName: {
      type: String,
      required: false,
      trim: true,
    },

    description: {
      type: String,
      required: false,
      trim: true,
    },

    // --------------------------------------------------------------- lifecycle

    /**
     * Moderation state. Transitions live in `realestate.property.service`'s table and
     * are allow-listed a second time in Joi. The target state is a route parameter.
     *
     * BR-03: only `PUBLISHED` is customer-visible.
     */
    status: {
      type: String,
      required: true,
      default: 'DRAFT',
      enum: [
        'DRAFT',
        'SUBMITTED',
        'IN_REVIEW',
        'APPROVED',
        'PUBLISHED',
        'CHANGES_REQUIRED',
        'REJECTED',
        'SUSPENDED',
        'EXPIRED',
        'SOLD',
        'RENTED',
        'ARCHIVED',
      ],
    },

    /** BR-11. Commerce state, independent of `status`. See the class doc. */
    availability: {
      type: String,
      required: true,
      default: 'AVAILABLE',
      enum: ['AVAILABLE', 'ON_HOLD', 'SOLD', 'RENTED', 'UNAVAILABLE', 'SUSPENDED'],
    },

    /**
     * Which listing entitlement paid for this listing (BR-02, BR-05).
     *
     * Set at creation. A property with no entitlement must not be publishable â€” that
     * is enforced in the service, and it is the one rule that separates "a listing
     * package" from "a sale commission".
     */
    entitlement: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateListingEntitlement',
      required: false,
    },

    submittedAt: {
      type: Date,
      required: false,
    },
    publishedAt: {
      type: Date,
      required: false,
    },
    expiresAt: {
      type: Date,
      required: false,
    },

    // ----------------------------------------------------------- verification

    verifiedAt: {
      type: Date,
      required: false,
    },
    verifiedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },

    // ------------------------------------------------------------- denormalised

    /**
     * Counters for the vendor dashboard and admin dashboard.
     *
     * Denormalised on purpose â€” the vendor's listings screen sorts and paginates on
     * these, and an `$lookup` per row to aggregate views would make that screen
     * unusable. Written by the view and enquiry paths; `RealEstatePropertyDailyStat`
     * holds the per-day series these are rolled up from.
     */
    views: { type: Number, required: false, default: 0, min: 0 },
    enquiries: { type: Number, required: false, default: 0, min: 0 },
    visits: { type: Number, required: false, default: 0, min: 0 },
    leads: { type: Number, required: false, default: 0, min: 0 },

    // -------------------------------------------------------------- lifecycle

    createdBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    updatedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },

    /**
     * Why an admin suspended, expired or archived this listing.
     *
     * A status with no recorded reason produces a support ticket that cannot be
     * answered, because nobody can find out why a vendor's listing vanished.
     */
    statusReason: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
realEstatePropertySchema.plugin(toJSON);
realEstatePropertySchema.plugin(paginate);

/**
 * SEARCH INDEXES
 *
 * The public search endpoint is the highest-traffic unauthenticated query in this
 * vertical and is rate-limited (plan F-16). These indexes are what make it cheap.
 */

// Public search: only PUBLISHED listings, by location.
realEstatePropertySchema.index({
  status: 1,
  availability: 1,
  transactionType: 1,
  'location.coordinates': '2dsphere',
});

// Facet filters a customer actually applies, in one index so the common case is a
// single range scan rather than an intersect of four.
realEstatePropertySchema.index({
  status: 1,
  category: 1,
  transactionType: 1,
  price: 1,
});

// Vendor dashboard: "my listings", newest first, grouped by state.
realEstatePropertySchema.index({ vendor: 1, status: 1, createdAt: -1 });

// Admin review queue.
realEstatePropertySchema.index({ status: 1, submittedAt: 1 });

// Featured / "recently added" strips.
realEstatePropertySchema.index({ status: 1, publishedAt: -1, views: -1 });

// Locality browse â€” the most common single browse action.
realEstatePropertySchema.index({ locality: 1, status: 1, price: 1 });

// Zone reporting.
realEstatePropertySchema.index({ operationalZone: 1, status: 1 });

// Expiry cron: finds PUBLISHED listings past their expiry.
realEstatePropertySchema.index({ status: 1, expiresAt: 1 });

realEstatePropertySchema.index({ propertyCode: 1 }, { unique: true });
realEstatePropertySchema.index({ vendor: 1, title: 'text', description: 'text' });

/**
 * @typedef RealEstateProperty
 */
const RealEstateProperty = mongoose.model('RealEstateProperty', realEstatePropertySchema);

module.exports = RealEstateProperty;
