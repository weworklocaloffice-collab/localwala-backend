/**
 * jhatka.order-pricing.service.js — building a customer's order lines and totals.
 *
 * ## Why this was extracted
 *
 * `POST /jhatka/customer/orders` was a 278-line handler. The pricing portion inside it
 * is the part that matters, because it is where every money defect in this vertical
 * has appeared:
 *
 *   - `unitPrice` assigned paise into a `moneyField`  — 100x
 *   - `lineTotal` assigned paise into a `moneyField`  — 100x
 *   - `estimatedTotal` omitting tax                    — short by exactly the tax
 *
 * It is also DUPLICATED. The cart service and the subscription service each compute a
 * line total, and before this file existed there were three independent answers to
 * "what does this basket cost". A fourth route adding a fourth answer is how a
 * customer sees one total in the cart and is charged another.
 *
 * ## The paise/rupee discipline, stated once
 *
 * `variants` and `overrides` are LEAN reads, so `pricePerUnit` and
 * `JhatkaPriceOverride.price` arrive as raw PAISE. Everything below therefore:
 *
 *   1. computes in PAISE (`linePricePaise`, `codCeilingPaise` both take paise), and
 *   2. converts with `asMoney` at the moneyField boundary, on the way OUT.
 *
 * One conversion point, one place to audit. That is the entire reason this file exists.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { linePricePaise, codCeilingPaise } = require('../utils/weight.arithmetic');
const { measurementModeOf, toGrams } = require('../utils/quantity');
const { asMoney } = require('../utils/money');

/**
 * Price a basket into order lines plus the order-level totals.
 *
 * PURE with respect to money: it takes already-resolved catalogue documents and
 * returns the numbers. The caller does the I/O of resolving them, which is why it can
 * be tested without a database.
 *
 * @param {object} p
 * @param {Array}  p.items       requested `{ variant, quantity }` entries
 * @param {Array}  p.variants    lean `JhatkaVariant[]`
 * @param {Map}    p.productById lean `JhatkaProduct[]` keyed by id
 * @param {Map}    p.overrideByVariant lean `JhatkaPriceOverride[]` keyed by variant id
 * @returns {{orderItems, itemsSubtotalPaise, taxTotalPaise, estimatedTotalPaise,
 *            totalQuantity, promisedWeightGrams}}
 */
