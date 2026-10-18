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

const { status: httpStatus } = require('http-status');
const { DairyCartItem, DairySku, Business } = require('../../../models');
const ApiError = require('../../../utils/ApiError');

/**
 * Dairy cart.
 *
 * Price is captured when the line is added, not recomputed at checkout. A cart
 * can sit for days, and the customer must be charged what they agreed to — a
 * silent reprice between add and pay is how trust is lost. Repricing is offered
 * explicitly via `refreshPrices`, which the customer can decline.
 */

/**
 * Adds a line, or increases the quantity of an existing one.
 *
 * A cart is scoped to one outlet. Mixing outlets would mean splitting one order
 * across two settlements, which the order model deliberately does not support.
 */
const addItem = async (param) => {
  const sku = await DairySku.findById(param.sku);
  if (!sku) {
    throw new ApiError(httpStatus.NOT_FOUND, 'SKU not found');
  }
  if (!sku.inStock) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This pack size is out of stock');
  }

  const business = await Business.findById(sku.business);
  if (business && business.verified === false) {
    throw new ApiError(httpStatus.FORBIDDEN, 'This outlet is not verified yet');
  }

  const existing = await DairyCartItem.findOne({ user: param.user, sku: sku._id });

  if (existing) {
    const nextQuantity = existing.quantity + (param.quantity || 1);
    if (sku.availableQty < nextQuantity) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Only ${sku.availableQty} unit(s) available`
      );
    }
    existing.quantity = nextQuantity;
    await existing.save();
    return existing;
  }

  // One outlet per cart.
  const otherOutlet = await DairyCartItem.findOne({ user: param.user, business: { $ne: sku.business } });
  if (otherOutlet) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Your cart already holds items from a different outlet. Clear it first.'
    );
  }

  const quantity = param.quantity || 1;
  if (sku.availableQty < quantity) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Only ${sku.availableQty} unit(s) available`);
  }

  return DairyCartItem.create({
    user: param.user,
    business: sku.business,
    sku: sku._id,
    quantity,
    price: sku.price,
  });
};

const updateQuantity = async (userId, itemId, quantity) => {
  const item = await DairyCartItem.findOne({ _id: itemId, user: userId });
  if (!item) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  if (quantity <= 0) {
    await item.deleteOne();
    return null;
  }

  const sku = await DairySku.findById(item.sku);
  if (sku && sku.availableQty < quantity) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Only ${sku.availableQty} unit(s) available`);
  }

  item.quantity = quantity;
  await item.save();
  return item;
};

const removeItem = async (userId, itemId) => {
  const item = await DairyCartItem.findOneAndDelete({ _id: itemId, user: userId });
  if (!item) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return item;
};

const clear = async (userId) => {
  return DairyCartItem.deleteMany({ user: userId });
};

/**
 * The cart with a live-availability check.
 *
 * Lines whose SKU sold out or was delisted are reported rather than silently
 * dropped, so the customer decides whether to remove them.
 */
const getCart = async (userId) => {
  const items = await DairyCartItem.find({ user: userId })
    .populate('sku', 'name packSize price availableQty inStock reusableContainer status')
    .populate('business', 'name businessModel verified ownDeliveryPartner')
    .sort({ createdAt: 1 });

  const lines = [];
  const unavailable = [];

  for (const item of items) {
    const sku = item.sku;
    if (!sku || sku.status === false || !sku.inStock || sku.availableQty <= 0) {
      unavailable.push({
        itemId: item._id,
        name: sku ? sku.name : 'Unavailable item',
        reason: !sku || sku.status === false ? 'No longer listed' : 'Out of stock',
      });
      continue;
    }
    lines.push({
      itemId: item._id,
      sku: sku._id,
      name: sku.name,
      packSize: sku.packSize,
      quantity: item.quantity,
      price: item.price,
      lineTotal: Number((item.price * item.quantity).toFixed(2)),
      reusableContainer: sku.reusableContainer,
      availableQty: sku.availableQty,
      exceedsStock: item.quantity > sku.availableQty,
    });
  }

  const itemTotal = Number(lines.reduce((sum, l) => sum + l.lineTotal, 0).toFixed(2));

  return {
    lines,
    unavailable,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    itemTotal,
    business: lines.length > 0 && items[0] ? items[0].business : null,
  };
};

/**
 * Re-reads current SKU prices and reports what changed, without mutating.
 *
 * The caller decides whether to accept, so a customer is never silently
 * repriced.
 */
const refreshPrices = async (userId) => {
  const items = await DairyCartItem.find({ user: userId }).populate('sku', 'name price status');
  const changes = [];

  for (const item of items) {
    if (!item.sku || item.sku.status === false) continue;
    const current = item.sku.price;
    if (Number(current) !== Number(item.price)) {
      changes.push({
        itemId: item._id,
        name: item.sku.name,
        from: item.price,
        to: current,
      });
    }
  }

  return { changes, requiresConfirmation: changes.length > 0 };
};

/**
 * Applies confirmed price changes.
 *
 * @param {Array} itemIds  only these lines are updated; the customer chooses.
 */
const applyPriceChanges = async (userId, itemIds) => {
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return { updated: 0 };
  }

  const items = await DairyCartItem.find({ user: userId, _id: { $in: itemIds } }).populate(
    'sku',
    'price status'
  );

  let updated = 0;
  for (const item of items) {
    if (!item.sku || item.sku.status === false) continue;
    item.price = item.sku.price;
    await item.save();
    updated += 1;
  }

  return { updated };
};

module.exports = {
  addItem,
  updateQuantity,
  removeItem,
  clear,
  getCart,
  refreshPrices,
  applyPriceChanges,
};