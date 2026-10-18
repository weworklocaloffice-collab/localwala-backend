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
const { toJSON, paginate, slugGenerator } = require('../../../models/plugins');
const moneyField = require('../../../utils/money.field');

const PREPARATION_TYPES = ['whole', 'curry_cut', 'skinless', 'boneless', 'cleaned', 'fish_cleaned'];
const ALLERGEN_VALUES = ['egg', 'fish', 'shellfish'];

/**
 * JhatkaProduct — level 2 of the catalogue.
 *
 * A product is a thing the customer recognises ("Chicken Curry Cut"), not a
 * thing the shop weighs. A product can have several variants ("500 g Pack",
 * "1 kg Pack", "Whole 1.4 kg") and each variant carries its own price and its own
 * measurement mode.
 *
 * ## It hangs off a category node, not a "top-level category"
 *
 * `category` refs `JhatkaCategory`, which is a two-level tree. A product may sit
 * under a root (`chicken`) or under a subcategory (`chicken` → `curry_cut`). The
 * effective shelf life, measurement mode, allergens and weight policy come from
 * the node and its ancestors — resolved by `jhatka.taxonomy.service`, never by
 * reading `product.category.shelfLifeHoursRaw` and hoping a parent had none.
 *
 * ## Why a prepared product needs its own row rather than a flag on the raw one
 *
 * A whole chicken and its curry cut have different yields, different shelf lives
 * (BR-13: 48h raw, 24h from cut), different prep times and different allergens
 * once bone is introduced. Making them one row with a `isCut: true` flag means
 * every one of those fields becomes nullable-but-meaningful and the meaning is
 * lost. Two rows and a `JhatkaYieldSpec` between them is the only shape where the
 * relationship is queryable.
 *
 * ## Why HSN and tax live here
 *
 * `hsnCode` and `taxRatePct` are on the PRODUCT, and are copied onto every order
 * line at purchase time (BR-20). They are not read at render time. A tax table
 * that changes between a customer's checkout and their invoice must not restate
 * an order that has already been paid — and `TaxConfiguration` is effective-dated
 * precisely so that it can change.
 */
const jhatkaProductSchema = mongoose.Schema(
  {
    /** Human-facing code, e.g. "CHK-CURRY-CUT". Printed on the pack. */
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    /**
     * Root or subcategory node. Depth is capped at 2 by
     * `jhatka.taxonomy.service`, so this is one hop from the top or zero.
     */
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaCategory',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: 'String',
      source: 'name',
      unique: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    image: {
      type: String,
      required: false,
    },
    images: {
      type: [String],
      default: [],
    },
    /** How the outlet prepares it. Drives the prep screen's instruction line. */
    preparationTypes: {
      type: [String],
      default: [],
      /**
       * Per-element validation, not `enum: [[...]]` — see the note on
       * `JhatkaCategory.allergens`. An array-valued `enum` on a `[String]` makes
       * Mongoose cast the whole array against the options and throws at build
       * time on the empty default.
       */
      validate: {
        validator: (v) => Array.isArray(v) && v.every((p) => PREPARATION_TYPES.includes(p)),
        message: 'preparationTypes must be drawn from: ' + PREPARATION_TYPES.join(', '),
      },
    },
    prepNotes: {
      type: String,
      required: false,
      trim: true,
    },
    storageNotes: {
      type: String,
      required: false,
      trim: true,
    },
    /**
     * BR-20. Frozen onto `JhatkaOrderItem` at purchase. `hsnCode` is a string and
     * not a `TaxConfiguration` ref on purpose: an order line must remain readable
     * after the product is re-categorised, retired, or its tax rate corrected.
     *
     * Resolved from `TaxConfiguration.resolveRate(code, atDate)` at save time,
     * which THROWS on a missing or not-yet-in-force row. That is deliberate and
     * inherited from the stores model: a product with an unconfigured HSN must not
     * be creatable, because it would become an untaxed line on a real invoice.
     */
    hsnCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    taxRatePct: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    /**
     * The `TaxConfiguration` row this product's rate came from, and its version at
     * that moment. Audit-only: an order line reads its own frozen snapshot, never
     * this ref, because the row behind it will change.
     */
    taxConfigSnapshot: {
      version: { type: Number, required: false },
      resolvedAt: { type: Date, required: false },
    },
    /**
     * Whole days at ambient. Set on egg products only — a chilled cut is never
     * ambient, and a global default would silently apply "21 days" to a fish
     * product created from a copy-pasted template.
     */
    storageMode: {
      type: String,
      required: false,
      enum: ['chilled', 'frozen', 'ambient'],
      default: 'chilled',
    },
    shelfLifeDaysAmbient: {
      type: Number,
      required: false,
      min: 1,
    },
    /** Product-level allergens. Merged with the category's on the pack label. */
    allergens: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => Array.isArray(v) && v.every((a) => ALLERGEN_VALUES.includes(a)),
        message: 'allergens must be drawn from: ' + ALLERGEN_VALUES.join(', '),
      },
    },
    /**
     * Whether a customer may buy this on a recurring schedule.
     *
     * Default FALSE, and the product-level default is only half the answer — the
     * VARIANT decides. A 1 kg pack of curry-cut chicken may be eligible; a whole
     * fish may not, and the two are the same product family. `JhatkaVariant`
     * carries the authoritative flag and inherits this as its default.
     */
    subscriptionEligible: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * BR-09. A product-level default only. The VARIANT is authoritative because
     * prawns and whole fish can be the same product line and are sold by different
     * units. Nothing reads this field to decide whether to weigh a line — it is a
     * hint for the admin form's default checkbox.
     */
    isVariableWeight: {
      type: Boolean,
      required: false,
      default: true,
    },
    /** Estimated preparation time, shown on the product page (§7.4). */
    prepTimeMinutes: {
      type: Number,
      required: false,
      min: 0,
    },
    /**
     * Admin curation. A product is browsable only when `status` is true AND
     * `reviewedAt` is set — an unreviewed product exists so an operator can save
     * a draft, not so a customer can buy a typo.
     */
    status: {
      type: Boolean,
      required: false,
      default: true,
    },
    reviewedAt: {
      type: Date,
      required: false,
    },
    reviewedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    sortOrder: {
      type: Number,
      required: false,
      default: 0,
    },
    /**
     * MRP. Kept for display and for the eventual price-display compliance check;
     * Jhatka prices are currently exclusive of tax and this is the inclusive
     * comparison figure.
     */
    mrp: moneyField(0),
    taxInclusive: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
jhatkaProductSchema.plugin(toJSON);
jhatkaProductSchema.plugin(paginate);
jhatkaProductSchema.plugin(slugGenerator);
jhatkaProductSchema.index({ code: 1 }, { unique: true });
jhatkaProductSchema.index({ category: 1, status: 1, sortOrder: 1 });
jhatkaProductSchema.index({ hsnCode: 1 });
jhatkaProductSchema.index({ name: 'text', code: 'text', description: 'text' });

/**
 * Browsable products only.
 *
 * A product with no `reviewedAt` is an operator's draft. Filtering it here rather
 * than in six query call sites is the difference between one rule and six chances
 * to forget it.
 */
jhatkaProductSchema.statics.findBrowsable = function (filter = {}) {
  return this.find({ status: true, reviewedAt: { $ne: null }, ...filter });
};

/**
 * @typedef JhatkaProduct
 */
const JhatkaProduct = mongoose.model('JhatkaProduct', jhatkaProductSchema);

module.exports = JhatkaProduct;