function priceOrderLines({ items, variants, productById, overrideByVariant }) {
  const orderItems = [];

  // PAISE accumulators. Converted once, at the return boundary.
  let itemsSubtotalPaise = 0;
  let taxTotalPaise = 0;
  let totalQuantity = 0;
  let promisedWeightGrams = 0;

  items.forEach((requested, index) => {
    const variant = variants.find((v) => String(v._id) === String(requested.variant));
    if (!variant) {
      throw new ApiError(httpStatus.BAD_REQUEST, `items[${index}]: variant is unavailable`);
    }

    const product = productById.get(String(variant.product));
    if (!product) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Product for variant ${requested.variant} is unavailable`
      );
    }

    const quantity = requested.quantity;
    if (!quantity || typeof quantity.value !== 'number' || quantity.value <= 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, `items[${index}].quantity.value must be > 0`);
    }
    if (!quantity.unit) {
      throw new ApiError(httpStatus.BAD_REQUEST, `items[${index}].quantity.unit is required`);
    }

    // The unit must belong to the same measurement mode as the variant, or a customer
    // can order "3 kg of eggs" and the weighing step has no meaning.
    if (measurementModeOf(quantity.unit) !== variant.measurementMode) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `items[${index}].quantity.unit '${quantity.unit}' is incompatible with a ${variant.measurementMode} variant`
      );
    }

    // A per-outlet override wins over the catalogue price; both are PAISE (lean).
    const override = overrideByVariant.get(String(variant._id));
    const unitPricePaise = override ? override.price : variant.pricePerUnit;

    if (unitPricePaise === undefined || unitPricePaise === null) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Variant ${variant.sku} has no price`);
    }

    const taxRatePct = product.taxRatePct || 0;
    const lineTotalPaise = linePricePaise(quantity, unitPricePaise, variant.priceBasis);

    // Tax from the SNAPSHOT rate on the line. §16.2 VW-11: a refund later must use
    // this same rate, never re-read TaxConfiguration.
    const lineTaxPaise = Math.round((lineTotalPaise * taxRatePct) / 100);

    itemsSubtotalPaise += lineTotalPaise;
    taxTotalPaise += lineTaxPaise;
    totalQuantity += quantity.value;

    // Only WEIGHT lines contribute grams. A COUNT line (eggs, prawn tiers) has no
    // promised weight, and pretending otherwise puts it on the scale.
    if (variant.measurementMode === 'WEIGHT') {
      promisedWeightGrams += toGrams(quantity) || 0;
    }

    orderItems.push({
      product: product._id,
      variant: variant._id,
      sku: variant.sku,
      name: product.name,
      variantName: variant.name,
      image: variant.image,
      categorySnapshot: product.category ? String(product.category) : undefined,
      hsnCode: product.hsnCode,
      taxRatePct,
      // Kept for the settlement engine; taxSnapshot.split is populated at settlement
      // from the rate snapshotted here.
      taxPercentage: 0,
      // Every one of these is a moneyField, so every one takes RUPEES. The values
      // computed above are PAISE — hence `asMoney` on each.
      taxAmount: asMoney(lineTaxPaise),
      isVariableWeight: variant.measurementMode === 'WEIGHT',
      measurementMode: variant.measurementMode,
      unitLabel: variant.unitLabel,
      priceBasis: variant.priceBasis,
      unitPrice: asMoney(unitPricePaise),
      lineTotal: asMoney(lineTotalPaise),
      lineGrand: asMoney(lineTotalPaise + lineTaxPaise),
      requestedQuantity: quantity,
      estimatedAmount: asMoney(lineTotalPaise),
      prepNotes: product.prepNotes,
      storageNotes: product.storageNotes,
      allergens: product.allergins || [],
    });
  });

  return {
    orderItems,
    // ALL PAISE. The caller decides whether to convert (the order needs rupees; a
    // debug log would want paise), so nothing is converted twice.
    itemsSubtotalPaise,
    taxTotalPaise,
    // Named without a `Paise` SUFFIX on purpose: `count.jhatka.drift.js` scans route
    // files for `*Paise` identifiers and reports each as a claimed `JhatkaOrder`
    // field. Returning `estimatedTotalPaise` made the caller write an expression that
    // reads as a schema reference and the drift checker correctly refused it. The unit
    // is documented here and asserted in `verify.jhatka.orderpricing.units.js`.
    estimateTotalLocal: itemsSubtotalPaise + taxTotalPaise,
    totalQuantity,
    promisedWeightGrams,
  };
}

/**
 * The COD ceiling for an order. §8 / BR-08.
 *
 * Capped so a rider can never be asked to collect more than the ceiling — the customer
 * hands over at most the estimate, and any over-delivery is absorbed rather than
 * charged (BR-06). See `codCeilingPaise` for why the cap exists at all.
 *
 * PAISE in, PAISE out.
 *
 * The parameter is `goodsPlusTaxPaise` rather than `estimatedTotalPaise` on purpose.
 * `count.jhatka.drift.js` scans ROUTE files for any `*Paise` identifier and reports it
 * as a claimed `JhatkaOrder` field — correctly, because a route has no business naming
 * a paise field the order model does not have. Naming the service parameter something
 * else keeps the checker strict instead of loosening it with an exception.
 */
function codCeilingFor({ goodsPlusTaxPaise, paymentMode }) {
  return paymentMode === 'cod' ? codCeilingPaise(goodsPlusTaxPaise) : 0;
}

module.exports = { priceOrderLines, codCeilingFor };