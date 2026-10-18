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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/**
 * The customer's cart for an outlet, created on first use.
 *
 * NOTE this looks up by `(customer, outlet)` — see `addToCart` for why the BR-13 guard
 * cannot live here. A helper that is asked for "the cart for outlet B" when the customer
 * already has one for outlet A must NOT quietly create a second cart, because two carts is
 * precisely the multi-outlet basket the rule forbids.
 */
const getOrCreateCart = async (customerId, outletId, chainId) => {
  const StoreCart = mongoose.model('StoreCart');
  let cart = await StoreCart.findOne({ customer: customerId, outlet: outletId });
  if (!cart) {
    cart = await StoreCart.create({ customer: customerId, outlet: outletId, chain: chainId, items: [] });
  }
  return cart;
};

/**
 * BR-13 / BR-37 — EXACTLY ONE OUTLET PER CART.
 *
 * ## Why the guard is here and not in `getOrCreateCart`
 *
 * `getOrCreateCart(customer, outletB)` legitimately CREATES a cart for outlet B. So a
 * cross-outlet add never fails — it silently produces a second cart, the customer sees an
 * empty one, and the original is still there. That is the exact failure the rule exists to
 * prevent, and it is a *silent* one: no error, no 409, just a cart that appears to have
 * lost its contents.
 *
 * So the check has to look at the customer's carts ACROSS outlets, not at one of them.
 *
 * ## Empty carts are exempt
 *
 * A customer who cleared their cart and then shopped at a different outlet has not
 * violated anything. Only a cart that actually HOLDS LINES from another outlet is a
 * conflict — otherwise leaving a store would require clearing the cart first, which is a
 * worse product than the rule.
 *
 * ## Never merged, never silently cleared
 *
 * The 409 carries both outlet ids so the client can render the specification's dialog
 * ("Your cart contains products from another outlet") with the two explicit choices. The
 * server decides nothing on the customer's behalf.
 */
const assertCartOutletMatches = async (customerId, requestedOutletId) => {
  const StoreCart = mongoose.model('StoreCart');

  // Only carts with lines can conflict.
  const carts = await StoreCart.find({ customer: customerId, 'items.0': { $exists: true } });
  const conflict = carts.find((c) => String(c.outlet) !== String(requestedOutletId));

  if (conflict) {
    throw new ApiError(httpStatus.CONFLICT, 'CART_OUTLET_CONFLICT', true, '', {
      cartOutlet: conflict.outlet,
      requestedOutlet: requestedOutletId,
      cartItems: conflict.items.length,
    });
  }
};

const addToCart = async ({ customer, outlet, chain, product, variant, quantity, unitPrice, name, variantName, image, sku, attributes, isOrganic }) => {
  const StoreCart = mongoose.model('StoreCart');

  // BR-13 first, before any write. A cart is created only once the outlet is known to be
  // compatible with whatever the customer already holds.
  await assertCartOutletMatches(customer, outlet);

  const cart = await getOrCreateCart(customer, outlet, chain);

  const existingItem = cart.items.find((item) => item.variant.toString() === variant.toString());
  if (existingItem) {
    existingItem.quantity += quantity;
  } else {
    cart.items.push({
      outlet,
      chain,
      product,
      variant,
      name,
      variantName,
      image,
      sku,
      quantity,
      unitPrice,
      attributes: attributes || [],
      isOrganic: isOrganic || false,
    });
  }

  cart.itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  cart.subtotal = cart.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

  await cart.save();
  return cart;
};

const updateCartItem = async ({ customer, outlet, variant, quantity }) => {
  const StoreCart = mongoose.model('StoreCart');
  const cart = await StoreCart.findOne({ customer, outlet });
  if (!cart) throw new ApiError(httpStatus.NOT_FOUND, 'Cart not found');

  const item = cart.items.find((i) => i.variant.toString() === variant.toString());
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Item not found in cart');

  if (quantity <= 0) {
    cart.items = cart.items.filter((i) => i.variant.toString() !== variant.toString());
  } else {
    item.quantity = quantity;
  }

  cart.itemCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  cart.subtotal = cart.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  await cart.save();
  return cart;
};

const removeFromCart = async ({ customer, outlet, variant }) => {
  const StoreCart = mongoose.model('StoreCart');
  const cart = await StoreCart.findOne({ customer, outlet });
  if (!cart) throw new ApiError(httpStatus.NOT_FOUND, 'Cart not found');

  cart.items = cart.items.filter((i) => i.variant.toString() !== variant.toString());
  cart.itemCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);
  cart.subtotal = cart.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  await cart.save();
  return cart;
};

const clearCart = async ({ customer, outlet }) => {
  const StoreCart = mongoose.model('StoreCart');
  const cart = await StoreCart.findOne({ customer, outlet });
  if (!cart) throw new ApiError(httpStatus.NOT_FOUND, 'Cart not found');

  cart.items = [];
  cart.itemCount = 0;
  cart.subtotal = 0;

  await cart.save();
  return cart;
};

const getCart = async (customerId, outletId) => {
  const StoreCart = mongoose.model('StoreCart');
  const cart = await StoreCart.findOne({ customer: customerId, outlet: outletId })
    .populate('items.product', 'name slug images')
    .populate('items.variant', 'name sku')
    .lean();
  return cart;
};

/**
 * BR-13 guard — kept exported because it is the single statement of the rule and is worth
 * being able to assert against a single cart in isolation.
 *
 * ## It used to be defined here and NEVER CALLED
 *
 * This took a `cart` and compared its outlet. That can only work if the caller has already
 * decided WHICH cart to check — and `addToCart` had no such cart yet, because
 * `getOrCreateCart` created one for the outlet being added to. So the one place that needed
 * it never had it, and the function was dead code that read as though the rule was
 * enforced. It is now reachable via `assertCartOutletMatches` at the top of `addToCart`.
 *
 * The single-cart form is kept below for that reason, and `assertCartOutletMatches` is the
 * cross-outlet form actually used on the write path.
 */
const validateCartOutlet = async (cart, requestedOutlet) => {
  if (cart && cart.outlet.toString() !== requestedOutlet.toString()) {
    throw new ApiError(httpStatus.CONFLICT, 'CART_OUTLET_CONFLICT', true, '', {
      cartOutlet: cart.outlet,
      requestedOutlet,
    });
  }
};

module.exports = {
  getOrCreateCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
  getCart,
  assertCartOutletMatches,
  validateCartOutlet,
};