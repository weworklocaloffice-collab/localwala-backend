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
 * modification, or use of this source code in an public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');
const moneyField = require('../../../utils/money.field');

/**
 * RealEstateListingPackage — the entitlement to LIST.
 *
 * ## The distinction this model exists to keep (BR-02)
 *
 * Blueprint §2: "The listing package gives the vendor the right/entitlement to list
 * properties. It is not the sale commission. This distinction must remain in the
 * system."
 *
 * So this is a catalogue item a vendor BUYS, and it is a different financial event type
 * (`LISTING_PACKAGE_PAYMENT`) from a sale commission
 * (`PROPERTY_SALE_COMMISSION`). They must never be summed into one "earnings" figure,
 * and no screen may imply that buying a package earns a vendor anything.
 *
 * ## Packages are edited in place; entitlements are frozen
 *
 * An admin changing the price of `PROFESSIONAL` from ₹4,999 to ₹5,999 must not alter
 * what a vendor already bought. That is the same historical-protection rule as a
 * commission rate (BR-15), and it is satisfied the same way: the ORDER and the
 * ENTITLEMENT carry a `packageSnapshot`, and this document stays the live catalogue.
 *
 * ## `limits` is deliberately loose
 *
 * Blueprint §9 lists "Limits" as a package attribute without defining them. Rather than
 * invent a closed enum now, `limits` holds a small object the entitlement service reads
 * for the two limits that are actually enforced today (`maxImages`, `maxVideos`) and
 * ignores the rest. A field that accepts unknown keys is better here than a schema that
 * has to be migrated every time a package gains a perk.
 */
const realEstateListingPackageSchema = mongoose.Schema(
  {
    /**
     * Stable machine key. Immutable; `name` is what an operator edits.
     */
    code: {
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

    description: {
      type: String,
      required: false,
      trim: true,
    },

    /** Price in rupees, stored as paise. */
    price: moneyField(0),

    /**
     * How many listings this package grants.
     *
     * `null` means unlimited, and it is checked explicitly by the entitlement service
     * rather than being represented as a very large number — `-1` for "unlimited" is
     * how a decrement becomes a negative balance nobody notices.
     */
    listingCount: {
      type: Number,
      required: false,
      default: null,
      min: 1,
    },

    /** How many days the entitlement is valid for, from activation. */
    durationDays: {
      type: Number,
      required: true,
      min: 1,
    },

    /** Marketing copy for the vendor app's package list. */
    features: {
      type: [String],
      required: false,
      default: undefined,
    },

    /**
     * Enforced limits. See the class doc.
     */
    limits: {
      maxImages: { type: Number, required: false },
      maxVideos: { type: Number, required: false },
      maxFeatured: { type: Number, required: false },
      allowFeatured: { type: Boolean, required: false, default: false },
    },

    /** Ordering in the vendor app; lower first, and normally cheapest first. */
    sortOrder: {
      type: Number,
      required: false,
      default: 0,
    },

    /**
     * Whether this package may be bought.
     *
     * A retired package stops new sales but existing entitlements keep running — a
     * vendor who bought `BASIC` for 30 days still has 30 days when it is retired.
     */
    status: {
      type: Boolean,
      required: false,
      default: true,
    },

    /**
     * Marks the package the vendor app highlights. At most one is set; the service
     * clears the others rather than relying on a partial unique index, because a moment
     * with zero recommended packages is preferable to a write failing.
     */
    recommended: {
      type: Boolean,
      required: false,
      default: false,
    },

    translations: {
      type: Array,
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateListingPackageSchema.plugin(toJSON);
realEstateListingPackageSchema.plugin(paginate);

realEstateListingPackageSchema.index({ code: 1 }, { unique: true });
realEstateListingPackageSchema.index({ status: 1, sortOrder: 1 });

/**
 * @typedef RealEstateListingPackage
 */
const RealEstateListingPackage = mongoose.model(
  'RealEstateListingPackage',
  realEstateListingPackageSchema
);

module.exports = RealEstateListingPackage;
