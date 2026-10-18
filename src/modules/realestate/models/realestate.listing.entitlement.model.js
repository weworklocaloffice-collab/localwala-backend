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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * RealEstateListingEntitlement — the right to list properties.
 *
 * ## One entitlement per vendor (per package, per term)
 *
 * A vendor may purchase multiple packages over time. Each package purchase creates
 * exactly one entitlement. The entitlement tracks:
 *
 *   - How many listings have been created (consumedCount)
 *   - How many remain (totalCount - consumedCount)
 *   - When the entitlement was activated (effectiveFrom)
 *   - When it expires (effectiveTo)
 *   - What package it was bought for (package, packageSnapshot)
 *   - Which listings consumed it (consumptions array, for BR-05)
 *
 * ## Consumption tracking (BR-05)
 *
 * Blueprint §5: "Creating a property listing consumes exactly one entitlement.
 * Deleting/archiving a listing does NOT restore the entitlement once the listing
 * has reached SUBMITTED status. Below SUBMITTED, deletion restores it."
 *
 * The `consumptions` array records every listing that consumed one unit. Each entry
 * has: `propertyId`, `at` (when consumed), `restoredAt` (if later restored), and
 * `restoreReason`. This enables the BR-05 check: a listing that was SUBMITTED or
 * higher cannot be retroactively restored.
 *
 * ## Embedding vs separate collection
 *
 * The `consumptions` array is embedded and bounded by `totalCount` (max 200 by
 * typical package). This keeps the read model simple — one document answers
 * "does this vendor have remaining entitlements?" without a join. A separate
 * collection would require `$unwind` and was deemed overkill for a bounded
 * feature that only a handful of admin screens touch.
 *
 * If the project later needs cross-vendor entitlement queries, the array can be
 * migrated to a `RealEstateEntitlementLedger` collection with the same fields.
 */

const realEstateListingEntitlementSchema = mongoose.Schema(
  {
    /**
     * The vendor this entitlement belongs to.
     */
    vendor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVendor',
      required: true,
    },

    /**
     * The order that paid for this entitlement.
     *
     * Optional, because an entitlement can also be granted administratively without a
     * purchase. `one_entitlement_per_order` is partial on this field being an ObjectId,
     * so unlinked grants never collide with each other.
     *
     * This replaces `entitlementRef`, which an earlier version indexed but never declared.
     * An index on an undeclared field is inert, so that index was enforcing nothing.
     */
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateListingOrder',
      required: false,
    },

    /**
     * The package this entitlement was bought for.
     */
    package: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateListingPackage',
      required: true,
    },

    /**
     * The package as it was at purchase. Frozen snapshot — never mutated.
     */
    packageSnapshot: {
      code: { type: String },
      name: { type: String },
      listingCount: { type: Number },
      durationDays: { type: Number },
      limits: { type: Object },
      price: { type: Number }, // paise
      frozenAt: { type: Date },
    },

    /**
     * Total listings this entitlement grants.
     *
     * `null` means unlimited. The entitlement service checks for `null` explicitly
     * rather than representing unlimited as a large number.
     */
    totalCount: {
      type: Number,
      required: false,
      default: null,
    },

    /**
     * How many have been consumed so far.
     */
    consumedCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    /**
     * When this entitlement becomes active. Defaults to `now`.
     */
    effectiveFrom: {
      type: Date,
      required: false,
      default: Date.now,
    },

    /**
     * When this entitlement expires. May be `null` for "no expiry".
     */
    effectiveTo: {
      type: Date,
      required: false,
    },

    /**
     * Every listing that consumed one unit. Bounded implicitly by totalCount.
     *
     * Each entry: { property, at, restoredAt, restoreReason }.
     * `restoredAt` is set only when the consumption is rolled back (BR-05).
     */
    consumptions: {
      type: Array,
      default: [],
    },

    /**
     * Lifecycle state of the entitlement.
     *
     * This field was missing, and its absence disabled BR-05 outright: both `consume()`
     * and `findActiveForVendor()` filter on `status: 'ACTIVE'`, and a filter on a field
     * that is not in the schema matches nothing. So every consume attempt returned null
     * and no listing could ever be published from a vendor entitlement — the rule that
     * makes a package "the entitlement to list" (BR-02) was inert.
     *
     * `ACTIVE` is the default because an entitlement is created the moment an order is
     * paid; expiry is then a matter of `effectiveTo` rather than a status flip, so a
     * scheduled sweep does not have to write to the document to keep it accurate.
     */
    status: {
      type: String,
      required: true,
      default: 'ACTIVE',
      enum: ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED'],
    },

    /**
     * Human-readable reason for the last status change.
     */
    statusReason: { type: String, required: false, trim: true },

    createdBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & pagination
realEstateListingEntitlementSchema.plugin(toJSON);
realEstateListingEntitlementSchema.plugin(paginate);

/**
 * Indexes.
 *
 * ## What changed, and why
 *
 * Two of the four indexes below were wrong, and both were wrong in the direction of
 * looking protective while enforcing nothing.
 *
 * 1. `{ vendor: 1, package: 1 }` was `unique: true`. The comment directly above it says
 *    "a vendor may buy the same package multiple times (different terms)", which the
 *    unique index made impossible — the second purchase of the same package died on
 *    `E11000`. The comment and the index contradicted each other and the index won at
 *    runtime. Now non-unique, so repeat purchases are allowed.
 *
 * 2. `{ entitlementRef: 1 }` was a partial unique index with
 *    `partialFilterExpression: { entitlementRef: { $type: 'objectId' } }` — but
 *    `entitlementRef` is **not a field on this schema**. A partial index whose filter can
 *    never match a document indexes nothing and enforces nothing, while appearing in
 *    `schema.indexes()` to be doing something. Its name,
 *    `one_entitlement_per_vendor_package`, also described a different rule again.
 *    Removed.
 *
 * The invariant actually worth enforcing is one order yields at most one entitlement, so
 * that is now expressed directly on an `order` field that exists in the schema.
 *
 * Changing an index on a populated collection requires dropping the old one first; all
 * four real-estate collections were empty when this was written, so `syncIndexes()` is a
 * clean create.
 */
realEstateListingEntitlementSchema.index({ vendor: 1, package: 1 });

/** Dashboard queries: "which active entitlements does this vendor hold?" */
realEstateListingEntitlementSchema.index({ vendor: 1, status: 1, effectiveFrom: -1 });

/** Expiry sweep. Sparse, because `effectiveTo` is optional (no expiry is allowed). */
realEstateListingEntitlementSchema.index({ effectiveTo: 1 }, { sparse: true });

/**
 * One entitlement per order.
 *
 * Partial on `$type: 'objectId'` because `order` is optional: an entitlement can be
 * granted administratively without a purchase order, and many such grants may sit
 * unlinked at once. The partial filter is what stops those from colliding.
 */
realEstateListingEntitlementSchema.index(
  { order: 1 },
  {
    unique: true,
    partialFilterExpression: { order: { $type: 'objectId' } },
    name: 'one_entitlement_per_order',
  }
);

/**
 * @typedef RealEstateListingEntitlement
 */
const RealEstateListingEntitlement = mongoose.model(
  'RealEstateListingEntitlement',
  realEstateListingEntitlementSchema
);

module.exports = RealEstateListingEntitlement;