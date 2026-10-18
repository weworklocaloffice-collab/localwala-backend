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

const getPickList = async (orderId, { outlet } = {}) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');

  // The outlet filter is part of the tenancy contract: a partner must never
  // read a pick list for an order belonging to a different outlet.
  const query = outlet ? { _id: orderId, outlet } : { _id: orderId };
  const order = await StoreOrder.findOne(query);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  const pickList = [];
  for (const item of order.items) {
    const stockItem = await StoreOutletStockItem.findOne({ outlet: order.outlet, variant: item.variant });
    pickList.push({
      product: item.product,
      variant: item.variant,
      name: item.name,
      attributes: item.attributes,
      quantity: item.quantity,
      shelfLocation: stockItem?.shelfLocation || null,
      availableQty: stockItem?.availableQty || 0,
      status: 'pending',
    });
  }

  return pickList;
};

const pickItem = async ({ orderId, outlet, variant, pickedQuantity, status, resolution, substituteVariant, note }) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const order = outlet ? await StoreOrder.findOne({ _id: orderId, outlet }) : await StoreOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  const item = order.items.find((i) => i.variant.toString() === variant.toString());
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Item not found in order');

  if (pickedQuantity > item.quantity) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'PICKED_QUANTITY_EXCEEDS_ORDER');
  }

  if (status === 'substituted' && (!substituteVariant || !note)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'SUBSTITUTION_REQUIRES_VARIANT_AND_NOTE');
  }

  item.fulfilledQuantity = pickedQuantity;
  item.fulfilment = status;
  if (resolution) item.resolution = resolution;
  if (substituteVariant) item.substituteVariant = substituteVariant;
  if (note) item.resolutionNote = note;

  if (!order.picking) order.picking = { items: [] };
  if (!Array.isArray(order.picking.items)) order.picking.items = [];
  order.picking.items.push({
    item: variant,
    status,
    pickedQuantity,
    resolution,
    substituteVariant,
    note,
  });

  await order.save();
  return order;
};

const completePacking = async ({ orderId, outlet, packageCount, totalWeightGrams, fragile, specialHandling, note }) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const order = outlet ? await StoreOrder.findOne({ _id: orderId, outlet }) : await StoreOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  order.packing = {
    completedAt: new Date(),
    packageCount: packageCount || 1,
    totalWeightGrams,
    fragile: fragile || false,
    specialHandling,
    note,
  };

  await order.save();
  return order;
};

const calculatePartialFulfilment = async (orderId, { outlet } = {}) => {
  const StoreOrder = mongoose.model('StoreOrder');
  const order = outlet ? await StoreOrder.findOne({ _id: orderId, outlet }) : await StoreOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');

  const StoreOutlet = mongoose.model('StoreOutlet');
  const reducedBasket = order.items.reduce((sum, item) => {
    if (item.fulfilment === 'cancelled') return sum;
    return sum + (item.fulfilledQuantity * item.unitPrice);
  }, 0);

  const outletDoc = order.outlet ? await StoreOutlet.findById(order.outlet).select('deliveryConfig.minimumOrder').lean() : null;
  const minimumOrder = outletDoc?.deliveryConfig?.minimumOrder || 0;

  if (reducedBasket === 0) {
    return { action: 'cancel', reason: 'No items fulfilled' };
  }

  if (reducedBasket < minimumOrder) {
    return { action: 'charge_only', amount: reducedBasket, deliveryFeeRefunded: true };
  }

  return { action: 'charge_full', amount: reducedBasket + (order.deliveryFee || 0) };
};

module.exports = {
  getPickList,
  pickItem,
  completePacking,
  calculatePartialFulfilment,
};