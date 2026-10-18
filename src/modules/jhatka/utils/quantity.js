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
// No `toJSON` / `paginate` plugin here. This module exports a reusable SUBSCHEMA
// that is embedded by several models, and each of those models registers the
// plugins on its own schema. Registering them on the subdocument would apply them
// at the wrong level.

/**
 * JhatkaQuantity — `{ value, unit }`, used wherever a Jhatka amount is a weight or
 * a count.
 *
 * ## Why this is a subdocument and never a bare Number
 *
 * "1" is not a quantity. One kilogram of chicken curry cut and one piece of chicken
 * curry cut are the same number and completely different orders. Every weight in
 * this vertical is stored as `{ value, unit }`, and the arithmetic in
 * `jhatka.weight.arithmetic` refuses to operate on a bare number.
 *
 * The failure this prevents is not theoretical. It is a 0.95 kg dozen of eggs,
 * which is what happens when a counted item is pushed through a weighing flow
 * because the quantity field happened to be a bare `Number`.
 *
 * ## Grams internally, always
 *
 * `GRAM` is the conversion unit. 1.08 kg is stored as `1080 GRAM`, never as `1.08`
 * in `KG` — a float with two decimal places accumulates error across a
 * multiplication, and the order's final amount is a multiplication.
 *
 * A value is stored in its DISPLAY unit (`KG` when the customer said kilograms)
 * because `value` is what the operator reads off the weigh screen. The service
 * converts to grams for arithmetic and stores the display pair for the record.
 */
const QUANTITY_UNITS = ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER', 'PACK', 'BAG', 'BOX', 'LABEL', 'ROLL'];

/** Units that are WEIGHED. Everything else is counted. BR-09. */
const WEIGHT_UNITS = ['GRAM', 'KG'];
/** Units that are COUNTED. A dozen is a dozen. */
const COUNT_UNITS = ['PIECE', 'DOZEN', 'TIER', 'PACK', 'BAG', 'BOX', 'LABEL', 'ROLL'];

const quantitySchema = mongoose.Schema(
  {
    value: {
      type: Number,
      required: true,
      /**
       * Integers only. A decimal quantity is what "1.08 kg" becomes, and it must
       * be entered as 1080 g at the scale rather than typed as 1.08 — a decimal
       * here is either a display value that should have been converted, or a
       * rounding bug that has not surfaced yet.
       */
      validate: {
        validator: Number.isInteger,
        message: 'quantity must be an integer — convert to GRAM or PIECE at the boundary',
      },
    },
    unit: {
      type: String,
      required: true,
      enum: QUANTITY_UNITS,
    },
    /**
     * Whether the customer treated this as approximate. True for every WEIGHT
     * line (BR-06), false for every COUNT line.
     *
     * This is not derivable from `unit` at read time because a future product
     * could be sold by weight in whole units. It is frozen at line creation.
     */
    approximate: {
      type: Boolean,
      required: false,
      default: false,
    },
    /**
     * The measured reading, when `approximate` is true. Grammatically the scale's
     * output; retained on the confirmation record for the weighing-evidence
     * requirement in §3.4.
     */
    measuredBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    measuredAt: {
      type: Date,
      required: false,
    },
  },
  { _id: false }
);

/**
 * Grams per display unit. Null for counted units, because converting "one dozen"
 * to grams is meaningless and is exactly the mistake being prevented.
 *
 * @param {string} unit
 * @returns {number|null}
 */
function gramsPerUnit(unit) {
  switch (unit) {
    case 'KG':
      return 1000;
    case 'GRAM':
      return 1;
    default:
      return null;
  }
}

/**
 * Convert a quantity to grams. Refuses counted units.
 *
 * @param {{value: number, unit: string}} qty
 * @returns {number} integer grams
 * @throws {Error} if the unit is not a weight unit
 */
function toGrams(qty) {
  const factor = gramsPerUnit(qty.unit);
  if (factor === null) {
    throw new Error(`cannot convert ${qty.unit} to grams — only GRAM and KG are weights`);
  }
  return Math.round(qty.value * factor);
}

/**
 * Convert grams back to a display unit.
 *
 * @param {number} grams
 * @param {string} targetUnit
 * @returns {number}
 */
function fromGrams(grams, targetUnit) {
  const factor = gramsPerUnit(targetUnit);
  if (factor === null) {
    throw new Error(`cannot express grams in ${targetUnit}`);
  }
  const raw = grams / factor;
  // Grams → KG may land on a fractional kg (1080 g = 1.08 kg). Round to 2dp so
  // the display is a clean weight; the GRAM value remains the source of truth.
  return targetUnit === 'KG' ? Number(raw.toFixed(2)) : Math.round(raw);
}

/**
 * Is this unit weighed or counted? The BR-09 fork in one place.
 *
 * @param {string} unit
 * @returns {'WEIGHT'|'COUNT'}
 */
function measurementModeOf(unit) {
  return WEIGHT_UNITS.includes(unit) ? 'WEIGHT' : 'COUNT';
}

/**
 * Do two quantities describe the same thing? Used to refuse an order line whose
 * unit disagrees with its variant's `measurementMode`.
 *
 * @param {{unit: string}} a
 * @param {{unit: string}} b
 * @returns {boolean}
 */
function sameBasis(a, b) {
  return a && b && measurementModeOf(a.unit) === measurementModeOf(b.unit);
}

module.exports = {
  QUANTITY_UNITS,
  WEIGHT_UNITS,
  COUNT_UNITS,
  quantitySchema,
  gramsPerUnit,
  toGrams,
  fromGrams,
  measurementModeOf,
  sameBasis,
};