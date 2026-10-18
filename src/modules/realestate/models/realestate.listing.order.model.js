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
 * modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');
const moneyField = require('../../../utils/money.field');

/**
 * RealEstateListingOrder — a vendor's purchase of a listing package.
 *
 * ## Why this is a separate document from the entitlement
 *
 * They have different lifetimes and different failure modes.
 *
 *   order        — money. `PENDING_PAYMENT` → `PAID`. It can also fail, be abandoned or
 *                  be refunded. It is a financial record and is never deleted.
 *   entitlement  — the right to list. Created only once the order is `PAID`, and then
 *                  it runs its own clock to `EXPIRED`.
 *
 * Collapsing them means a payment that failed halfway leaves either a usable
 * entitlement nobody paid for, or a paid order with no entitlement and no way to tell
 * which. Two documents, one created from the other, is the shape that survives a
 * half-completed payment.
 *
 * ## `packageSnapshot` is the historical guarantee (BR-15, applied to packages)
 *
 * Copying the package into the order means the price the vendor paid and the listing
 * count they were promised are readable years later, after the catalogue row has been
 * edited twice. `RealEstateListingPackage` remains the live catalogue; this is the
 * receipt.
 *
 * ## Payment goes through the EXISTING stack
 *
 * `paymentInitiation` links to `PaymentInitiation`, the same 2 573-line controller that
 * serves orders, bookings and subscriptions. Real Estate adds a `paymentFrom` branch
 * (`listing_package`); it does not build a second payment flow. That is what keeps this
 * purchase in the ledger and in the existing reconciliation.
 */
const realEstateListingOrderSchema = mongoose.Schema(
  {
    orderCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    vendor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateVendor',
      required: true,
    },

    package: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateListingPackage',
      required: true,
    },

    /**
     * The package as it was at purchase. See the class doc.
     */
    /**
     * The package as it was at purchase. See the class doc.
     *
     * An explicit sub-schema, not `mongoose.Schema.Types.Mixed` and not a bare object
     * literal with untyped keys. Two failures motivated it:
     *
     *   - Under the literal form Mongoose applies no nested schema, so a `Date` written to
     *     `frozenAt` was silently discarded on save. A snapshot with no freeze timestamp
     *     cannot answer "what did this package look like at purchase", which is its
     *     entire purpose (BR-15).
     *   - Under `Mixed` the `moneyField` setter would be skipped, storing the rupees figure
     *     that is supposed to live *inside* the field.
     *
     * A real sub-schema gives both: `moneyField` converts on the way in, and `frozenAt`
     * casts to a Date.
     */
    packageSnapshot: {
      type: new mongoose.Schema(
        {
          code: { type: String },
          name: { type: String },
          listingCount: { type: Number, required: false },
          durationDays: { type: Number, required: false },
          limits: { type: mongoose.Schema.Types.Mixed, required: false },
          price: moneyField(0),
          frozenAt: { type: Date, required: false },
        },
        { _id: false }
      ),
      required: false,
      default: undefined,
    },

    /** What was actually charged. Snapshot, not a live read of the package. */
    amount: moneyField(0),

    /**
     * The payment attempt. Reuses the existing stack.
     *
     * `paymentFrom` on that record is `listing_package`, which is how a reconciliation
     * separates package revenue from every other kind.
     */
    paymentInitiation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentInitiation',
      required: false,
    },
    paymentRef: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * PENDING_PAYMENT → PAID → (entitlement created)
     *                 ↘ FAILED | CANCELLED
     * PAID            ↘ REFUNDED (admin, with reason)
     */
    status: {
      type: String,
      required: true,
      default: 'PENDING_PAYMENT',
      enum: ['PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'],
    },

    paidAt: { type: Date, required: false },

    /** Created when this order is paid. One order grants exactly one entitlement. */
    entitlement: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateListingEntitlement',
      required: false,
    },

    refundReason: { type: String, required: false, trim: true },
    refundedAt: { type: Date, required: false },
    refundedBy: {
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

// add plugin that converts mongoose to json
realEstateListingOrderSchema.plugin(toJSON);
realEstateListingOrderSchema.plugin(paginate);

realEstateListingOrderSchema.index({ orderCode: 1 }, { unique: true });
realEstateListingOrderSchema.index({ vendor: 1, createdAt: -1 });
realEstateListingOrderSchema.index({ status: 1, createdAt: -1 });
realEstateListingOrderSchema.index({ paymentRef: 1 }, { sparse: true });

/**
 * One entitlement per order.
 *
 * Partial, because an unpaid order has no entitlement and many orders may sit at
 * `entitlement: null` at once.
 */
realEstateListingOrderSchema.index(
  { entitlement: 1 },
  { unique: true, partialFilterExpression: { entitlement: { $type: 'objectId' } }, name: 'one_entitlement_per_order' }
);

/**
 * @typedef RealEstateListingOrder
 */
const RealEstateListingOrder = mongoose.model(
  'RealEstateListingOrder',
  realEstateListingOrderSchema
);

module.exports = RealEstateListingOrder;
