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

/**
 * ## BR-02 is a business decision. It is NOT a schema constraint.
 *
 * The four categories that ship at launch are Chicken, Mutton, Fish & Seafood and
 * Eggs, and the source blueprint names four more that must not appear until the
 * business deliberately introduces them.
 *
 * Encoding that as `enum: [...]` on `key` — which is what the first draft of this
 * file did — is the wrong move twice over:
 *
 *   1. The blueprint's own §9 shows a subcategory tier under Chicken
 *      (Whole / Curry Cut / Skinless / Breast). Requiring a code change and a
 *      deploy to add "Curry Cut" makes the taxonomy admin-hostile on day one,
 *      and unlike stores and dairy, Jhatka would have no admin taxonomy CRUD.
 *   2. A frozen enum does not freeze the *launch set*, it freezes the *schema*.
 *      The business's decision is "these four now"; the schema's job is to be
 *      able to express whatever the catalogue becomes.
 *
 * So the freeze is enforced where it belongs — in the seed (exactly these four
 * top-level rows) and in a feature flag for the four reserved keys — and the
 * schema stays dynamic. `assertLaunchSet()` and `assertNoReservedLeak()` are the
 * executable forms, and the verify suite calls both.
 */

/** The four top-level categories that ship at launch. */
const LAUNCH_CATEGORY_KEYS = ['chicken', 'mutton', 'fish_seafood', 'eggs'];

/**
 * Named by the source blueprint as not-yet-approved. Blocked by default; unlocked
 * by `Vertical.settings.enabledFeatures.reservedCategories`, which is a config
 * change rather than a deploy — that is what "the business later explicitly
 * introduces them" should mean in practice.
 */
const RESERVED_CATEGORY_KEYS = ['marinated', 'kebabs', 'ready_to_cook', 'frozen'];

const ALLERGEN_VALUES = ['egg', 'fish', 'shellfish'];
const MEASUREMENT_MODES = ['WEIGHT', 'COUNT'];

