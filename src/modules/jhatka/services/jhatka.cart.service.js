/**
 * jhatka.cart.service.js — cart pricing and mutation.
 *
 * ## The one rule
 *
 * **A client-supplied price is ignored, always.**
 *
 * The cart is the only place in this vertical where a customer can influence a money
 * figure, because it is the only endpoint a customer writes to before an order
 * exists. Every other money field is server-computed from the catalogue. So: unit
 * price, line total, subtotal, tax and estimated total are all derived here from
 * `JhatkaVariant.pricePerUnit` and `JhatkaProduct.taxRatePct`, on every read.
 *
 * The client sends `{ variant, quantity }` and nothing else that matters.
 *
 * ## Why pricing is on READ, not on write
 *
 * A cart stored with today's price is a cart that is wrong tomorrow. The model keeps
 * `unitPriceAtAdd` purely so the app can say "this went up by Rs 10" — the LIVE
 * price is what the cart displays and what checkout will freeze. Storing the estimate
 * and trusting it later is how a customer checks out at a stale price with no notice.
 *
 * ## Uses the SAME arithmetic as the order path
 *
 * `linePricePaise` is the identical helper `jhatka.customer.route.js` uses to turn a
 * quantity and a price basis into a line total. Reusing it rather than writing a
 * second `price * qty` here means a cart total and an order total for the same basket
 * cannot disagree — which is exactly the class of bug that made this extraction
 * worthwhile elsewhere in the vertical.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const { linePricePaise } = require('../utils/weight.arithmetic');
const { asMoney, toPaiseAmount } = require('../utils/money');

/**
 * Load the pricing inputs for every variant in a cart, in ONE round trip.
 *
 * N+1 is not a performance detail here: a 12-line basket would issue 24 queries, and
 * two variants read at slightly different moments could price inconsistently within
 * a single render.
 */
async function loadPricing(models, items) {
  const { JhatkaVariant, JhatkaProduct } = models;

  const variantIds = [...new Set(items.map((i) => String(i.variant)))];
  if (!variantIds.length) return new Map();

  const variants = await JhatkaVariant.find({
    _id: { $in: variantIds },
    status: { $ne: 'archived' },
  })
    .select('product measurementMode pricePerUnit priceBasis isActive')
    .lean();

  const productIds = [...new Set(variants.map((v) => String(v.product)))];
  const products = await JhatkaProduct.find({ _id: { $in: productIds } })
    .select('taxRatePct isActive')
    .lean();

  const productById = new Map(products.map((p) => [String(p._id), p]));
  const priced = new Map();

  for (const v of variants) {
    priced.set(String(v._id), {
      variant: v,
      product: productById.get(String(v.product)) || null,
    });
  }

  return priced;
}

/**
 * Recompute every money field on a cart from live catalogue prices.
 *
 * MUTATES and returns the cart. Nothing here trusts a stored total — the stored
 * values are refreshed in place so a caller that forgets to call this still sees
 * consistent numbers rather than whatever was written last time.
 *
 * Lines whose variant has been archived or deactivated are kept but priced at 0 and
 * flagged `unavailable`, rather than silently dropped: the customer needs to see WHY
 * their basket is not checkoutable.
 */
