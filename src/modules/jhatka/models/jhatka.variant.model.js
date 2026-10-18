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
const { toJSON, paginate } = require('../../../models/plugins');
const moneyField = require('../../../utils/money.field');

/**
 * JhatkaVariant — level 3 of the catalogue, and the load-bearing decision of the
 * entire vertical.
 *
 * ## BR-09: `measurementMode` is the fork in the road
 *
 * Every behaviour in the order flow keys off this one field. `WEIGHT` lines enter
 * the weighing screen, can be adjusted, and refund for shortfall. `COUNT` lines do
 * none of those things — a dozen eggs is a dozen, and putting it through a scale
 * produces a 0.95 kg dozen, which is both absurd and the most likely bug in this
 * codebase if the field is defaulted to `WEIGHT`.
 *
 * The full behaviour matrix lives in the implementation plan §7.2. The short
 * version:
 *
 *   WEIGHT → requestedQuantity is APPROXIMATE (grams)
 *          → weighing screen
 *          → refund possible
 *   COUNT  → requestedQuantity is EXACT (pieces / dozens)
 *          → no weighing screen
 *          → line cancellation only
 *
 * `JhatkaOrderItem.isVariableWeight` is FROZEN from this field at line creation, so
 * a mid-order admin change to a variant cannot convert a counted line into a
 * weighed one after the customer has committed to a price.
 *
 * ## Why `priceBasis` is explicit
 *
 * Because "₹400/kg" and "₹12/pc" and "₹240/dozen" are different *kinds* of number,
 * and a service that infers the unit from the price or from a display label will
 * eventually multiply a per-piece price by a gram quantity. `priceBasis` is the
 * computation input; `unitLabel` is a display string and is never read by
 * arithmetic.
 */
const jhatkaVariantSchema = mongoose.Schema(
  {
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProduct',
      required: true,
    },
    /** Stock-keeping unit. Printed on the pack and on the weigh ticket. */
    sku: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: false,
    },
    /**
     * BR-09. `COUNT` for eggs by piece/dozen and for prawns/crab by tier.
     * `WEIGHT` for everything sold off a scale.
     */
    measurementMode: {
      type: String,
      required: true,
      enum: ['WEIGHT', 'COUNT'],
    },
    /** Display only. Never read by arithmetic. */
    unitLabel: {
      type: String,
      required: true,
      enum: ['kg', 'g', 'pc', 'dozen', 'tier', 'piece'],
    },
    /**
     * What one `pricePerUnit` buys. `per_kg` divides by 1000 against grams;
     * `per_piece` and `per_dozen` multiply against the COUNT quantity.
     */
    priceBasis: {
      type: String,
      required: true,
      enum: ['per_kg', 'per_g', 'per_piece', 'per_dozen', 'per_pack', 'per_tier'],
    },
    /**
     * Rupees at the edges, paise inside. `per_kg` means ₹400 per 1000 g.
     * This is a rate, not a line total — never `$inc` it.
     */
    pricePerUnit: moneyField(0),
    /** Pack size as offered. "500 g Pack" is GRAM 500 in WEIGHT mode. */
    packSize: {
      value: {
        type: Number,
        required: true,
        min: 0,
      },
      unit: {
        type: String,
        required: true,
        enum: ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER', 'PACK'],
      },
    },
    /**
     * Order-line quantity guard. In WEIGHT mode a customer may ask for 250 g or
     * 3.2 kg, so `minOrderQty` is a floor and `stepSize` is the increment the UI
     * offers (100 g, 500 g). In COUNT mode both are 1 and the whole thing is an
     * integer quantity — enforced in validation, not here.
     */
    minOrderQty: {
      value: { type: Number, required: false, min: 0 },
      unit: { type: String, required: false, enum: ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER'] },
    },
    stepSize: {
      value: { type: Number, required: false, min: 0 },
      unit: { type: String, required: false, enum: ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER'] },
    },
    /**
     * BR-16 / §9.5. How a prepaid subscription occurrence on a WEIGHT variant is
     * charged. `ceiling` means the customer pays requested × (1 + ceilingPct) and
     * is NOT reconciled per occurrence; `estimated` means the estimate is charged
     * and reconciled. Only `ceiling` is supported in Phase 9 — the field exists so
     * the rule is data rather than a hard-coded branch, and so the monthly-
     * reconciliation option in plan §9.5 can be turned on without a migration.
     */
    subscriptionChargeMode: {
      type: String,
      required: false,
      enum: ['ceiling', 'estimated'],
      default: 'ceiling',
    },
    subscriptionCeilingPct: {
      type: Number,
      required: false,
      min: 0,
      max: 50,
      default: 10,
    },
    /**
     * Inherited from the product when null. Authoritative at the variant level —
     * BR-15. Eggs and fish must both be false here.
     */
    subscriptionEligible: {
      type: Boolean,
      required: false,
    },
    /**
     * For prepared variants only: the raw→prepared conversion this variant
     * consumes. Null for a whole-carcass sale where nothing is cut.
     *
     * A yield reference with no `JhatkaYieldSpec` document is the single most
     * dangerous shape available in this schema, so it is validated in
     * `jhatka.catalog.service` rather than trusted — see BR-11.
     */
    yieldRef: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaYieldSpec',
      required: false,
      default: undefined,
    },
    /** For COUNT variants of perishables: this many sell through per day. */
    dailySellThroughCap: {
      type: Number,
      required: false,
      min: 0,
    },
    /** Estimated stock shown on the product page. Always labelled "estimated" (§7.4). */
    estimatedAvailability: {
      type: Number,
      required: false,
      min: 0,
    },
    availabilityUnit: {
      type: String,
      required: false,
      enum: ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER'],
    },
    prepTimeMinutes: {
      type: Number,
      required: false,
      min: 0,
    },
    sortOrder: {
      type: Number,
      required: false,
      default: 0,
    },
    status: {
      type: Boolean,
      required: false,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaVariantSchema.plugin(toJSON);
jhatkaVariantSchema.plugin(paginate);
jhatkaVariantSchema.index({ sku: 1 }, { unique: true });
jhatkaVariantSchema.index({ product: 1, status: 1, sortOrder: 1 });
// The prep screen's hot query: "what prepared stock does this outlet have for
// these variants", filtered by mode so a COUNT variant is never weighed.
jhatkaVariantSchema.index({ measurementMode: 1, status: 1 });

/**
 * Grams per base unit, for the arithmetic in §3.5.
 *
 * `pricePerUnit` is expressed per 1000 g for `per_kg` and per 1 g for `per_g`.
 * The order line needs a single conversion, and doing it with a switch at six
 * call sites is how a per-piece price gets multiplied by grams.
 */
jhatkaVariantSchema.virtual('gramsPerPriceUnit').get(function () {
  switch (this.priceBasis) {
    case 'per_kg':
      return 1000;
    case 'per_g':
      return 1;
    default:
      // COUNT bases: the customer's quantity IS the price quantity.
      return 1;
  }
});

/**
 * Whether a line on this variant is variable weight. Read by the order service
 * when it freezes `JhatkaOrderItem.isVariableWeight`.
 */
jhatkaVariantSchema.virtual('isVariableWeightLine').get(function () {
  return this.measurementMode === 'WEIGHT';
});

jhatkaVariantSchema.set('toJSON', { virtuals: true });

/**
 * @typedef JhatkaVariant
 */
const JhatkaVariant = mongoose.model('JhatkaVariant', jhatkaVariantSchema);

module.exports = JhatkaVariant;