/** Lowercase, underscore-separated, no leading digit. */
const CATEGORY_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const jhatkaCategorySchema = mongoose.Schema(
  {
    /**
     * Stable machine key. NEVER shown to a customer.
     *
     * Free-form by design — see the BR-02 note above — but constrained to a slug
     * shape so a key can be used in a URL and a filename without escaping.
     */
    key: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (v) => CATEGORY_KEY_PATTERN.test(v),
        message:
          'key must be lowercase snake_case starting with a letter (e.g. "chicken", "curry_cut")',
      },
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
    /**
     * ## Self-referencing, not a second collection
     *
     * Stores and dairy both use two models (`StoreCategory` + `StoreSubCategory`,
     * `DairyCategory` + `DairySubCategory`). This file uses one model with a
     * `parent` ref instead, because the Jhatka tree is exactly two levels deep and
     * one collection means one query for a whole tree rather than a join plus a
     * merge. Two models would also double the surface on which "is this a
     * subcategory" has to be answered.
     *
     * `null` = top-level. Set = subcategory. Depth is capped at 2 in
     * `jhatka.taxonomy.service` — a third level has no meaning in a catalogue of
     * cuts of meat, and allowing it would make the inheritance walk unbounded.
     */
    parent: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaCategory',
      required: false,
      default: undefined,
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
    icon: {
      type: String,
      required: false,
    },
    /** Curated for the customer Jhatka home screen. */
    featured: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * How items in this node are sold. INHERITED by subcategories when null.
     *
     * `COUNT` is what stops a dozen eggs entering the weighing flow (§7.2). Set
     * `COUNT` here on `eggs` and every egg subcategory inherits it, including any
     * the operator adds next month.
     */
    defaultMeasurementMode: {
      type: String,
      required: false,
      enum: MEASUREMENT_MODES,
    },
    /**
     * Shelf life in hours. INHERITED when null.
     *
     * Per category, never global: one global default would be wrong by a factor
     * of four on the most perishable category and would quietly drive write-offs on
     * fish. These are RAW (uncut, chilled) figures — prepared product gets the
     * shorter life from `JhatkaYieldSpec.shelfLifeHoursPrepared`, counted from
     * CUT time. See BR-13.
     */
    shelfLifeHoursRaw: {
      type: Number,
      required: false,
      min: 1,
    },
    shelfLifeHoursPrepared: {
      type: Number,
      required: false,
      min: 1,
    },
    /** Chilled range. INHERITED when null. Fish is held colder than meat. */
    storageTemperatureC: {
      type: Number,
      required: false,
    },
    minStorageTemperatureC: {
      type: Number,
      required: false,
    },
    /**
     * Weight-variance policy. INHERITED when null.
     *
     * Fresh-meat variance is wildly different between a 1 kg chicken pack and a
     * 500 g prawn pack, so this belongs per category (§3.4). A subcategory of
     * prawns under `fish_seafood` is exactly the case where overriding is right.
     *
     * `maxAllowedTolerancePct` is a ceiling an outlet may not exceed. A category
     * owner widening the band to 15% to make an audit disappear is a thing a
     * schema should refuse.
     */
    weightPolicy: {
      tolerancePct: { type: Number, required: false, min: 0, max: 25 },
      hardOverchargePct: { type: Number, required: false, min: 0, max: 100 },
      hardShortfallPct: { type: Number, required: false, min: 0, max: 100 },
      codTolerancePct: { type: Number, required: false, min: 0, max: 50 },
      maxAllowedTolerancePct: { type: Number, required: false, min: 0, max: 25 },
    },
    /**
     * Whether items here may be bought on a recurring schedule. INHERITED when null.
     *
     * False at `eggs` and `fish_seafood`: a fish subscription is a wastage engine
     * with a subscription attached, and nobody subscribes to eggs — they buy a
     * tray. False-by-default here means an operator opts a cut IN once its
     * fulfilment rate justifies it, rather than a scarce SKU shipping with
     * subscriptions attached.
     */
    subscriptionEligibleByDefault: {
      type: Boolean,
      required: false,
    },
    /**
     * Allergen disclosure. INHERITED when null.
     *
     * `eggs` declares `egg`, because a customer with an egg allergy is not served
     * by that category and the pack label has to say so (§12.3).
     */
    allergens: {
      type: [String],
      required: false,
      /**
       * Per-element check. `enum: [['egg'], ['fish']]` on a `[String]` would tell
       * Mongoose to cast the whole value against those arrays and it throws at
       * schema-build time with a CastError on the empty default.
       */
      validate: {
        validator: (v) => Array.isArray(v) && v.every((a) => ALLERGEN_VALUES.includes(a)),
        message: 'allergens must be drawn from: ' + ALLERGEN_VALUES.join(', '),
      },
    },
    /** Display note. "Cut today. Sold out by 8 PM." INHERITED when null. */
    freshnessNote: {
      type: String,
      required: false,
      trim: true,
    },
    /** Hard cutoff for same-day sale. INHERITED when null. Fish especially. */
    soldOutByLocalTime: {
      type: String,
      required: false,
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
jhatkaCategorySchema.plugin(toJSON);
jhatkaCategorySchema.plugin(paginate);
jhatkaCategorySchema.plugin(slugGenerator);
// A key is unique WITHIN its level: `chicken` and `curry_cut` are both fine, but
// two top-level rows called `chicken` would make every parent lookup ambiguous.
jhatkaCategorySchema.index({ parent: 1, key: 1 }, { unique: true });
jhatkaCategorySchema.index({ parent: 1, status: 1, sortOrder: 1 });
// Reserved-key sweep. Small and named, so the verify suite can ask "did anything
// unapproved appear?" in one indexed query.
jhatkaCategorySchema.index({ key: 1, status: 1 });

/** Is this node a subcategory? Read-only; derived from `parent`. */
jhatkaCategorySchema.virtual('isSubCategory').get(function () {
  return !!this.parent;
});

/**
 * Resolve this node's effective operational profile, inheriting from its parent
 * for any field left null.
 *
 * The inheritance walk is deliberately one level. Depth is capped at 2 in
 * `jhatka.taxonomy.service`, so walking to the root would be walking one hop and
 * a loop here would be a bug waiting for a third level nobody asked for.
 *
 * `parentDoc` must be the populated parent. Passing a bare ObjectId silently
 * yields every inherited field as undefined, which looks exactly like "not
 * configured" — so `jhatka.taxonomy.service.effectiveProfile()` populates it and
 * this is the only function that reads it.
 *
 * @param {object|null} parentDoc populated parent, or null for a top-level node
 * @returns {object} the merged profile, ready to be frozen onto a document
 */
jhatkaCategorySchema.methods.effectiveProfile = function (parentDoc) {
  const parent = parentDoc
    ? {
        defaultMeasurementMode: parentDoc.defaultMeasurementMode,
        shelfLifeHoursRaw: parentDoc.shelfLifeHoursRaw,
        shelfLifeHoursPrepared: parentDoc.shelfLifeHoursPrepared,
        storageTemperatureC: parentDoc.storageTemperatureC,
        minStorageTemperatureC: parentDoc.minStorageTemperatureC,
        subscriptionEligibleByDefault: parentDoc.subscriptionEligibleByDefault,
        allergens: parentDoc.allergens,
        freshnessNote: parentDoc.freshnessNote,
        soldOutByLocalTime: parentDoc.soldOutByLocalTime,
        weightPolicy: parentDoc.weightPolicy,
      }
    : {};

  // Child value wins when set, including an explicit `false` or `[]`, which is why
  // this is a `!= null` test rather than a truthiness test — a subcategory that
  // deliberately clears an inherited allergen list must stay cleared.
  const pick = (child, inherited) => (child !== undefined && child !== null ? child : inherited);

  // `this.weightPolicy` is a Mongoose subdocument, and spreading one yields its
  // internal properties (`_doc`, `$__`, `$isNew`, …) rather than its declared
  // fields. `{...childDoc}` therefore produces an object where every real field
  // reads as undefined, which is indistinguishable from "not configured" — the
  // parent value would then be silently discarded. `toObject()` is required, and
  // this is the exact class of bug that a truthiness check downstream will hide.
  const childPolicy = this.weightPolicy ? this.weightPolicy.toObject() : null;
  const parentPolicy = parent.weightPolicy || null;

  return {
    defaultMeasurementMode: pick(this.defaultMeasurementMode, parent.defaultMeasurementMode),
    shelfLifeHoursRaw: pick(this.shelfLifeHoursRaw, parent.shelfLifeHoursRaw),
    shelfLifeHoursPrepared: pick(this.shelfLifeHoursPrepared, parent.shelfLifeHoursPrepared),
    storageTemperatureC: pick(this.storageTemperatureC, parent.storageTemperatureC),
    minStorageTemperatureC: pick(this.minStorageTemperatureC, parent.minStorageTemperatureC),
    subscriptionEligibleByDefault: pick(
      this.subscriptionEligibleByDefault,
      parent.subscriptionEligibleByDefault
    ),
    allergens: pick(this.allergens, parent.allergens) || [],
    freshnessNote: pick(this.freshnessNote, parent.freshnessNote),
    soldOutByLocalTime: pick(this.soldOutByLocalTime, parent.soldOutByLocalTime),
    weightPolicy: { ...(parentPolicy || {}), ...(childPolicy || {}) },
  };
};

/**
 * The whole tree in two levels, with parents populated.
 *
 * One query, not a join-and-merge, because `parent` is a self-ref — which is the
 * whole reason it is a self-ref.
 */
jhatkaCategorySchema.statics.findTree = function (filter = {}) {
  return this.find(filter).sort({ sortOrder: 1, name: 1 });
};

/**
 * Top-level rows only.
 */
jhatkaCategorySchema.statics.findRoots = function (filter = {}) {
  return this.find({ ...filter, parent: { $exists: false } }).sort({ sortOrder: 1, name: 1 });
};

/**
 * BR-02, part one: the launch set is present and enabled.
 *
 * This does NOT forbid a fifth category. The business is allowed to add one —
 * that is the point of a dynamic taxonomy. It asserts only that the four named
 * categories are seeded and live, so a vertical cannot be declared working while
 * Chicken is missing.
 *
 * @returns {Promise<{ok: boolean, missing: string[], disabled: string[], extra: string[]}>}
 */
jhatkaCategorySchema.statics.assertLaunchSet = async function () {
  const rows = await this.find({}, { key: 1, status: 1, parent: 1 }).lean();

  const roots = rows.filter((r) => !r.parent);
  const present = roots.filter((r) => r.status).map((r) => r.key);

  return {
    ok: LAUNCH_CATEGORY_KEYS.every((k) => present.includes(k)),
    missing: LAUNCH_CATEGORY_KEYS.filter((k) => !present.includes(k)),
    disabled: LAUNCH_CATEGORY_KEYS.filter((k) => !present.includes(k) && roots.some((r) => r.key === k)),
    extra: roots.map((r) => r.key).filter((k) => !LAUNCH_CATEGORY_KEYS.includes(k)),
  };
};

/**
 * BR-02, part two: no reserved category has appeared without the business
 * saying so.
 *
 * `reservedCategories` comes from `Vertical.settings.enabledFeatures`. When it is
 * false, Marinated / Kebabs / Ready-to-Cook / Frozen must not exist at any level.
 * Flipping that flag is how the business "later explicitly introduces them" — a
 * config change, not a deploy.
 *
 * @param {boolean} reservedCategoriesEnabled the feature flag
 * @returns {Promise<{ok: boolean, leaked: string[]}>}
 */
jhatkaCategorySchema.statics.assertNoReservedLeak = async function (reservedCategoriesEnabled) {
  if (reservedCategoriesEnabled) return { ok: true, leaked: [] };

  const leaked = await this.find(
    { key: { $in: RESERVED_CATEGORY_KEYS }, status: true },
    { key: 1 }
  ).lean();

  return { ok: leaked.length === 0, leaked: leaked.map((r) => r.key) };
};

/**
 * @typedef JhatkaCategory
 */
const JhatkaCategory = mongoose.model('JhatkaCategory', jhatkaCategorySchema);

JhatkaCategory.LAUNCH_CATEGORY_KEYS = LAUNCH_CATEGORY_KEYS;
JhatkaCategory.RESERVED_CATEGORY_KEYS = RESERVED_CATEGORY_KEYS;
JhatkaCategory.ALLERGEN_VALUES = ALLERGEN_VALUES;
JhatkaCategory.MEASUREMENT_MODES = MEASUREMENT_MODES;
JhatkaCategory.CATEGORY_KEY_PATTERN = CATEGORY_KEY_PATTERN;

module.exports = JhatkaCategory;