async function repriceCart(cart, models) {
  const priced = await loadPricing(models, cart.items || []);

  let subtotalPaise = 0;
  let taxPaise = 0;
  let unavailable = 0;

  for (const item of cart.items) {
    const found = priced.get(String(item.variant));

    if (!found || found.variant.isActive === false || found.product?.isActive === false) {
      item.unitPrice = 0;
      item.lineTotal = 0;
      item.unavailable = true;
      unavailable += 1;
      continue;
    }

    const { variant, product } = found;

    // The LIVE price, in rupees. `variant` is a lean read, so `pricePerUnit` is raw
    // paise here — this is the read that must not be confused with a moneyField getter.
    const liveUnitPriceRupees = toPaiseAmount(variant.pricePerUnit) / 100;

    item.unitPrice = liveUnitPriceRupees;
    item.lineTotal = liveUnitPriceRupees;

    // Identical arithmetic to the order path, so basket and order agree.
    const linePaise = linePricePaise(
      item.quantity,
      toPaiseAmount(variant.pricePerUnit),
      variant.priceBasis
    );
    const lineRupees = linePaise / 100;
    item.lineTotal = lineRupees;

    // Tax from the PRODUCT's rate, matching `jhatka.customer.route.js`. GST is a
    // property of the goods, not of the shop's order config.
    const taxRatePct = product?.taxRatePct || 0;
    const lineTaxPaise = Math.round((linePaise * taxRatePct) / 100);

    item.taxRatePct = taxRatePct;
    item.taxAmount = lineTaxPaise / 100;

    subtotalPaise += linePaise;
    taxPaise += lineTaxPaise;

    // What checkout would freeze, and whether it moved since the customer added it.
    item.unitPriceAtAddPaise = toPaiseAmount(item.unitPriceAtAdd || 0);
    item.priceChanged =
      item.unitPriceAtAddPaise > 0 && item.unitPriceAtAddPaise !== toPaiseAmount(variant.pricePerUnit);
  }

  cart.subtotal = asMoney(subtotalPaise);
  cart.taxTotal = asMoney(taxPaise);

  const feesPaise =
    toPaiseAmount(cart.deliveryFee || 0) + toPaiseAmount(cart.packagingFee || 0);
  cart.estimatedTotal = asMoney(subtotalPaise + taxPaise + feesPaise);

  // Derived, not stored. Returned on a non-enumerable property so callers can read it
  // without Mongoose trying to persist it — a leading-underscore field on a hydrated
  // document is a bug waiting to happen.
  Object.defineProperty(cart, '_unavailableCount', {
    value: unavailable,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return cart;
}

/**
 * Add (or increment) a line in a cart.
 *
 * MERGES on the same variant rather than appending a duplicate row, so "add 2 more"
 * does not produce two half-kilo lines that later weigh as two separate packets. BR-10
 * splits a single order line across batches, so the basket must present one line and
 * let preparation split it — merging here is what keeps that possible.
 */
async function addToCart(cart, { variant, quantity }, models) {
  const { JhatkaVariant, JhatkaProduct } = models;

  const v = await JhatkaVariant.findById(variant).lean();
  if (!v) throw new ApiError(httpStatus.NOT_FOUND, 'Variant not found');
  if (v.status === 'archived' || v.isActive === false) {
    throw new ApiError(httpStatus.CONFLICT, 'This product is no longer available', true, '', {
      code: 'VARIANT_UNAVAILABLE',
    });
  }

  const product = await JhatkaProduct.findById(v.product).lean();
  if (!product) throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
  if (product.isActive === false) {
    throw new ApiError(httpStatus.CONFLICT, 'This product is no longer available', true, '', {
      code: 'PRODUCT_UNAVAILABLE',
    });
  }

  // BR-09: measurement basis is frozen from the variant HERE, not at checkout, so a
  // per-piece product cannot become per-kilo (or the reverse) while it sits in a cart.
  const measurementMode = v.measurementMode;

  if (measurementMode === 'COUNT' && quantity.unit !== 'PIECE') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `${v.sku || 'This item'} is sold per piece; quantity.unit must be PIECE`,
      true,
      '',
      { code: 'QUANTITY_UNIT_MISMATCH', expected: 'PIECE', received: quantity.unit }
    );
  }

  const existing = cart.items.find((i) => String(i.variant) === String(variant));

  if (existing) {
    existing.quantity = {
      value: existing.quantity.value + quantity.value,
      unit: quantity.unit,
      approximate: false,
    };
  } else {
    cart.items.push({
      product: v.product,
      variant: v._id,
      sku: v.sku,
      name: product.name,
      image: v.image || product.image,
      quantity: { value: quantity.value, unit: quantity.unit, approximate: false },
      measurementMode,
      // Captured so the app can report a price move. Not used to charge.
      unitPriceAtAdd: asMoney(toPaiseAmount(v.pricePerUnit) / 100),
      addedAt: new Date(),
    });
  }

  cart.lastActivityAt = new Date();
  return repriceCart(cart, models);
}

/** Change one line's quantity. Absent item is a 404, not a silent no-op. */
async function updateCartItem(cart, itemId, { quantity }, models) {
  const item = cart.items.id(itemId);
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'That item is not in your cart');

  if (typeof quantity?.value !== 'number' || quantity.value <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'quantity.value must be > 0');
  }

  // Changing quantity across measurement modes would change the price basis
  // mid-line (half a kilo of fish vs one piece of fish), so the unit is only
  // changeable if the basis allows it.
  if (quantity.unit && quantity.unit !== item.quantity.unit) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `This line is measured in ${item.quantity.unit}; quantity.unit cannot change`,
      true,
      '',
      { code: 'QUANTITY_UNIT_MISMATCH', expected: item.quantity.unit, received: quantity.unit }
    );
  }

  item.quantity = {
    value: quantity.value,
    unit: quantity.unit || item.quantity.unit,
    approximate: false,
  };
  cart.lastActivityAt = new Date();

  return repriceCart(cart, models);
}

/** Remove one line. Absent item is a 404. */
async function removeCartItem(cart, itemId, models) {
  const item = cart.items.id(itemId);
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'That item is not in your cart');

  item.deleteOne();
  cart.lastActivityAt = new Date();

  return repriceCart(cart, models);
}

/**
 * A checkout quote: what this basket costs right now, and whether it can be placed.
 *
 * Deliberately NOT the order. It re-prices from the catalogue and reports blockers,
 * and it does not reserve stock or freeze anything — freezing is what `POST /orders`
 * does, and doing it here would create an order that was never paid for.
 */
async function quoteCart(cart, models) {
  await repriceCart(cart, models);

  const blockers = [];

  if (!cart.items.length) {
    blockers.push({ code: 'EMPTY_CART', message: 'Your cart is empty' });
  }

  if (cart._unavailableCount > 0) {
    blockers.push({
      code: 'UNAVAILABLE_ITEMS',
      message: `${cart._unavailableCount} item(s) are no longer available`,
      count: cart._unavailableCount,
    });
  }

  // Free-text guard, not a stock check: `JhatkaInventoryItem` is per-batch, and a real
  // availability check needs an outlet + variant query the quote should not own.
  const overLimit = (cart.items || []).filter((i) => i.quantity.value > 99);
  if (overLimit.length) {
    blockers.push({
      code: 'QUANTITY_LIMIT',
      message: 'An item quantity above 99 must be ordered by subscription or phone',
      skus: overLimit.map((i) => i.sku),
    });
  }

  return {
    // rupees — a quote is displayed, not settled
    subtotal: cart.subtotal,
    taxTotal: cart.taxTotal,
    estimatedTotal: cart.estimatedTotal,
    deliveryFee: cart.deliveryFee,
    packagingFee: cart.packagingFee,
    itemCount: (cart.items || []).length,
    blockers,
    canCheckout: blockers.length === 0,
    // Expires with the cart, so a stale quote cannot be checked out days later.
    validUntil: cart.expiresAt,
  };
}

module.exports = {
  repriceCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  quoteCart,
  loadPricing,
};